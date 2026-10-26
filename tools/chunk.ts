// Step 2: feature NDJSON -> gzip'd binary chunks + index.json in public/data.
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import earcut from 'earcut';
import { bboxOf, centroid, clipLine, clipRing, signedArea, simplify, simplifyRing, type Flat } from './lib/geom';
import { CHUNK_SIZE, LAT0, LON0, project, type BBox } from '../src/shared/geo';
import { AREA_Z, AreaKind, LineKind, PointKind, RoadClass, WaterwayClass } from '../src/shared/kinds';
import { encodeChunk, LINE_STRIDE, type WorldIndex } from '../src/shared/format';
import { PUBLIC_DATA, workDir } from './config';


interface AreaPiece {
  z: number;
  area: number;
  kind: number;
  pos: number[];
  tris: number[];
}
interface BuildingPiece {
  pos: number[];
  tris: number[];
  outer: number;
  h: number;
}
interface LinePiece {
  meta: number[]; // without pt start/count
  pts: number[];
  wayId: number;
}

class ChunkBuilder {
  land: AreaPiece[] = [];
  water: AreaPiece[] = [];
  buildings: BuildingPiece[] = [];
  lines: LinePiece[] = [];
  points: number[] = [];
  strings = new Map<string, number>();
  constructor(
    public lod: number,
    public cx: number,
    public cy: number,
    public size: number,
    public scale: number,
  ) {}
  get ox() {
    return this.cx * this.size;
  }
  get oy() {
    return this.cy * this.size;
  }
  str(s: string | undefined): number {
    if (!s) return -1;
    let i = this.strings.get(s);
    if (i === undefined) {
      i = this.strings.size;
      this.strings.set(s, i);
    }
    return i;
  }
  q(rings: Flat[]): { pos: number[]; holes: number[] } {
    const pos: number[] = [];
    const holes: number[] = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) holes.push(pos.length / 2);
      const ring = rings[r];
      for (let i = 0; i < ring.length; i += 2) {
        pos.push(clamp16(Math.round((ring[i] - this.ox) * this.scale)), clamp16(Math.round((ring[i + 1] - this.oy) * this.scale)));
      }
    }
    return { pos, holes };
  }
  addArea(kind: number, rings: Flat[]) {
    const { pos, holes } = this.q(rings);
    if (pos.length < 6) return;
    const tris = earcut(pos, holes.length ? holes : undefined, 2);
    if (!tris.length) return;
    const piece: AreaPiece = { z: AREA_Z[kind] ?? 1, area: Math.abs(signedArea(rings[0])), kind, pos, tris };
    (kind === AreaKind.Water ? this.water : this.land).push(piece);
  }
  addBuilding(rings: Flat[], h: number) {
    const { pos, holes } = this.q(rings);
    if (pos.length < 6) return;
    const tris = earcut(pos, holes.length ? holes : undefined, 2);
    if (!tris.length) return;
    this.buildings.push({ pos, tris, outer: rings[0].length / 2, h: Math.min(255, Math.max(1, h)) });
  }
  addLine(meta: number[], pts: Flat, wayId: number) {
    const q: number[] = [];
    for (let i = 0; i < pts.length; i += 2)
      q.push(clamp16(Math.round((pts[i] - this.ox) * this.scale)), clamp16(Math.round((pts[i + 1] - this.oy) * this.scale)));
    this.lines.push({ meta, pts: q, wayId });
  }
  empty() {
    return !this.land.length && !this.water.length && !this.buildings.length && !this.lines.length && !this.points.length;
  }
  encode(): Uint8Array {
    const packAreas = (pieces: AreaPiece[]) => {
      // big polygons first so small ones (parks inside residential) paint on top
      pieces.sort((a, b) => a.z - b.z || b.area - a.area);
      const pos: number[] = [];
      const kind: number[] = [];
      const idx: number[] = [];
      for (const p of pieces) {
        const base = pos.length / 2;
        for (let i = 0; i < p.pos.length; i++) pos.push(p.pos[i]);
        for (let i = 0; i < p.pos.length / 2; i++) kind.push(p.kind);
        for (const t of p.tris) idx.push(base + t);
      }
      return { pos: Int16Array.from(pos), kind: Uint8Array.from(kind), idx: Uint32Array.from(idx) };
    };
    const bpos: number[] = [];
    const bidx: number[] = [];
    const ring: number[] = [];
    const height: number[] = [];
    for (const b of this.buildings) {
      const base = bpos.length / 2;
      ring.push(base, b.outer);
      height.push(b.h);
      for (const v of b.pos) bpos.push(v);
      for (const t of b.tris) bidx.push(base + t);
    }
    const lpos: number[] = [];
    const meta = new Int32Array(this.lines.length * LINE_STRIDE);
    const wayId = new Float64Array(this.lines.length);
    this.lines.forEach((l, i) => {
      const m = l.meta.slice();
      m[7] = lpos.length / 2;
      m[8] = l.pts.length / 2;
      meta.set(m, i * LINE_STRIDE);
      wayId[i] = l.wayId;
      for (const v of l.pts) lpos.push(v);
    });
    return encodeChunk({
      lod: this.lod,
      cx: this.cx,
      cy: this.cy,
      size: this.size,
      scale: this.scale,
      strings: [...this.strings.keys()],
      points: this.points,
      land: packAreas(this.land),
      water: packAreas(this.water),
      buildings: { pos: Int16Array.from(bpos), idx: Uint32Array.from(bidx), ring: Uint32Array.from(ring), height: Uint8Array.from(height) },
      lines: { pos: Int16Array.from(lpos), meta, wayId },
    });
  }
}

