// Spatial index over LOD0 chunk collision data: building triangles, MRT pillars and road
// centrelines. Pure logic (no Pixi) so physics tests can run in Node.
import type { ChunkCollision, CollisionRoad } from '../world/buildChunk';
import { PILLAR_RADIUS } from '../world/buildChunk';
import { RoadClass } from '../shared/kinds';

const CELL = 32; // metres

interface ChunkIndex {
  key: string;
  ox: number;
  oy: number;
  size: number;
  data: ChunkCollision;
  /** cell -> triangle indices */
  triCells: Map<number, number[]>;
  /** cell -> [roadIndex, segmentIndex] pairs */
  segCells: Map<number, number[]>;
}

export interface Contact {
  nx: number; // normal pointing out of the obstacle (push direction for the bus)
  ny: number;
  depth: number;
}

export interface RoadHit {
  road: CollisionRoad;
  /** closest point on the centreline, world metres */
  x: number;
  y: number;
  /** unit direction of the segment (as drawn) */
  dx: number;
  dy: number;
  dist: number;
}

/** Oriented box: centre, half extents, unit forward axis. */
export interface OBB {
  cx: number;
  cy: number;
  hl: number; // half length (along forward)
  hw: number; // half width
  fx: number;
  fy: number;
}

export function obbCorners(b: OBB): number[] {
  const rx = -b.fy;
  const ry = b.fx;
  const ax = b.fx * b.hl;
  const ay = b.fy * b.hl;
  const wx = rx * b.hw;
  const wy = ry * b.hw;
  return [
    b.cx + ax + wx, b.cy + ay + wy,
    b.cx + ax - wx, b.cy + ay - wy,
    b.cx - ax - wx, b.cy - ay - wy,
    b.cx - ax + wx, b.cy - ay + wy,
  ];
}

const key = (ix: number, iy: number) => ix * 65536 + iy;

export class CollisionWorld {
  private chunks = new Map<string, ChunkIndex>();
  private size = 512;

  get count() {
    return this.chunks.size;
  }

