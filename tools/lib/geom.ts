// Planar geometry helpers. Points are flat number arrays [x0,y0,x1,y1,...] in metres.

export type Flat = number[];

export function signedArea(r: Flat): number {
  let a = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}

export function centroid(r: Flat): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const f = r[j] * r[i + 1] - r[i] * r[j + 1];
    a += f;
    cx += (r[j] + r[i]) * f;
    cy += (r[j + 1] + r[i + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate: average
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i += 2) {
      sx += r[i];
      sy += r[i + 1];
    }
    return [sx / (n / 2), sy / (n / 2)];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(x: number, y: number, r: Flat): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i];
    const yi = r[i + 1];
    const xj = r[j];
    const yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bboxOf(r: Flat): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < x0) x0 = r[i];
    if (r[i] > x1) x1 = r[i];
    if (r[i + 1] < y0) y0 = r[i + 1];
    if (r[i + 1] > y1) y1 = r[i + 1];
  }
  return [x0, y0, x1, y1];
}

/** Douglas-Peucker simplification of an open polyline (keeps endpoints). */
export function simplify(pts: Flat, tol: number): Flat {
  const n = pts.length / 2;
  if (n <= 2 || tol <= 0) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const dx = pts[b * 2] - ax;
    const dy = pts[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax;
      const py = pts[i * 2 + 1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const qx = px - t * dx;
        const qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  const out: Flat = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** Simplify a closed ring (no repeated closing vertex). */
export function simplifyRing(r: Flat, tol: number): Flat {
  const n = r.length / 2;
  if (n <= 4 || tol <= 0) return r.slice();
  // split at the vertex farthest from vertex 0 so both halves are open polylines
  let far = 0;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (r[i * 2] - r[0]) ** 2 + (r[i * 2 + 1] - r[1]) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplify(r.slice(0, far * 2 + 2), tol);
  const b = simplify(r.slice(far * 2).concat(r.slice(0, 2)), tol);
  const out = a.concat(b.slice(2, b.length - 2));
  return out.length >= 6 ? out : r.slice();
}

/** Sutherland-Hodgman clip of a ring against an axis-aligned rectangle. */
export function clipRing(r: Flat, x0: number, y0: number, x1: number, y1: number): Flat {
  let out = r;
  const edges: Array<[(x: number, y: number) => boolean, (ax: number, ay: number, bx: number, by: number) => [number, number]]> = [
    [(x) => x >= x0, (ax, ay, bx, by) => [x0, ay + ((by - ay) * (x0 - ax)) / (bx - ax)]],
    [(x) => x <= x1, (ax, ay, bx, by) => [x1, ay + ((by - ay) * (x1 - ax)) / (bx - ax)]],
    [(_x, y) => y >= y0, (ax, ay, bx, by) => [ax + ((bx - ax) * (y0 - ay)) / (by - ay), y0]],
    [(_x, y) => y <= y1, (ax, ay, bx, by) => [ax + ((bx - ax) * (y1 - ay)) / (by - ay), y1]],
  ];
  for (const [inside, inter] of edges) {
    const inp = out;
    out = [];
    const n = inp.length;
    if (n < 6) return [];
    let px = inp[n - 2];
    let py = inp[n - 1];
    let pin = inside(px, py);
    for (let i = 0; i < n; i += 2) {
      const cx = inp[i];
      const cy = inp[i + 1];
      const cin = inside(cx, cy);
      if (cin) {
        if (!pin) out.push(...inter(px, py, cx, cy));
        out.push(cx, cy);
      } else if (pin) out.push(...inter(px, py, cx, cy));
      px = cx;
      py = cy;
      pin = cin;
    }
  }
  return out.length >= 6 ? out : [];
}

/**
 * Clip an open polyline to a rectangle. Returns pieces with the distance along
 * the original line at which each piece starts (for continuous dash patterns).
 */
export function clipLine(pts: Flat, x0: number, y0: number, x1: number, y1: number): Array<{ pts: Flat; start: number }> {
  const pieces: Array<{ pts: Flat; start: number }> = [];
  let cur: Flat | null = null;
  let dist = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const segLen = Math.hypot(bx - ax, by - ay);
    // Liang-Barsky
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) {
          ok = false;
          break;
        }
      } else {
        const t = q[k] / p[k];
        if (p[k] < 0) {
          if (t > t1) {
            ok = false;
            break;
          }
          if (t > t0) t0 = t;
        } else {
          if (t < t0) {
            ok = false;
            break;
          }
          if (t < t1) t1 = t;
        }
      }
    }
    if (!ok) {
      cur = null;
      dist += segLen;
      continue;
    }
    const sx = ax + t0 * dx;
    const sy = ay + t0 * dy;
    const ex = ax + t1 * dx;
    const ey = ay + t1 * dy;
    if (!cur || t0 > 0) {
      cur = [sx, sy];
      pieces.push({ pts: cur, start: dist + t0 * segLen });
    }
    cur.push(ex, ey);
    if (t1 < 1) cur = null;
    dist += segLen;
  }
  return pieces.filter((p) => p.pts.length >= 4);
}

export function lineLength(pts: Flat): number {
  let d = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) d += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return d;
}