function clamp16(v: number) {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}

interface Feature {
  t: 'a' | 'b' | 'l' | 'p';
  id: number;
  k?: number;
  c?: number;
  f?: number;
  layer?: number;
  lanes?: number;
  ms?: number;
  w?: number;
  h?: number;
  rings?: Flat[];
  pts?: Flat;
  x?: number;
  y?: number;
  sub?: string;
  name?: string;
  nameBn?: string;
  area?: number;
}

/** Level-of-detail settings. LOD0 = full detail; LOD1/2 for zoomed-out views and the minimap. */
interface LodSpec {
  lod: number;
  size: number;
  scale: number;
  lineMargin: number;
  tol: { bld: number; area: number; water: number; line: number };
  minArea: number; // m², land polygons
  minWater: number; // m², water polygons
  minBuilding: number; // m², Infinity = no buildings
  minRoad: RoadClass;
  minWaterway: WaterwayClass;
  rail: boolean;
  barriers: boolean;
  points: (k: number, sub: string) => boolean;
}

const LODS: LodSpec[] = [
  {
    lod: 0, size: CHUNK_SIZE[0], scale: 10, lineMargin: 24,
    tol: { bld: 0.25, area: 0.5, water: 0.8, line: 0.35 },
    minArea: 0, minWater: 0, minBuilding: 0, minRoad: RoadClass.Path, minWaterway: WaterwayClass.Drain,
    rail: true, barriers: true, points: () => true,
  },
  {
    lod: 1, size: CHUNK_SIZE[1], scale: 10, lineMargin: 60,
    tol: { bld: 1.2, area: 3, water: 2.5, line: 2 },
    minArea: 2500, minWater: 600, minBuilding: 300, minRoad: RoadClass.Residential, minWaterway: WaterwayClass.Canal,
    rail: true, barriers: false,
    points: (k, sub) => k === PointKind.Station || k === PointKind.Landmark || (k === PointKind.Place && sub !== 'house'),
  },
  {
    lod: 2, size: CHUNK_SIZE[2], scale: 2, lineMargin: 150,
    tol: { bld: 5, area: 10, water: 8, line: 8 },
    minArea: 60000, minWater: 8000, minBuilding: Infinity, minRoad: RoadClass.Secondary, minWaterway: WaterwayClass.River,
    rail: true, barriers: false,
    points: (k, sub) => k === PointKind.Place && ['city', 'town', 'suburb', 'quarter'].includes(sub),
  },
];

/** Searchable named places for the place-search / teleport UI. */
interface PlaceEntry {
  n: string;
  b?: string;
  k: string;
  x: number;
  y: number;
}

