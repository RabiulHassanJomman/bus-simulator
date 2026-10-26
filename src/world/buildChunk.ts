// Turns a decoded chunk into GPU-ready vertex/index arrays per render layer.
import { GeoBuf, offsetLine, type MeshData } from '../render/geometry';
import * as P from '../render/palette';
import {
  decodeChunk,
  COORD_SCALE,
  LINE_STRIDE,
  L_CLASS,
  L_FLAGS,
  L_KIND,
  L_LANES,
  L_LAYER,
  L_PT_COUNT,
  L_PT_START,
  L_START_DIST,
  L_WIDTH,
  L_NAME,
  L_NAME_BN,
  POINT_STRIDE,
  P_KIND,
  P_X,
  P_Y,
  P_NAME,
  P_NAME_BN,
  P_SUB,
} from '../shared/format';
import { LF_BRIDGE, LF_ONEWAY, LF_TUNNEL, LineKind, PointKind, RoadClass } from '../shared/kinds';
import { LANE_WIDTH, railWidth, roadCasing, roadWidth, waterwayWidth } from '../shared/style';

export const LAYERS = [
  'land',
  'water',
  'paths',
  'roadCasing',
  'roadFill',
  'roadMark',
  'rail',
  'bldShadow',
  'bld',
  'bridgeShadow',
  'bridges',
  'metroShadow',
  'metro',
] as const;
export type LayerName = (typeof LAYERS)[number];
export const SHADOW_LAYERS = new Set<LayerName>(['bldShadow', 'bridgeShadow', 'metroShadow']);

export interface RoadLabel {
  name: string;
  nameBn: string;
  cls: number;
  pts: number[]; // local metres
}

export interface PointOut {
  kind: number;
  sub: string;
  x: number; // local metres
  y: number;
  name: string;
  nameBn: string;
}

export interface BuiltChunk {
  lod: number;
  cx: number;
  cy: number;
  size: number;
  layers: Partial<Record<LayerName, MeshData>>;
  labels: RoadLabel[];
  points: PointOut[];
  stats: { vertices: number; buildings: number; lines: number };
}

