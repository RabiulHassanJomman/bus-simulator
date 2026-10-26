// AI traffic around the player: vehicles drive the real road graph with Intelligent Driver
// Model car-following and deliberately weak lane discipline (Dhaka!). Pure logic, no Pixi.
import { otherEnd, type RoadGraph } from '../../shared/graph';
import { LF_ONEWAY, RoadClass } from '../../shared/kinds';
import { canTraverse, turnAllowed } from '../Router';
import type { Signals, Controller } from './Signals';
import { VSPECS, VTYPES, type VSpec, type VType } from './types';

export interface Vehicle {
  id: number;
  spec: VSpec;
  /** colour/livery variant index for the renderer */
  variant: number;
  edge: number;
  dir: 1 | -1;
  /** distance travelled along the current edge (in travel direction), metres */
  s: number;
  next: number; // next edge (-1 = none chosen yet)
  v: number;
  vmax: number;
  /** lateral offset from the centreline, + = left of travel (kerb side in Bangladesh) */
  lat: number;
  latTarget: number;
  kerbPref: number;
  x: number;
  y: number;
  heading: number;
  level: number;
  stuck: number;
  /** seconds of deliberate stop (buses picking up in the middle of the road) */
  dwell: number;
  /** controller already cleared (don't stop again inside the same junction) */
  clearedCtrl: number;
  honk: number; // seconds until it may honk again
  /** hit by the player: stop for a while */
  shaken: number;
  braking: boolean;
  dead: boolean;
}

/** Things AI must not drive into: player bus, pedestrians on the road. */
export interface Obstacle {
  x: number;
  y: number;
  /** heading (radians) and half extents of an oriented box */
  h: number;
  hl: number;
  hw: number;
  vx: number;
  vy: number;
}

export interface TrafficEvents {
  honks: Array<{ x: number; y: number; type: VType }>;
}

const CELL = 12;
const LOOK = 45;

export class Traffic {
  vehicles: Vehicle[] = [];
  private nextId = 1;
  private cum = new Map<number, Float32Array>();
  private grid = new Map<number, Vehicle[]>();
  /** edges near the player usable for spawning (refreshed as the player moves) */
  private spawnEdges: number[] = [];
  private spawnWeights: number[] = [];
  private spawnCentre = { x: Infinity, y: Infinity };
  private edgeGrid = new Map<number, number[]>();
  time = 0;
  /** target vehicle count at density 1 */
  baseCount = 200;
  radius = 330;
  despawnRadius = 420;
  events: TrafficEvents = { honks: [] };
  /** extra density around hotspots (0..n), returned per position */
  hotspot: (x: number, y: number) => number = () => 0;

  constructor(
    public g: RoadGraph,
    public signals: Signals,
    private rand: () => number = Math.random,
  ) {
    // coarse grid of edges (by midpoint) for spawn queries
    for (let e = 0; e < g.edgeA.length; e++) {
      const s = g.geoStart[e] * 2;
      const c = g.geoCount[e];
      const mx = (g.geo[s] + g.geo[s + (c - 1) * 2]) / 2;
      const my = (g.geo[s + 1] + g.geo[s + (c - 1) * 2 + 1]) / 2;
      const k = this.ekey(mx, my);
      let a = this.edgeGrid.get(k);
      if (!a) this.edgeGrid.set(k, (a = []));
      a.push(e);
    }
  }

  private ekey(x: number, y: number) {
    return (Math.floor(x / 200) + 1000) * 4096 + Math.floor(y / 200) + 1000;
  }

  // ---------------------------------------------------------------- geometry
  private cumOf(e: number): Float32Array {
    let c = this.cum.get(e);
    if (c) return c;
    const g = this.g;
    const n = g.geoCount[e];
    const s = g.geoStart[e] * 2;
    c = new Float32Array(n);
    for (let i = 1; i < n; i++) c[i] = c[i - 1] + Math.hypot(g.geo[s + i * 2] - g.geo[s + i * 2 - 2], g.geo[s + i * 2 + 1] - g.geo[s + i * 2 - 1]);
    if (this.cum.size > 20000) this.cum.clear();
    this.cum.set(e, c);
    return c;
  }

