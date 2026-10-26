// Growable vertex buffers and stroke/fill tessellation (runs inside the chunk worker).

export interface MeshData {
  pos: Float32Array;
  col?: Uint8Array;
  ext?: Float32Array;
  idx: Uint32Array;
}

export class GeoBuf {
  pos = new Float32Array(1024);
  col: Uint8Array | null;
  ext: Float32Array | null;
  idx = new Uint32Array(2048);
  nv = 0;
  ni = 0;
  r = 0;
  g = 0;
  b = 0;
  a = 255;
  e = 0;
  /** multiplier for round join/cap tessellation (lower at far LODs) */
  segScale = 1;

  constructor(opts: { color?: boolean; extrude?: boolean } = { color: true }) {
    this.col = opts.color !== false ? new Uint8Array(2048) : null;
    this.ext = opts.extrude ? new Float32Array(512) : null;
  }

  color(c: number, a = 255): this {
    this.r = (c >> 16) & 255;
    this.g = (c >> 8) & 255;
    this.b = c & 255;
    this.a = a;
    return this;
  }

  private growV(n: number) {
    const need = this.nv + n;
    if (need * 2 <= this.pos.length) return;
    let cap = this.pos.length / 2;
    while (cap < need) cap *= 2;
    const p = new Float32Array(cap * 2);
    p.set(this.pos.subarray(0, this.nv * 2));
    this.pos = p;
    if (this.col) {
      const c = new Uint8Array(cap * 4);
      c.set(this.col.subarray(0, this.nv * 4));
      this.col = c;
    }
    if (this.ext) {
      const e = new Float32Array(cap);
      e.set(this.ext.subarray(0, this.nv));
      this.ext = e;
    }
  }
  private growI(n: number) {
    const need = this.ni + n;
    if (need <= this.idx.length) return;
    let cap = this.idx.length;
    while (cap < need) cap *= 2;
    const i = new Uint32Array(cap);
    i.set(this.idx.subarray(0, this.ni));
    this.idx = i;
  }

  /** Reserve n vertices; returns index of first. */
  v(x: number, y: number): number {
    this.growV(1);
    const i = this.nv++;
    this.pos[i * 2] = x;
    this.pos[i * 2 + 1] = y;
    if (this.col) {
      this.col[i * 4] = this.r;
      this.col[i * 4 + 1] = this.g;
      this.col[i * 4 + 2] = this.b;
      this.col[i * 4 + 3] = this.a;
    }
    if (this.ext) this.ext[i] = this.e;
    return i;
  }