const S = 1 / COORD_SCALE;

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function buildChunk(buf: ArrayBuffer): BuiltChunk {
  const c = decodeChunk(buf);
  const out: BuiltChunk['layers'] = {};
  let vertices = 0;
  const put = (name: LayerName, g: GeoBuf) => {
    const m = g.finish();
    if (m) {
      out[name] = m;
      vertices += m.pos.length / 2;
    }
  };

  // ---- areas
  const areaGeo = (sec: typeof c.land) => {
    const g = new GeoBuf();
    for (let i = 0; i < sec.pos.length / 2; i++) {
      g.color(P.AREA_COLORS[sec.kind[i]] ?? P.BACKGROUND).v(sec.pos[i * 2] * S, sec.pos[i * 2 + 1] * S);
    }
    for (let i = 0; i < sec.idx.length; i += 3) g.tri(sec.idx[i], sec.idx[i + 1], sec.idx[i + 2]);
    return g;
  };
  const land = areaGeo(c.land);
  const water = areaGeo(c.water);

  // ---- lines: decode into JS objects once
  const strs = c.strings;
  const lm = c.lines.meta;
  const lp = c.lines.pos;
  interface L {
    kind: number;
    cls: number;
    flags: number;
    layer: number;
    lanes: number;
    w: number;
    start: number;
    pts: Float32Array;
    name: string;
    nameBn: string;
  }
  const lines: L[] = [];
  for (let i = 0; i < lm.length / LINE_STRIDE; i++) {
    const o = i * LINE_STRIDE;
    const ps = lm[o + L_PT_START];
    const pc = lm[o + L_PT_COUNT];
    const pts = new Float32Array(pc * 2);
    for (let k = 0; k < pc * 2; k++) pts[k] = lp[ps * 2 + k] * S;
    lines.push({
      kind: lm[o + L_KIND],
      cls: lm[o + L_CLASS],
      flags: lm[o + L_FLAGS],
      layer: lm[o + L_LAYER],
      lanes: lm[o + L_LANES],
      w: lm[o + L_WIDTH],
      start: lm[o + L_START_DIST] / 10,
      pts,
      name: lm[o + L_NAME] >= 0 ? strs[lm[o + L_NAME]] : '',
      nameBn: lm[o + L_NAME_BN] >= 0 ? strs[lm[o + L_NAME_BN]] : '',
    });
  }

  // waterways into the water layer
  for (const l of lines) {
    if (l.kind !== LineKind.Waterway) continue;
    water.color(P.WATER_LINE).stroke(l.pts, waterwayWidth(l.cls, l.w) / 2);
  }
  // barriers & runways on the land layer
  for (const l of lines) {
    if (l.kind === LineKind.Runway) {
      land.color(P.RUNWAY).stroke(l.pts, l.w / 20, false);
      if (l.cls === 1) land.color(P.MARK_WHITE).dashed(l.pts, 0.45, 30, 20, l.start);
    } else if (l.kind === LineKind.Barrier) land.color(P.BARRIER).stroke(l.pts, 0.15, false);
  }

  const roads = lines.filter((l) => l.kind === LineKind.Road && !(l.flags & LF_TUNNEL));
  roads.sort((a, b) => a.cls - b.cls);
  const ground = roads.filter((l) => !(l.flags & LF_BRIDGE) || l.layer <= 0);
  const bridges = roads.filter((l) => l.flags & LF_BRIDGE && l.layer > 0);

  const paths = new GeoBuf();
  const casing = new GeoBuf();
  const fill = new GeoBuf();
  const mark = new GeoBuf();
  for (const l of ground) {
    const hw = roadWidth(l.cls, l.lanes, l.flags, l.w) / 2;
    if (l.cls <= RoadClass.Cycleway) {
      paths.color(P.roadCasing(l.cls)).stroke(l.pts, hw + roadCasing(l.cls));
      continue;
    }
    casing.color(P.roadCasing(l.cls)).stroke(l.pts, hw + roadCasing(l.cls));
  }
  for (const l of ground) {
    const hw = roadWidth(l.cls, l.lanes, l.flags, l.w) / 2;
    (l.cls <= RoadClass.Cycleway ? paths : fill).color(P.roadFill(l.cls)).stroke(l.pts, hw);
  }
  for (const l of ground) roadMarkings(mark, l);

  // bridges / flyovers: paint per layer, shadows cast onto ground
  const bridgeGeo = new GeoBuf();
  const bridgeShadow = new GeoBuf({ color: false, extrude: true });
  bridges.sort((a, b) => a.layer - b.layer || a.cls - b.cls);
  const layersPresent = [...new Set(bridges.map((b) => b.layer))];
  for (const L of layersPresent) {
    const set = bridges.filter((b) => b.layer === L);
    for (const l of set) {
      const hw = roadWidth(l.cls, l.lanes, l.flags, l.w) / 2;
      bridgeShadow.e = 4.5 * L + 2;
      bridgeShadow.stroke(l.pts, hw + 0.6);
      bridgeGeo.color(P.BRIDGE_EDGE).stroke(l.pts, hw + 0.6);
    }
    for (const l of set) {
      const hw = roadWidth(l.cls, l.lanes, l.flags, l.w) / 2;
      bridgeGeo.color(P.roadFill(l.cls)).stroke(l.pts, hw);
    }
    for (const l of set) roadMarkings(bridgeGeo, l);
  }

  // railways (ground) and metro (elevated)
  const rail = new GeoBuf();
  const metro = new GeoBuf();
  const metroShadow = new GeoBuf({ color: false, extrude: true });
  for (const l of lines) {
    if (l.kind === LineKind.Rail) {
      if (l.flags & LF_TUNNEL) continue;
      const hw = railWidth(l.cls) / 2;
      const g = l.flags & LF_BRIDGE ? bridgeGeo : rail;
      if (l.flags & LF_BRIDGE) {
        bridgeShadow.e = 6;
        bridgeShadow.stroke(l.pts, hw);
      }
      g.color(P.RAIL_BALLAST).stroke(l.pts, hw);
      g.color(P.RAIL_SLEEPER).dashed(l.pts, 1.3, 0.25, 0.45, l.start);
      g.color(P.RAIL_STEEL).stroke(offsetLine(l.pts, 0.72), 0.06, false);
      g.color(P.RAIL_STEEL).stroke(offsetLine(l.pts, -0.72), 0.06, false);
    } else if (l.kind === LineKind.Metro) {
      if (l.flags & LF_TUNNEL) continue;
      const hw = railWidth(l.cls) / 2;
      metroShadow.e = 14;
      metroShadow.stroke(l.pts, hw);
      metro.color(P.METRO_EDGE).stroke(l.pts, hw);
      metro.color(P.METRO_DECK).stroke(l.pts, hw - 0.45);
      for (const off of [-1.9, 1.9]) {
        const track = offsetLine(l.pts, off);
        metro.color(P.RAIL_SLEEPER).dashed(track, 1.2, 0.25, 0.4, l.start);
        metro.color(P.RAIL_STEEL).stroke(offsetLine(track, 0.72), 0.06, false);
        metro.color(P.RAIL_STEEL).stroke(offsetLine(track, -0.72), 0.06, false);
      }
    }
  }

  // ---- buildings: roof with parapet edge + extruded shadow volume
  const bld = new GeoBuf();
  const bShadow = new GeoBuf({ color: false, extrude: true });
  const B = c.buildings;
  const nb = B.height.length;
  // triangles are stored contiguously in building order
  const triStart = new Uint32Array(nb + 1);
  for (let b = 0, i = 0; b < nb; b++) {
    triStart[b] = i;
    const vEnd = b + 1 < nb ? B.ring[b * 2 + 2] : B.pos.length / 2;
    while (i < B.idx.length && B.idx[i] < vEnd) i += 3;
    triStart[b + 1] = i;
  }
  for (let b = 0; b < nb; b++) {
    const vs = B.ring[b * 2];
    const outer = B.ring[b * 2 + 1];
    const vEnd = b + 1 < nb ? B.ring[b * 2 + 2] : B.pos.length / 2;
    const h = B.height[b];
    let cx = 0;
    let cy = 0;
    for (let i = vs; i < vs + outer; i++) {
      cx += B.pos[i * 2] * S;
      cy += B.pos[i * 2 + 1] * S;
    }
    cx /= outer;
    cy /= outer;
    let r = 0;
    for (let i = vs; i < vs + outer; i++) r = Math.max(r, Math.hypot(B.pos[i * 2] * S - cx, B.pos[i * 2 + 1] * S - cy));
    const hv = hash(B.pos[vs * 2], B.pos[vs * 2 + 1] + b);
    const tone = P.ROOFS[hv % P.ROOFS.length];
    const lift = 0.92 + Math.min(0.16, h / 400) + ((hv >>> 8) % 7) / 100;
    const roof = shade(tone, lift);
    const edge = shade(tone, 0.78);

    // shadow volume: top ring (extruded) + side quads
    const sb = bShadow.nv;
    bShadow.e = 0;
    for (let i = vs; i < vs + outer; i++) bShadow.v(B.pos[i * 2] * S, B.pos[i * 2 + 1] * S);
    bShadow.e = h;
    for (let i = vs; i < vEnd; i++) bShadow.v(B.pos[i * 2] * S, B.pos[i * 2 + 1] * S);
    for (let i = 0; i < outer; i++) {
      const j = (i + 1) % outer;
      bShadow.tri(sb + i, sb + j, sb + outer + j);
      bShadow.tri(sb + i, sb + outer + j, sb + outer + i);
    }
    // footprint edge + inset roof
    const base = bld.nv;
    bld.color(edge);
    for (let i = vs; i < vEnd; i++) bld.v(B.pos[i * 2] * S, B.pos[i * 2 + 1] * S);
    const k = r > 2 ? Math.max(0.82, 1 - 0.55 / r) : 0.9;
    const base2 = bld.nv;
    bld.color(roof);
    for (let i = vs; i < vEnd; i++) bld.v(cx + (B.pos[i * 2] * S - cx) * k, cy + (B.pos[i * 2 + 1] * S - cy) * k);
    for (let t = triStart[b]; t < triStart[b + 1]; t += 3) {
      const a = B.idx[t] - vs;
      const b2 = B.idx[t + 1] - vs;
      const c2 = B.idx[t + 2] - vs;
      bld.tri(base + a, base + b2, base + c2);
      bShadow.tri(sb + outer + a, sb + outer + b2, sb + outer + c2);
    }
    for (let t = triStart[b]; t < triStart[b + 1]; t += 3)
      bld.tri(base2 + B.idx[t] - vs, base2 + B.idx[t + 1] - vs, base2 + B.idx[t + 2] - vs);
  }

  // ---- points: zebra crossings drawn on the marking layer
  const points: PointOut[] = [];
  for (let i = 0; i < c.points.length; i += POINT_STRIDE) {
    const kind = c.points[i + P_KIND];
    const x = c.points[i + P_X] * S;
    const y = c.points[i + P_Y] * S;
    const sub = strs[c.points[i + P_SUB]] ?? '';
    if (kind === PointKind.Crossing && sub !== 'level_crossing') zebra(mark, ground, x, y);
    points.push({
      kind,
      sub,
      x,
      y,
      name: c.points[i + P_NAME] >= 0 ? strs[c.points[i + P_NAME]] : '',
      nameBn: c.points[i + P_NAME_BN] >= 0 ? strs[c.points[i + P_NAME_BN]] : '',
    });
  }

  put('land', land);
  put('water', water);
  put('paths', paths);
  put('roadCasing', casing);
  put('roadFill', fill);
  put('roadMark', mark);
  put('rail', rail);
  put('bldShadow', bShadow);
  put('bld', bld);
  put('bridgeShadow', bridgeShadow);
  put('bridges', bridgeGeo);
  put('metroShadow', metroShadow);
  put('metro', metro);

  const labels: RoadLabel[] = roads
    .filter((l) => (l.name || l.nameBn) && l.cls >= RoadClass.Service)
    .map((l) => ({ name: l.name, nameBn: l.nameBn, cls: l.cls, pts: Array.from(l.pts) }));

  return {
    lod: c.lod,
    cx: c.cx,
    cy: c.cy,
    size: c.size,
    layers: out,
    labels,
    points,
    stats: { vertices, buildings: nb, lines: lines.length },
  };
}