export async function buildChunks(bboxName: string, bbox: BBox) {
  const t0 = Date.now();
  const [bx0, by0] = project(bbox.minLon, bbox.maxLat);
  const [bx1, by1] = project(bbox.maxLon, bbox.minLat);
  const index: WorldIndex = {
    version: 1,
    generated: new Date().toISOString(),
    source: '© OpenStreetMap contributors (ODbL), Geofabrik Bangladesh extract',
    bboxName,
    bbox,
    bounds: { minX: bx0, minY: by0, maxX: bx1, maxY: by1 },
    projection: { type: 'equirectangular', lat0: LAT0, lon0: LON0 },
    lods: [],
    counts: {},
  };
  const places = new Map<string, PlaceEntry>();
  for (const spec of LODS) {
    const r = await buildLod(spec, bboxName, bx0, by0, bx1, by1, spec.lod === 0 ? places : null);
    index.lods.push({ lod: spec.lod, size: spec.size, chunks: r.chunks });
    if (spec.lod === 0) index.counts = r.counts;
  }
  writeFileSync(join(PUBLIC_DATA, 'index.json'), JSON.stringify(index));
  const placeList = [...places.values()];
  writeFileSync(join(PUBLIC_DATA, 'places.json'), JSON.stringify(placeList));
  console.log(`  places.json: ${placeList.length} searchable names (${((Date.now() - t0) / 1000).toFixed(1)}s total)`);
  return index;
}

