// Intersection controllers: OSM traffic signals (clustered per junction) plus traffic-police
// junctions where major roads meet. Two phase groups split by approach axis.
import { NF_SIGNAL, type RoadGraph } from '../../shared/graph';
import { RoadClass } from '../../shared/kinds';

export type Light = 'green' | 'yellow' | 'red';

export interface Controller {
  id: number;
  x: number;
  y: number;
  nodes: number[];
  /** axis (radians, mod π) of the main road through the junction: phase group 0 */
  axis: number;
  green: [number, number];
  offset: number;
  /** flashing amber: treated as an unsignalled junction */
  broken: boolean;
  /** manual control by a traffic constable (long, irregular phases) */
  police: boolean;
}

const YELLOW = 3;
const ALL_RED = 2;
const CLUSTER = 45;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export class Signals {
  readonly controllers: Controller[] = [];
  readonly byNode = new Map<number, Controller>();
  private grid = new Map<number, Controller[]>();

  constructor(
    private g: RoadGraph,
    seed = 7,
  ) {
    const r = rng(seed);
    const n = g.nodeX.length;
    // candidate nodes: mapped signals + major junctions (police)
    const cand: Array<{ node: number; police: boolean }> = [];
    for (let i = 0; i < n; i++) {
      if (g.nodeFlags[i] & NF_SIGNAL) cand.push({ node: i, police: false });
      else if (this.isMajorJunction(i)) cand.push({ node: i, police: true });
    }
    // cluster by distance (simple greedy, candidates are sparse)
    const used = new Uint8Array(cand.length);
    for (let i = 0; i < cand.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const members = [cand[i]];
      for (let j = i + 1; j < cand.length; j++) {
        if (used[j]) continue;
        const a = cand[j].node;
        if (members.some((m) => Math.hypot(g.nodeX[m.node] - g.nodeX[a], g.nodeY[m.node] - g.nodeY[a]) < CLUSTER)) {
          used[j] = 1;
          members.push(cand[j]);
        }
      }
      const nodes = members.map((m) => m.node);
      const x = nodes.reduce((s, k) => s + g.nodeX[k], 0) / nodes.length;
      const y = nodes.reduce((s, k) => s + g.nodeY[k], 0) / nodes.length;
      const police = members.every((m) => m.police);
      // main axis: direction of the most important edge touching the cluster
      let bestCls = -1;
      let axis = 0;
      for (const k of nodes)
        for (let a = g.adjStart[k]; a < g.adjStart[k + 1]; a++) {
          const e = g.adjEdge[a];
          if (g.edgeCls[e] > bestCls) {
            bestCls = g.edgeCls[e];
            axis = this.edgeAngleAt(e, k);
          }
        }
      const base = police ? 45 + r() * 40 : 22 + r() * 18;
      const c: Controller = {
        id: this.controllers.length,
        x,
        y,
        nodes,
        axis: ((axis % Math.PI) + Math.PI) % Math.PI,
        green: [base, base * (0.55 + r() * 0.3)],
        offset: r() * 200,
        broken: !police && r() < 0.06,
        police,
      };
      this.controllers.push(c);
      for (const k of nodes) this.byNode.set(k, c);
      const gk = this.gkey(x, y);
      let list = this.grid.get(gk);
      if (!list) this.grid.set(gk, (list = []));
      list.push(c);
    }
  }

  private gkey(x: number, y: number) {
    return (Math.floor(x / 500) + 1000) * 4096 + Math.floor(y / 500) + 1000;
  }

  /** Controllers within r metres of (x, y). */
  near(x: number, y: number, r: number): Controller[] {
    const out: Controller[] = [];
    for (let iy = Math.floor((y - r) / 500); iy <= Math.floor((y + r) / 500); iy++)
      for (let ix = Math.floor((x - r) / 500); ix <= Math.floor((x + r) / 500); ix++)
        for (const c of this.grid.get((ix + 1000) * 4096 + iy + 1000) ?? []) if (Math.hypot(c.x - x, c.y - y) <= r) out.push(c);
    return out;
  }

  private isMajorJunction(n: number): boolean {
    const g = this.g;
    let major = 0;
    let primary = 0;
    const names = new Set<number>();
    for (let a = g.adjStart[n]; a < g.adjStart[n + 1]; a++) {
      const e = g.adjEdge[a];
      if (g.edgeLevel[e] > 0) return false;
      if (g.edgeCls[e] >= RoadClass.Secondary && g.edgeCls[e] !== RoadClass.Link) {
        major++;
        names.add(g.edgeName[e]);
        if (g.edgeCls[e] >= RoadClass.Primary) primary++;
      }
    }
    return major >= 3 && primary >= 1 && names.size >= 2;
  }

  /** Direction (radians) of edge e leaving node k. */
  edgeAngleAt(e: number, k: number): number {
    const g = this.g;
    const s = g.geoStart[e] * 2;
    const c = g.geoCount[e];
    if (g.edgeA[e] === k) return Math.atan2(g.geo[s + 3] - g.geo[s + 1], g.geo[s + 2] - g.geo[s]);
    const t = s + (c - 1) * 2;
    return Math.atan2(g.geo[t - 1] - g.geo[t + 1], g.geo[t - 2] - g.geo[t]);
  }

  /** Phase group (0 = main axis) for travel heading `h`. */
  group(c: Controller, h: number): 0 | 1 {
    return Math.abs(Math.cos(h - c.axis)) >= Math.SQRT1_2 ? 0 : 1;
  }

  /** Light shown to a group at time t (seconds). */
  light(c: Controller, group: 0 | 1, t: number): Light {
    if (c.broken) return 'green';
    const [g0, g1] = c.green;
    const cycle = g0 + g1 + 2 * (YELLOW + ALL_RED);
    const p = (t + c.offset) % cycle;
    const start = group === 0 ? 0 : g0 + YELLOW + ALL_RED;
    const len = group === 0 ? g0 : g1;
    const q = p - start;
    if (q >= 0 && q < len) return 'green';
    if (q >= len && q < len + YELLOW) return 'yellow';
    return 'red';
  }

  /** Seconds until the light for a group changes (for countdown display). */
  remaining(c: Controller, group: 0 | 1, t: number): number {
    const [g0, g1] = c.green;
    const cycle = g0 + g1 + 2 * (YELLOW + ALL_RED);
    const p = (t + c.offset) % cycle;
    const bounds = [g0, g0 + YELLOW, g0 + YELLOW + ALL_RED, g0 + YELLOW + ALL_RED + g1, cycle - ALL_RED, cycle];
    for (const b of bounds) if (p < b) return b - p;
    return 0;
  }
}