function roadMarkings(g: GeoBuf, l: { cls: number; flags: number; lanes: number; w: number; pts: Float32Array; start: number }) {
  if (l.cls < RoadClass.Tertiary) return;
  const w = roadWidth(l.cls, l.lanes, l.flags, l.w);
  if (w < 6) return;
  const oneway = (l.flags & LF_ONEWAY) !== 0;
  const hw = w / 2;
  // edge lines
  if (l.cls >= RoadClass.Secondary) {
    g.color(P.MARK_WHITE, 230).stroke(offsetLine(l.pts, hw - 0.35), 0.08, false);
    g.color(P.MARK_WHITE, 230).stroke(offsetLine(l.pts, -(hw - 0.35)), 0.08, false);
  }
  const lanes = l.lanes > 0 ? l.lanes : Math.max(oneway ? 2 : 2, Math.round((w - 0.6) / LANE_WIDTH));
  if (oneway) {
    const lw = (w - 0.7) / lanes;
    for (let k = 1; k < lanes; k++) g.color(P.MARK_WHITE).dashed(offsetLine(l.pts, -hw + 0.35 + k * lw), 0.075, 3, 5, l.start);
  } else {
    if (l.cls >= RoadClass.Primary && lanes >= 4) {
      g.color(P.MARK_YELLOW).stroke(offsetLine(l.pts, 0.12), 0.06, false);
      g.color(P.MARK_YELLOW).stroke(offsetLine(l.pts, -0.12), 0.06, false);
    } else g.color(P.MARK_WHITE).dashed(l.pts, 0.08, 3, 5, l.start);
    const perDir = Math.floor(lanes / 2);
    const lw = (hw - 0.35) / perDir;
    for (let k = 1; k < perDir; k++) {
      g.color(P.MARK_WHITE).dashed(offsetLine(l.pts, k * lw), 0.075, 3, 5, l.start);
      g.color(P.MARK_WHITE).dashed(offsetLine(l.pts, -k * lw), 0.075, 3, 5, l.start);
    }
  }
}