  add(key_: string, cx: number, cy: number, size: number, data: ChunkCollision) {
    this.size = size;
    const ox = cx * size;
    const oy = cy * size;
    const triCells = new Map<number, number[]>();
    const t = data.tris;
    for (let i = 0; i < t.length / 6; i++) {
      const o = i * 6;
      const x0 = Math.min(t[o], t[o + 2], t[o + 4]);
      const x1 = Math.max(t[o], t[o + 2], t[o + 4]);
      const y0 = Math.min(t[o + 1], t[o + 3], t[o + 5]);
      const y1 = Math.max(t[o + 1], t[o + 3], t[o + 5]);
      for (let iy = Math.floor(y0 / CELL); iy <= Math.floor(y1 / CELL); iy++)
        for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
          const k = key(ix + 100, iy + 100);
          let a = triCells.get(k);
          if (!a) triCells.set(k, (a = []));
          a.push(i);
        }
    }
    const segCells = new Map<number, number[]>();
    data.roads.forEach((r, ri) => {
      const p = r.pts;
      for (let s = 0; s + 3 < p.length; s += 2) {
        const pad = r.hw + 2;
        const x0 = Math.min(p[s], p[s + 2]) - pad;
        const x1 = Math.max(p[s], p[s + 2]) + pad;
        const y0 = Math.min(p[s + 1], p[s + 3]) - pad;
        const y1 = Math.max(p[s + 1], p[s + 3]) + pad;
        for (let iy = Math.floor(y0 / CELL); iy <= Math.floor(y1 / CELL); iy++)
          for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
            const k = key(ix + 100, iy + 100);
            let a = segCells.get(k);
            if (!a) segCells.set(k, (a = []));
            a.push(ri, s / 2);
          }
      }
    });
    this.chunks.set(key_, { key: key_, ox, oy, size, data, triCells, segCells });
  }

  remove(key_: string) {
    this.chunks.delete(key_);
  }

  has(x: number, y: number): boolean {
    return this.chunks.has(`0:${Math.floor(x / this.size)},${Math.floor(y / this.size)}`);
  }

  private chunksNear(x0: number, y0: number, x1: number, y1: number): ChunkIndex[] {
    const out: ChunkIndex[] = [];
    const s = this.size;
    for (let cy = Math.floor(y0 / s); cy <= Math.floor(y1 / s); cy++)
      for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++) {
        const c = this.chunks.get(`0:${cx},${cy}`);
        if (c) out.push(c);
      }
    return out;
  }

  /** Contacts between an oriented box and ground obstacles (buildings, pillars). */
  collideOBB(b: OBB, out: Contact[] = []): Contact[] {
    out.length = 0;
    const r = Math.hypot(b.hl, b.hw);
    const corners = obbCorners(b);
    const seen = new Set<number>();
    for (const c of this.chunksNear(b.cx - r, b.cy - r, b.cx + r, b.cy + r)) {
      const lx = b.cx - c.ox;
      const ly = b.cy - c.oy;
      seen.clear();
      const t = c.data.tris;
      for (let iy = Math.floor((ly - r) / CELL); iy <= Math.floor((ly + r) / CELL); iy++)
        for (let ix = Math.floor((lx - r) / CELL); ix <= Math.floor((lx + r) / CELL); ix++) {
          const list = c.triCells.get(key(ix + 100, iy + 100));
          if (!list) continue;
          for (const ti of list) {
            if (seen.has(ti)) continue;
            seen.add(ti);
            const o = ti * 6;
            const tri = [t[o] + c.ox, t[o + 1] + c.oy, t[o + 2] + c.ox, t[o + 3] + c.oy, t[o + 4] + c.ox, t[o + 5] + c.oy];
            const ct = satPolygons(corners, tri);
            if (ct) out.push(ct);
          }
        }
      const p = c.data.pillars;
      for (let i = 0; i < p.length; i += 2) {
        const px = p[i] + c.ox;
        const py = p[i + 1] + c.oy;
        if (Math.abs(px - b.cx) > r + 2 || Math.abs(py - b.cy) > r + 2) continue;
        const ct = circleOBB(px, py, PILLAR_RADIUS, b);
        if (ct) out.push(ct);
      }
    }
    return out;
  }

  /** Is anything overhead at (x, y) higher than `level` (decks, MRT viaduct, elevated stations)? */
  covered(x: number, y: number, level: number): boolean {
    const { under } = this.roadsAt(x, y, 12, 0);
    if (under.some((h) => h.road.level > level)) return true;
    if (level > 0) return false;
    for (const c of this.chunksNear(x, y, x, y)) {
      const t = c.data.cover;
      const lx = x - c.ox;
      const ly = y - c.oy;
      for (let i = 0; i < t.length; i += 6) {
        const d1 = (lx - t[i + 2]) * (t[i + 1] - t[i + 3]) - (t[i] - t[i + 2]) * (ly - t[i + 3]);
        const d2 = (lx - t[i + 4]) * (t[i + 3] - t[i + 5]) - (t[i + 2] - t[i + 4]) * (ly - t[i + 5]);
        const d3 = (lx - t[i]) * (t[i + 5] - t[i + 1]) - (t[i + 4] - t[i]) * (ly - t[i + 1]);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) return true;
      }
    }
    return false;
  }

  /** Roads whose carriageway contains (x, y), plus the nearest road within maxDist. */
  roadsAt(x: number, y: number, maxDist = 30, minClass: number = RoadClass.Track): { under: RoadHit[]; nearest: RoadHit | null } {
    const under: RoadHit[] = [];
    let nearest: RoadHit | null = null;
    for (const c of this.chunksNear(x - maxDist, y - maxDist, x + maxDist, y + maxDist)) {
      const lx = x - c.ox;
      const ly = y - c.oy;
      const seen = new Set<number>();
      const cr = Math.ceil(maxDist / CELL);
      const cx0 = Math.floor(lx / CELL);
      const cy0 = Math.floor(ly / CELL);
      for (let iy = cy0 - cr; iy <= cy0 + cr; iy++)
        for (let ix = cx0 - cr; ix <= cx0 + cr; ix++) {
          const list = c.segCells.get(key(ix + 100, iy + 100));
          if (!list) continue;
          for (let k = 0; k < list.length; k += 2) {
            const ri = list[k];
            const si = list[k + 1];
            const id = ri * 100000 + si;
            if (seen.has(id)) continue;
            seen.add(id);
            const road = c.data.roads[ri];
            if (road.cls < minClass) continue;
            const p = road.pts;
            const ax = p[si * 2];
            const ay = p[si * 2 + 1];
            const sx = p[si * 2 + 2] - ax;
            const sy = p[si * 2 + 3] - ay;
            const len2 = sx * sx + sy * sy;
            if (len2 < 1e-6) continue;
            const tt = Math.max(0, Math.min(1, ((lx - ax) * sx + (ly - ay) * sy) / len2));
            const qx = ax + sx * tt;
            const qy = ay + sy * tt;
            const d = Math.hypot(lx - qx, ly - qy);
            const len = Math.sqrt(len2);
            const hit: RoadHit = { road, x: qx + c.ox, y: qy + c.oy, dx: sx / len, dy: sy / len, dist: d };
            if (d <= road.hw + 0.5) under.push(hit);
            if (d <= maxDist && (!nearest || d < nearest.dist)) nearest = hit;
          }
        }
    }
    return { under, nearest };
  }
}