  tri(a: number, b: number, c: number) {
    this.growI(3);
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  quad(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
    const a = this.v(ax, ay);
    const b = this.v(bx, by);
    const c = this.v(cx, cy);
    const d = this.v(dx, dy);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  circle(x: number, y: number, r: number, segs: number) {
    const c = this.v(x, y);
    const first = this.nv;
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      this.v(x + Math.cos(t) * r, y + Math.sin(t) * r);
    }
    for (let i = 0; i < segs; i++) this.tri(c, first + i, first + ((i + 1) % segs));
  }

  /** Thick polyline with round joins and caps. pts in local metres. */
  stroke(pts: ArrayLike<number>, hw: number, caps = true) {
    const n = pts.length / 2;
    if (n < 2 || hw <= 0) return;
    const segs = Math.max(4, Math.round((hw < 1 ? 6 : hw < 4 ? 10 : 16) * this.segScale));
    let pdx = 0;
    let pdy = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i * 2];
      const ay = pts[i * 2 + 1];
      const bx = pts[i * 2 + 2];
      const by = pts[i * 2 + 3];
      let dx = bx - ax;
      let dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      dx /= len;
      dy /= len;
      const nx = -dy * hw;
      const ny = dx * hw;
      this.quad(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny);
      if (i > 0 && (pdx !== 0 || pdy !== 0)) {
        // round join: fans on both sides between previous and current normals
        const cross = pdx * dy - pdy * dx;
        const dot = pdx * dx + pdy * dy;
        const ang = Math.atan2(cross, dot);
        if (Math.abs(ang) > 0.02) {
          const side = ang > 0 ? -1 : 1; // outer side of the turn
          const a0 = Math.atan2(pdx * side, -pdy * side);
          const steps = Math.max(1, Math.ceil(Math.abs(ang) / (Math.PI / 8)));
          const c = this.v(ax, ay);
          let prev = this.v(ax + Math.cos(a0) * hw, ay + Math.sin(a0) * hw);
          for (let s = 1; s <= steps; s++) {
            const t = a0 + (ang * s) / steps;
            const cur = this.v(ax + Math.cos(t) * hw, ay + Math.sin(t) * hw);
            this.tri(c, prev, cur);
            prev = cur;
          }
        }
      }
      pdx = dx;
      pdy = dy;
    }
    if (caps) {
      this.circle(pts[0], pts[1], hw, segs);
      this.circle(pts[n * 2 - 2], pts[n * 2 - 1], hw, segs);
    }
  }

  /** Dashed stroke (butt ends). phase = distance already travelled before pts[0]. */
  dashed(pts: ArrayLike<number>, hw: number, on: number, off: number, phase = 0) {
    const period = on + off;
    let pos = ((phase % period) + period) % period; // position within the current period
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i * 2];
      const ay = pts[i * 2 + 1];
      const bx = pts[i * 2 + 2];
      const by = pts[i * 2 + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const nx = -uy * hw;
      const ny = ux * hw;
      let s = 0;
      while (len - s > 1e-6) {
        const drawing = pos < on;
        const seg = Math.min(len - s, drawing ? on - pos : period - pos);
        if (drawing && seg > 1e-4) {
          const e = s + seg;
          const x0 = ax + ux * s;
          const y0 = ay + uy * s;
          const x1 = ax + ux * e;
          const y1 = ay + uy * e;
          this.quad(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny);
        }
        s += seg;
        pos += seg;
        // snap to boundaries so float error can never stall the loop
        if (drawing && on - pos < 1e-6) pos = on;
        if (period - pos < 1e-6) pos = 0;
      }
    }
  }

  /** Append pre-triangulated polygon geometry. */
  polygon(pos: ArrayLike<number>, idx: ArrayLike<number>, ox = 0, oy = 0, scale = 1) {
    const base = this.nv;
    for (let i = 0; i < pos.length; i += 2) this.v(pos[i] * scale + ox, pos[i + 1] * scale + oy);
    for (let i = 0; i < idx.length; i += 3) this.tri(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
  }

  finish(): MeshData | null {
    if (!this.ni) return null;
    return {
      pos: this.pos.slice(0, this.nv * 2),
      col: this.col ? this.col.slice(0, this.nv * 4) : undefined,
      ext: this.ext ? this.ext.slice(0, this.nv) : undefined,
      idx: this.idx.slice(0, this.ni),
    };
  }
}

/** Offset a polyline sideways by d metres (positive = left of travel in y-down space). */
export function offsetLine(pts: ArrayLike<number>, d: number): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let nx = 0;
    let ny = 0;
    if (i > 0) {
      const dx = pts[i * 2] - pts[i * 2 - 2];
      const dy = pts[i * 2 + 1] - pts[i * 2 - 1];
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l;
      ny += dx / l;
    }
    if (i < n - 1) {
      const dx = pts[i * 2 + 2] - pts[i * 2];
      const dy = pts[i * 2 + 3] - pts[i * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l;
      ny += dx / l;
    }
    const l2 = nx * nx + ny * ny;
    // miter scale = 2 / |n1+n2|^2 * (n1+n2), clamped
    const k = l2 > 0.25 ? (i > 0 && i < n - 1 ? 2 / l2 : 1 / Math.sqrt(l2)) : 2;
    out.push(pts[i * 2] + nx * d * k, pts[i * 2 + 1] + ny * d * k);
  }
  return out;
}