/** Zebra crossing across the nearest road at (x, y). */
function zebra(g: GeoBuf, roads: Array<{ cls: number; lanes: number; flags: number; w: number; pts: Float32Array }>, x: number, y: number) {
  let best = 4;
  let bdx = 0;
  let bdy = 0;
  let bw = 0;
  let px = x;
  let py = y;
  for (const l of roads) {
    if (l.cls < RoadClass.Residential) continue;
    const p = l.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const ay = p[i + 1];
      const dx = p[i + 2] - ax;
      const dy = p[i + 3] - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const qx = ax + dx * t;
      const qy = ay + dy * t;
      const d = Math.hypot(x - qx, y - qy);
      if (d < best) {
        best = d;
        const len = Math.sqrt(len2);
        bdx = dx / len;
        bdy = dy / len;
        bw = roadWidth(l.cls, l.lanes, l.flags, l.w);
        px = qx;
        py = qy;
      }
    }
  }
  if (!bw) return;
  // stripes run parallel to the road, spread across its width
  const nx = -bdy;
  const ny = bdx;
  const half = bw / 2 - 0.3;
  const stripes = Math.floor((half * 2) / 1.0);
  const L = 1.6; // half crossing length along the road
  g.color(P.MARK_WHITE, 235);
  for (let s = 0; s < stripes; s++) {
    const o = -half + 0.25 + s * 1.0;
    const cx = px + nx * o;
    const cy = py + ny * o;
    const sx = nx * 0.25;
    const sy = ny * 0.25;
    g.quad(cx - bdx * L - sx, cy - bdy * L - sy, cx + bdx * L - sx, cy + bdy * L - sy, cx + bdx * L + sx, cy + bdy * L + sy, cx - bdx * L + sx, cy - bdy * L + sy);
  }
}
