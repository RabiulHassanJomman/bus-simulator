// A* routing over the road graph by travel time, honouring one-way streets, turn
// restrictions and per-vehicle road permissions. Pure logic (tested in Node).
import { NF_MAIN, otherEnd, turnKey, type RoadGraph } from '../shared/graph';
import { LF_ONEWAY, RoadClass } from '../shared/kinds';

export interface Profile {
  name: string;
  /** may this vehicle use edge e at all? */
  allow(g: RoadGraph, e: number): boolean;
  /** travel speed on edge e, m/s */
  speed(g: RoadGraph, e: number): number;
}

const kmh = (v: number) => v / 3.6;

export const PROFILES: Record<string, Profile> = {
  bus: {
    name: 'bus',
    allow: (g, e) => g.edgeCls[e] >= RoadClass.Service,
    // buses are slow in Dhaka: 60% of the limit, and avoid service lanes
    speed: (g, e) => kmh(g.edgeSpeed[e]) * (g.edgeCls[e] <= RoadClass.Service ? 0.3 : 0.6),
  },
  car: {
    name: 'car',
    allow: (g, e) => g.edgeCls[e] >= RoadClass.Service,
    speed: (g, e) => kmh(g.edgeSpeed[e]) * 0.7,
  },
  // rickshaws are banned from Dhaka's main roads (VIP road, Airport road, Mirpur road...) and flyovers
  rickshaw: {
    name: 'rickshaw',
    allow: (g, e) => g.edgeCls[e] < RoadClass.Primary && g.edgeLevel[e] === 0 && g.edgeCls[e] >= RoadClass.Service,
    speed: () => kmh(12),
  },
};

export interface Route {
  /** edges in order */
  edges: number[];
  /** +1 if traversed A→B, -1 if B→A */
  dirs: number[];
  /** nodes visited, length = edges + 1 */
  nodes: number[];
  length: number;
  time: number;
}

/** May edge e be entered from node `from`? (one-way check) */
export function canTraverse(g: RoadGraph, e: number, from: number): boolean {
  if (!(g.edgeFlags[e] & LF_ONEWAY)) return true;
  return g.edgeA[e] === from;
}

/** Is the turn (inEdge → outEdge at node) allowed by turn restrictions? */
export function turnAllowed(g: RoadGraph, inEdge: number, node: number, outEdge: number): boolean {
  if (inEdge < 0) return true;
  if (g.banned.has(turnKey(inEdge, outEdge))) return false;
  const only = g.only.get(turnKey(inEdge, node));
  return only === undefined || only === outEdge;
}

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Router {
  private grid = new Map<number, number[]>();
  private cell = 200;

  constructor(public g: RoadGraph) {
    for (let n = 0; n < g.nodeX.length; n++) {
      const k = this.key(Math.floor(g.nodeX[n] / this.cell), Math.floor(g.nodeY[n] / this.cell));
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(n);
    }
  }

  private key(ix: number, iy: number) {
    return (ix + 1000) * 4096 + (iy + 1000);
  }

  /** Nearest graph node (optionally only in the main component / allowed for a profile). */
  nearestNode(x: number, y: number, maxDist = 1500, profile?: Profile): number {
    const g = this.g;
    let best = -1;
    let bd = maxDist;
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let ring = 0; ring <= r; ring++) {
      for (let iy = cy - ring; iy <= cy + ring; iy++)
        for (let ix = cx - ring; ix <= cx + ring; ix++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== ring) continue;
          for (const n of this.grid.get(this.key(ix, iy)) ?? []) {
            if (!(g.nodeFlags[n] & NF_MAIN)) continue;
            if (profile) {
              let ok = false;
              for (let k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) if (profile.allow(g, g.adjEdge[k])) ok = true;
              if (!ok) continue;
            }
            const d = Math.hypot(g.nodeX[n] - x, g.nodeY[n] - y);
            if (d < bd) {
              bd = d;
              best = n;
            }
          }
        }
      // nodes in further rings are at least (ring * cell) away
      if (best >= 0 && bd < ring * this.cell) break;
    }
    return best;
  }

  /** Fastest route between two nodes; edge-based search so turn restrictions are exact. */
  route(from: number, to: number, profile: Profile = PROFILES.bus): Route | null {
    const g = this.g;
    if (from === to) return { edges: [], dirs: [], nodes: [from], length: 0, time: 0 };
    const maxV = kmh(90);
    const tx = g.nodeX[to];
    const ty = g.nodeY[to];
    const h = (n: number) => Math.hypot(g.nodeX[n] - tx, g.nodeY[n] - ty) / maxV;
    // state = directed edge id: e*2 + (dir A→B ? 0 : 1); value = arrival at the far node
    const best = new Map<number, number>();
    const prev = new Map<number, number>();
    const heap = new Heap();
    const expand = (inEdge: number, node: number, t0: number, prevState: number) => {
      for (let k = g.adjStart[node]; k < g.adjStart[node + 1]; k++) {
        const e = g.adjEdge[k];
        if (e === inEdge && g.adjStart[node + 1] - g.adjStart[node] > 1) continue; // no U-turns mid-route
        if (!profile.allow(g, e) || !canTraverse(g, e, node) || !turnAllowed(g, inEdge, node, e)) continue;
        const forward = g.edgeA[e] === node;
        const state = e * 2 + (forward ? 0 : 1);
        const t = t0 + g.edgeLen[e] / Math.max(0.5, profile.speed(g, e));
        if (t >= (best.get(state) ?? Infinity)) continue;
        best.set(state, t);
        prev.set(state, prevState);
        heap.push(t + h(forward ? g.edgeB[e] : g.edgeA[e]), state);
      }
    };
    expand(-1, from, 0, -1);
    let goal = -1;
    let iterations = 0;
    while (heap.size && iterations++ < 400000) {
      const state = heap.pop();
      const e = state >> 1;
      const node = state & 1 ? g.edgeA[e] : g.edgeB[e];
      if (node === to) {
        goal = state;
        break;
      }
      expand(e, node, best.get(state)!, state);
    }
    if (goal < 0) return null;
    const edges: number[] = [];
    const dirs: number[] = [];
    for (let s = goal; s >= 0; s = prev.get(s) ?? -1) {
      edges.push(s >> 1);
      dirs.push(s & 1 ? -1 : 1);
    }
    edges.reverse();
    dirs.reverse();
    const nodes = [from];
    let length = 0;
    for (let i = 0; i < edges.length; i++) {
      nodes.push(otherEnd(g, edges[i], nodes[i]));
      length += g.edgeLen[edges[i]];
    }
    return { edges, dirs, nodes, length, time: best.get(goal)! };
  }
}