/** SAT between two convex polygons (flat arrays). Returns push-out contact for polygon A. */
export function satPolygons(a: number[], b: number[]): Contact | null {
  let best = Infinity;
  let bnx = 0;
  let bny = 0;
  for (const poly of [a, b]) {
    const n = poly.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let nx = -(poly[j * 2 + 1] - poly[i * 2 + 1]);
      let ny = poly[j * 2] - poly[i * 2];
      const l = Math.hypot(nx, ny);
      if (l < 1e-9) continue;
      nx /= l;
      ny /= l;
      let amin = Infinity;
      let amax = -Infinity;
      let bmin = Infinity;
      let bmax = -Infinity;
      for (let k = 0; k < a.length; k += 2) {
        const d = a[k] * nx + a[k + 1] * ny;
        if (d < amin) amin = d;
        if (d > amax) amax = d;
      }
      for (let k = 0; k < b.length; k += 2) {
        const d = b[k] * nx + b[k + 1] * ny;
        if (d < bmin) bmin = d;
        if (d > bmax) bmax = d;
      }
      const o = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (o <= 0) return null;
      if (o < best) {
        best = o;
        // orient so A is pushed away from B
        const ac = (amin + amax) / 2;
        const bc = (bmin + bmax) / 2;
        bnx = ac >= bc ? nx : -nx;
        bny = ac >= bc ? ny : -ny;
      }
    }
  }
  return { nx: bnx, ny: bny, depth: best };
}

/** Circle (obstacle) vs oriented box; normal pushes the box away. */
export function circleOBB(px: number, py: number, r: number, b: OBB): Contact | null {
  const dx = px - b.cx;
  const dy = py - b.cy;
  // circle centre in box space
  const lf = dx * b.fx + dy * b.fy;
  const lr = dx * -b.fy + dy * b.fx;
  const qf = Math.max(-b.hl, Math.min(b.hl, lf));
  const qr = Math.max(-b.hw, Math.min(b.hw, lr));
  const ex = lf - qf;
  const ey = lr - qr;
  const d = Math.hypot(ex, ey);
  if (d >= r) return null;
  let nf: number;
  let nr: number;
  let depth: number;
  if (d > 1e-6) {
    nf = -ex / d;
    nr = -ey / d;
    depth = r - d;
  } else {
    // centre inside the box: push out along the shallowest axis
    const pf = b.hl - Math.abs(lf);
    const pr = b.hw - Math.abs(lr);
    if (pf < pr) {
      nf = -Math.sign(lf) || -1;
      nr = 0;
      depth = pf + r;
    } else {
      nf = 0;
      nr = -Math.sign(lr) || -1;
      depth = pr + r;
    }
  }
  return { nx: nf * b.fx + nr * -b.fy, ny: nf * b.fy + nr * b.fx, depth };
}