async function buildLod(
  spec: LodSpec,
  bboxName: string,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
  places: Map<string, PlaceEntry> | null,
) {
  const t0 = Date.now();
  const { lod, size, lineMargin: M } = spec;
  const cx0 = Math.floor(bx0 / size);
  const cx1 = Math.floor(bx1 / size);
  const cy0 = Math.floor(by0 / size);
  const cy1 = Math.floor(by1 / size);
  const chunks = new Map<string, ChunkBuilder>();
  const get = (cx: number, cy: number) => {
    if (cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1) return null;
    const key = `${cx},${cy}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = new ChunkBuilder(lod, cx, cy, size, spec.scale)));
    return c;
  };
  const inBounds = (x: number, y: number) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
  const addPlace = (name: string | undefined, nameBn: string | undefined, kind: string, x: number, y: number, prio: number) => {
    if (!places || !(name || nameBn) || !inBounds(x, y)) return;
    const key = `${(name || nameBn)!.toLowerCase()}|${kind}`;
    const prev = places.get(key);
    // keep the first occurrence, except places which prefer larger features
    if (prev && prio <= 0) return;
    places.set(key, { n: name || nameBn!, b: nameBn && nameBn !== name ? nameBn : undefined, k: kind, x: Math.round(x), y: Math.round(y) });
  };
  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  const rl = createInterface({ input: createReadStream(join(workDir(bboxName), 'features.ndjson')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const f = JSON.parse(line) as Feature;
    if (f.t === 'b') {
      if (spec.minBuilding === Infinity) continue;
      const rings = f.rings!.map((r) => simplifyRing(r, spec.tol.bld)).filter((r) => r.length >= 6);
      if (!rings.length) continue;
      if (spec.minBuilding > 0 && Math.abs(signedArea(rings[0])) < spec.minBuilding) continue;
      const [cx, cy] = centroid(rings[0]);
      const c = get(Math.floor(cx / size), Math.floor(cy / size));
      if (!c) continue;
      c.addBuilding(lod > 0 ? [rings[0]] : rings, f.h ?? 10);
      count('buildings');
    } else if (f.t === 'a') {
      const water = f.k === AreaKind.Water;
      const rings = f.rings!.map((r) => simplifyRing(r, water ? spec.tol.water : spec.tol.area)).filter((r) => r.length >= 6);
      if (!rings.length) continue;
      const area = Math.abs(signedArea(rings[0]));
      if (area < (water ? spec.minWater : spec.minArea)) continue;
      const [x0, y0, x1, y1] = bboxOf(rings[0]);
      let any = false;
      for (let cy = Math.floor(y0 / size); cy <= Math.floor(y1 / size); cy++)
        for (let cx = Math.floor(x0 / size); cx <= Math.floor(x1 / size); cx++) {
          const c = get(cx, cy);
          if (!c) continue;
          const ox = cx * size;
          const oy = cy * size;
          const inside = x0 >= ox && x1 <= ox + size && y0 >= oy && y1 <= oy + size;
          const clipped = inside ? rings : rings.map((r) => clipRing(r, ox, oy, ox + size, oy + size));
          if (!clipped.length || clipped[0].length < 6) continue;
          c.addArea(f.k!, clipped.filter((r) => r.length >= 6));
          any = true;
        }
      if (any) count(water ? 'water' : 'landuse');
    } else if (f.t === 'l') {
      if (f.k === LineKind.Road && (f.c ?? 0) < spec.minRoad) continue;
      if (f.k === LineKind.Waterway && (f.c ?? 0) < spec.minWaterway) continue;
      if (f.k === LineKind.Barrier && !spec.barriers) continue;
      if ((f.k === LineKind.Rail || f.k === LineKind.Metro) && !spec.rail) continue;
      const pts = simplify(f.pts!, spec.tol.line);
      const [x0, y0, x1, y1] = bboxOf(pts);
      if (f.k === LineKind.Road && f.name && (f.c ?? 0) >= RoadClass.Service) {
        const mid = Math.floor(pts.length / 4) * 2;
        addPlace(f.name, f.nameBn, 'road', pts[mid], pts[mid + 1], 0);
      }
      let any = false;
      for (let cy = Math.floor((y0 - M) / size); cy <= Math.floor((y1 + M) / size); cy++)
        for (let cx = Math.floor((x0 - M) / size); cx <= Math.floor((x1 + M) / size); cx++) {
          const c = get(cx, cy);
          if (!c) continue;
          const ox = cx * size;
          const oy = cy * size;
          const pieces = clipLine(pts, ox - M, oy - M, ox + size + M, oy + size + M);
          for (const p of pieces) {
            const meta = [
              f.k!, f.c ?? 0, f.f ?? 0, f.layer ?? 0, f.lanes ?? 0, c.str(f.name), c.str(f.nameBn), 0, 0,
              Math.round(p.start * 10), Math.round(f.ms ?? 0), f.w ?? 0,
            ];
            c.addLine(meta, p.pts, f.id);
            any = true;
          }
        }
      if (any) count(lineLabel(f.k!));
    } else if (f.t === 'p') {
      const kindName = PointKind[f.k!] ?? String(f.k);
      if (f.k === PointKind.Place) addPlace(f.name, f.nameBn, f.sub ?? 'place', f.x!, f.y!, 1);
      else if (f.k === PointKind.Landmark || f.k === PointKind.Station || f.k === PointKind.BusStop || (f.k === PointKind.Poi && (f.area ?? 0) > 2000))
        addPlace(f.name, f.nameBn, kindName.toLowerCase(), f.x!, f.y!, 0);
      if (!spec.points(f.k!, f.sub ?? '')) continue;
      const c = get(Math.floor(f.x! / size), Math.floor(f.y! / size));
      if (!c) continue;
      c.points.push(
        f.k!, c.str(f.sub), Math.round((f.x! - c.ox) * c.scale), Math.round((f.y! - c.oy) * c.scale), c.str(f.name), c.str(f.nameBn),
      );
      count(`points:${kindName}`);
    }
  }

  const outDir = join(PUBLIC_DATA, `lod${lod}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const written: Record<string, number> = {};
  let total = 0;
  for (const [key, c] of chunks) {
    if (c.empty()) continue;
    const gz = gzipSync(c.encode(), { level: 9 });
    writeFileSync(join(outDir, `${c.cx}_${c.cy}.dbc`), gz);
    written[key] = gz.length;
    total += gz.length;
  }
  console.log(
    `  lod${lod}: ${Object.keys(written).length} chunks of ${size} m, ${(total / 1e6).toFixed(2)} MB gz (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  return { chunks: written, counts };
}

function lineLabel(k: number): string {
  switch (k) {
    case LineKind.Road:
      return 'roads';
    case LineKind.Rail:
      return 'railway';
    case LineKind.Metro:
      return 'metro';
    case LineKind.Waterway:
      return 'waterways';
    case LineKind.Runway:
      return 'runways';
    default:
      return 'barriers';
  }
}