  /** Point + unit tangent (travel direction) at distance s along edge e travelled in dir. */
  pointAt(e: number, dir: 1 | -1, s: number): [number, number, number, number] {
    const g = this.g;
    const c = this.cumOf(e);
    const L = c[c.length - 1];
    const u = Math.max(0, Math.min(L, dir === 1 ? s : L - s));
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (c[m] <= u) lo = m;
      else hi = m;
    }
    const base = g.geoStart[e] * 2;
    const ax = g.geo[base + lo * 2];
    const ay = g.geo[base + lo * 2 + 1];
    const bx = g.geo[base + hi * 2];
    const by = g.geo[base + hi * 2 + 1];
    const seg = c[hi] - c[lo] || 1;
    const t = (u - c[lo]) / seg;
    let tx = (bx - ax) / seg;
    let ty = (by - ay) / seg;
    if (dir === -1) {
      tx = -tx;
      ty = -ty;
    }
    return [ax + (bx - ax) * t, ay + (by - ay) * t, tx, ty];
  }

  edgeLength(e: number) {
    const c = this.cumOf(e);
    return c[c.length - 1];
  }

  /** Lateral band [min, max] (left-positive) usable by a vehicle of width w on edge e. */
  latBand(e: number, w: number): [number, number] {
    const hw = this.g.edgeHw[e];
    const edge = Math.max(0.2, hw - w / 2 - 0.25);
    if (this.g.edgeFlags[e] & LF_ONEWAY) return [-edge, edge];
    // two-way: our half of the road (left of the centreline); squeezes onto the centre when narrow
    return [Math.min(edge, w / 2 + 0.3), edge];
  }

  // ---------------------------------------------------------------- spawning
  private refreshSpawnEdges(px: number, py: number) {
    if (Math.hypot(px - this.spawnCentre.x, py - this.spawnCentre.y) < 60) return;
    this.spawnCentre = { x: px, y: py };
    const g = this.g;
    this.spawnEdges = [];
    this.spawnWeights = [];
    const r = this.radius;
    for (let iy = Math.floor((py - r) / 200); iy <= Math.floor((py + r) / 200); iy++)
      for (let ix = Math.floor((px - r) / 200); ix <= Math.floor((px + r) / 200); ix++)
        for (const e of this.edgeGrid.get((ix + 1000) * 4096 + iy + 1000) ?? []) {
          const cls = g.edgeCls[e];
          if (cls < RoadClass.Residential || cls === RoadClass.Pedestrian) continue;
          // bigger roads carry more traffic
          // main roads carry most of the traffic (and the jams)
          const w = (cls >= RoadClass.Primary ? 12 : cls >= RoadClass.Secondary ? 6 : cls >= RoadClass.Tertiary ? 3 : 1) * g.edgeLen[e];
          this.spawnEdges.push(e);
          this.spawnWeights.push(w);
        }
  }

  private pickType(truckShare: number): VSpec {
    let total = 0;
    for (const t of VTYPES) total += t === 'truck' ? truckShare * 100 : VSPECS[t].weight;
    let r = this.rand() * total;
    for (const t of VTYPES) {
      r -= t === 'truck' ? truckShare * 100 : VSPECS[t].weight;
      if (r <= 0) return VSPECS[t];
    }
    return VSPECS.car;
  }

  /** Try to place a new vehicle on a weighted random edge in the ring around the player. */
  private spawnOne(px: number, py: number, minDist: number, truckShare: number): boolean {
    const g = this.g;
    if (!this.spawnEdges.length) return false;
    let total = 0;
    for (const w of this.spawnWeights) total += w;
    for (let attempt = 0; attempt < 6; attempt++) {
      let r = this.rand() * total;
      let i = 0;
      while (i < this.spawnWeights.length - 1 && (r -= this.spawnWeights[i]) > 0) i++;
      const e = this.spawnEdges[i];
      const spec = this.pickType(truckShare);
      if (!spec.profile.allow(g, e)) continue;
      const oneway = (g.edgeFlags[e] & LF_ONEWAY) !== 0;
      const dir: 1 | -1 = oneway || this.rand() < 0.5 ? 1 : -1;
      const L = this.edgeLength(e);
      const s = this.rand() * L;
      const [x, y, tx, ty] = this.pointAt(e, dir, s);
      const d = Math.hypot(x - px, y - py);
      if (d < minDist || d > this.radius) continue;
      const [lo, hi] = this.latBand(e, spec.width);
      const kerbPref = Math.min(1, Math.max(0, spec.kerb + (this.rand() - 0.5) * 0.4));
      const lat = lo + (hi - lo) * kerbPref;
      const lx = ty;
      const ly = -tx;
      const vx = x + lx * lat;
      const vy = y + ly * lat;
      if (this.occupied(vx, vy, spec.length)) continue;
      const vmax = spec.vmax * (0.8 + this.rand() * 0.35);
      const veh: Vehicle = {
        id: this.nextId++,
        spec,
        variant: Math.floor(this.rand() * 1000),
        edge: e,
        dir,
        s,
        next: -1,
        v: Math.min(vmax, (g.edgeSpeed[e] / 3.6) * 0.6) * this.rand(),
        vmax,
        lat,
        latTarget: lat,
        kerbPref,
        x: vx,
        y: vy,
        heading: Math.atan2(ty, tx),
        level: g.edgeLevel[e],
        stuck: 0,
        dwell: 0,
        clearedCtrl: -1,
        honk: 2 + this.rand() * 6,
        shaken: 0,
        braking: false,
        dead: false,
      };
      this.vehicles.push(veh);
      this.insert(veh);
      return true;
    }
    return false;
  }

  private occupied(x: number, y: number, len: number): boolean {
    for (const o of this.query(x, y)) if (Math.hypot(o.x - x, o.y - y) < (len + o.spec.length) / 2 + 1) return true;
    return false;
  }

  // ---------------------------------------------------------------- spatial hash
  private key(ix: number, iy: number) {
    return (ix + 4000) * 8192 + iy + 4000;
  }
  private insert(v: Vehicle) {
    const k = this.key(Math.floor(v.x / CELL), Math.floor(v.y / CELL));
    let a = this.grid.get(k);
    if (!a) this.grid.set(k, (a = []));
    a.push(v);
  }
  private rebuildGrid() {
    this.grid.clear();
    for (const v of this.vehicles) this.insert(v);
  }
  /** Vehicles in the 3x3 cells around (x, y) — plus wider when r > CELL. */
  query(x: number, y: number, r = CELL): Vehicle[] {
    const out: Vehicle[] = [];
    const n = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let iy = cy - n; iy <= cy + n; iy++)
      for (let ix = cx - n; ix <= cx + n; ix++) {
        const a = this.grid.get(this.key(ix, iy));
        if (a) for (const v of a) out.push(v);
      }
    return out;
  }

  // ---------------------------------------------------------------- routing at junctions
  private chooseNext(v: Vehicle): number {
    const g = this.g;
    const node = v.dir === 1 ? g.edgeB[v.edge] : g.edgeA[v.edge];
    const [, , tx, ty] = this.pointAt(v.edge, v.dir, this.edgeLength(v.edge) - 0.01);
    let total = 0;
    const cands: number[] = [];
    const weights: number[] = [];
    for (let k = g.adjStart[node]; k < g.adjStart[node + 1]; k++) {
      const e = g.adjEdge[k];
      if (e === v.edge) continue;
      if (!v.spec.profile.allow(g, e) || !canTraverse(g, e, node) || !turnAllowed(g, v.edge, node, e)) continue;
      const fwd = g.edgeA[e] === node ? 1 : -1;
      const [, , ox, oy] = this.pointAt(e, fwd as 1 | -1, 0.01);
      const straight = tx * ox + ty * oy; // 1 = straight on
      if (straight < -0.6) continue; // no hairpins
      const cls = g.edgeCls[e];
      const w = (cls >= RoadClass.Primary ? 4 : cls >= RoadClass.Tertiary ? 2.5 : cls >= RoadClass.Residential ? 1 : 0.25) * (0.4 + Math.max(0, straight) * 2.2);
      cands.push(e);
      weights.push(w);
      total += w;
    }
    if (!cands.length) return -1;
    let r = this.rand() * total;
    for (let i = 0; i < cands.length; i++) if ((r -= weights[i]) <= 0) return cands[i];
    return cands[cands.length - 1];
  }

  // ---------------------------------------------------------------- simulation
  /**
   * Advance traffic. `player` is the player's position; `obstacles` are things to avoid.
   * `density` scales the number of vehicles (time of day × quality preset).
   */
  update(dt: number, player: { x: number; y: number }, obstacles: Obstacle[], density: number, truckShare = 0.03, viewRadius = 230) {
    this.time += dt;
    this.events.honks.length = 0;
    const g = this.g;
    this.refreshSpawnEdges(player.x, player.y);

    // spawn/despawn to the target count (hotspots near the player add vehicles)
    const target = Math.round(this.baseCount * density * (1 + this.hotspot(player.x, player.y)));
    let alive = 0;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.x - player.x, v.y - player.y);
      if (d > this.despawnRadius || (v.stuck > 40 && d > 150)) v.dead = true;
      if (!v.dead) alive++;
    }
    this.vehicles = this.vehicles.filter((v) => !v.dead);
    // fill quickly at start (anywhere in the ring), then trickle in out of view
    const initial = alive < target * 0.5;
    // new arrivals appear just outside what the player can see
    const ring = Math.max(60, Math.min(this.radius - 40, viewRadius + 15));
    for (let i = 0; i < (initial ? 40 : 4) && alive < target; i++) if (this.spawnOne(player.x, player.y, initial ? 30 : ring, truckShare)) alive++;
    this.rebuildGrid();

    for (const v of this.vehicles) this.drive(v, dt, obstacles);
    void g;
  }

  private drive(v: Vehicle, dt: number, obstacles: Obstacle[]) {
    const g = this.g;
    const spec = v.spec;
    const fx = Math.cos(v.heading);
    const fy = Math.sin(v.heading);
    const lx = fy; // left normal (y-down)
    const ly = -fx;

    // --- leader search: nearest thing ahead in our lateral corridor
    let gap = Infinity;
    let leadV = 0;
    let blockedSide = 0; // lateral position of the blocker (for weaving)
    const consider = (ox: number, oy: number, olen: number, owid: number, ovx: number, ovy: number) => {
      const rx = ox - v.x;
      const ry = oy - v.y;
      const ahead = rx * fx + ry * fy;
      if (ahead <= 0 || ahead > LOOK) return;
      const side = rx * lx + ry * ly;
      if (Math.abs(side) > (spec.width + owid) / 2 + 0.25) return;
      const gp = ahead - (spec.length + olen) / 2;
      if (gp < gap) {
        gap = gp;
        leadV = ovx * fx + ovy * fy;
        blockedSide = side;
      }
    };
    for (const o of this.query(v.x + fx * LOOK * 0.5, v.y + fy * LOOK * 0.5, LOOK * 0.6)) {
      if (o === v || o.level !== v.level) continue;
      // ignore vehicles crossing nearly head-on in the other half of the road
      const hdot = Math.cos(o.heading - v.heading);
      if (hdot < -0.7) continue;
      consider(o.x, o.y, o.spec.length, o.spec.width, Math.cos(o.heading) * o.v, Math.sin(o.heading) * o.v);
    }
    for (const o of obstacles) {
      if (Math.abs(o.x - v.x) > LOOK + 10 || Math.abs(o.y - v.y) > LOOK + 10) continue;
      consider(o.x, o.y, o.hl * 2, o.hw * 2, o.vx, o.vy);
    }

    // --- signals at the end of this edge
    const L = this.edgeLength(v.edge);
    const toEnd = L - v.s;
    const node = v.dir === 1 ? g.edgeB[v.edge] : g.edgeA[v.edge];
    const ctrl = this.signals.byNode.get(node);
    let signalSlow = false;
    if (ctrl && ctrl.id !== v.clearedCtrl && toEnd < 70) {
      const approaching = Math.hypot(ctrl.x - g.nodeX[node], ctrl.y - g.nodeY[node]) < 6 || fx * (ctrl.x - v.x) + fy * (ctrl.y - v.y) > 0;
      if (approaching) {
        if (ctrl.broken) signalSlow = true;
        else {
          const light = this.signals.light(ctrl, this.signals.group(ctrl, v.heading), this.time);
          const stopAt = toEnd - this.stopOffset(ctrl, node) - spec.length / 2;
          // stop on red, and on yellow if we can stop comfortably
          const canStop = stopAt > (v.v * v.v) / (2 * spec.decel) * 0.8;
          if ((light === 'red' || (light === 'yellow' && canStop)) && stopAt > -1.5 && stopAt < gap) {
            gap = Math.max(0, stopAt);
            leadV = 0;
          }
        }
      }
    }

    // --- desired speed: road limit, curves, type
    let v0 = Math.min(v.vmax, (g.edgeSpeed[v.edge] / 3.6) * 1.1);
    if (signalSlow) v0 = Math.min(v0, 4.5);
    if (v.shaken > 0) {
      v.shaken -= dt;
      v0 = 0;
    }
    if (v.dwell > 0) {
      v.dwell -= dt;
      v0 = 0;
    }
    // buses stop to pick up passengers wherever they like
    if (spec.type === 'bus' && v.dwell <= 0 && this.rand() < dt / 50) v.dwell = 6 + this.rand() * 14;
    // slow for the turn at the end of the edge
    if (v.next < 0 && toEnd < 30) v.next = this.chooseNext(v);
    if (v.next >= 0 && toEnd < 25) {
      const nd = g.edgeA[v.next] === node ? 1 : -1;
      const [, , ox, oy] = this.pointAt(v.next, nd as 1 | -1, 0.01);
      const turn = 1 - Math.max(-1, Math.min(1, fx * ox + fy * oy));
      if (turn > 0.3) v0 = Math.min(v0, 4 + 8 * (1 - Math.min(1, turn)));
    }

    // --- IDM acceleration
    const a = spec.accel;
    const b = spec.decel;
    const dv = v.v - leadV;
    const sStar = spec.minGap + Math.max(0, v.v * spec.headway + (v.v * dv) / (2 * Math.sqrt(a * b)));
    const gapTerm = gap === Infinity ? 0 : (sStar / Math.max(0.1, gap)) ** 2;
    let acc = a * (1 - (v.v / Math.max(0.5, v0)) ** 4 - gapTerm);
    acc = Math.max(-9, Math.min(a, acc));
    v.braking = acc < -0.5;
    v.v = Math.max(0, v.v + acc * dt);
    if (gap < 0.3 && v.v > 0) v.v = Math.min(v.v, Math.max(0, gap));

    // --- weaving: squeeze past slow leaders (rickshaws, CNGs, bikes do this constantly)
    const [lo, hi] = this.latBand(v.edge, spec.width);
    if (gap < 18 && leadV < v.v + 0.5 && this.rand() < spec.weave * dt * 3) {
      // move to whichever side of the blocker has room in our band
      const want = blockedSide > 0 ? v.lat - spec.width - 0.6 : v.lat + spec.width + 0.6;
      v.latTarget = Math.max(lo, Math.min(hi, want));
    } else if (this.rand() < dt * 0.15) {
      // drift back to the preferred position (kerb for rickshaws), with some randomness
      const pref = Math.min(1, Math.max(0, v.kerbPref + (this.rand() - 0.5) * spec.weave * 0.6));
      v.latTarget = lo + (hi - lo) * pref;
    }
    v.latTarget = Math.max(lo, Math.min(hi, v.latTarget));
    const latRate = (spec.weave * 1.6 + 0.4) * dt * Math.min(1, v.v / 2 + 0.2);
    v.lat += Math.max(-latRate, Math.min(latRate, v.latTarget - v.lat));

    // --- honking: Dhaka drivers honk when held up
    v.honk -= dt;
    if (v.honk <= 0 && gap < 12 && v.v < 3) {
      this.events.honks.push({ x: v.x, y: v.y, type: spec.type });
      v.honk = 1.5 + this.rand() * (spec.type === 'bus' || spec.type === 'motorcycle' ? 4 : 9);
    }

    // --- advance along the graph
    v.s += v.v * dt;
    v.stuck = v.v < 0.3 ? v.stuck + dt : 0;
    while (v.s >= this.edgeLength(v.edge)) {
      const over = v.s - this.edgeLength(v.edge);
      if (v.next < 0) v.next = this.chooseNext(v);
      if (v.next < 0) {
        // dead end: turn around on two-way roads, otherwise disappear
        if (!(g.edgeFlags[v.edge] & LF_ONEWAY)) {
          v.dir = v.dir === 1 ? -1 : 1;
          v.s = 0;
          v.heading += Math.PI;
          break;
        }
        v.dead = true;
        return;
      }
      const at = v.dir === 1 ? g.edgeB[v.edge] : g.edgeA[v.edge];
      const c = this.signals.byNode.get(at);
      if (c) v.clearedCtrl = c.id;
      v.dir = g.edgeA[v.next] === at ? 1 : -1;
      v.edge = v.next;
      v.next = -1;
      v.s = over;
      v.level = g.edgeLevel[v.edge];
      const [nlo, nhi] = this.latBand(v.edge, spec.width);
      v.latTarget = Math.max(nlo, Math.min(nhi, v.latTarget));
      void otherEnd;
    }
    if (v.clearedCtrl >= 0) {
      const c = this.signals.controllers[v.clearedCtrl];
      if (Math.hypot(c.x - v.x, c.y - v.y) > 70) v.clearedCtrl = -1;
    }

    // --- pose: target on the lane, smoothed so junction corners become arcs
    const [px, py, tx, ty] = this.pointAt(v.edge, v.dir, v.s);
    const txp = px + ty * v.lat;
    const typ = py - tx * v.lat;
    const k = Math.min(1, dt * (6 + v.v));
    v.x += (txp - v.x) * k;
    v.y += (typ - v.y) * k;
    const th = Math.atan2(ty, tx);
    let dh = th - v.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    v.heading += dh * Math.min(1, dt * (3 + v.v * 0.6));
  }

  /** How far before the controller node vehicles stop (centre nodes need more room). */
  private stopOffset(c: Controller, node: number): number {
    const d = Math.hypot(c.x - this.g.nodeX[node], c.y - this.g.nodeY[node]);
    return Math.max(2, 11 - d);
  }

  /** The player rammed vehicle v with impulse along (nx, ny). */
  shove(v: Vehicle, nx: number, ny: number, amount: number) {
    v.x += nx * amount;
    v.y += ny * amount;
    v.shaken = 3 + this.rand() * 3;
    v.v = 0;
    v.honk = 0;
  }
}
