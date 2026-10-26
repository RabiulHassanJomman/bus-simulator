// Step 1: OSM PBF -> projected feature NDJSON for a bbox (data/work/<bbox>/).
//
// Pass 1 keeps nodes inside bbox+margin, every way touching them and the
// relations we care about. Passes 2/3 (only when needed) fetch multipolygon
// member ways and area nodes that lie outside the margin so large polygons
// (rivers, cantonment, airport) are complete before clipping.
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { readPbf, type Tags } from './lib/pbf';
import { assembleRings } from './lib/rings';
import { areaKind, buildingHeight, filterTags, isBuilding, isElevatedBuilding, lineClass, pointClass } from './lib/classify';
import { centroid, pointInRing, signedArea, type Flat } from './lib/geom';
import { project, type BBox } from '../src/shared/geo';
import { PointKind } from '../src/shared/kinds';
import { RAW_PBF, workDir } from './config';

const MARGIN_DEG = 0.012; // ~1.3 km

class NodeStore {
  ids = new Float64Array(1 << 20);
  lat = new Int32Array(1 << 20);
  lon = new Int32Array(1 << 20);
  n = 0;
  sorted = true;
  push(id: number, lat: number, lon: number) {
    if (this.n === this.ids.length) {
      const grow = <T extends Float64Array | Int32Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.ids = grow(this.ids);
      this.lat = grow(this.lat);
      this.lon = grow(this.lon);
    }
    if (this.n && id < this.ids[this.n - 1]) this.sorted = false;
    this.ids[this.n] = id;
    this.lat[this.n] = lat;
    this.lon[this.n] = lon;
    this.n++;
  }
  ensureSorted() {
    if (this.sorted) return;
    const order = Array.from({ length: this.n }, (_, i) => i).sort((a, b) => this.ids[a] - this.ids[b]);
    const ids = new Float64Array(this.n);
    const lat = new Int32Array(this.n);
    const lon = new Int32Array(this.n);
    order.forEach((o, i) => {
      ids[i] = this.ids[o];
      lat[i] = this.lat[o];
      lon[i] = this.lon[o];
    });
    this.ids = ids;
    this.lat = lat;
    this.lon = lon;
    this.sorted = true;
  }
  indexOf(id: number): number {
    let lo = 0;
    let hi = this.n - 1;
    const ids = this.ids;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = ids[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

interface StoredWay {
  refs: number[];
  tags: Tags | null;
}
interface StoredRel {
  id: number;
  tags: Tags;
  members: Array<{ type: 'n' | 'w' | 'r'; ref: number; role: string }>;
}

function isInterestingWay(t: Tags): boolean {
  return isBuilding(t) || areaKind(t) !== null || lineClass(t, false) !== null || !!t.name;
}

function isAreaRelation(t: Tags): boolean {
  return t.type === 'multipolygon' && (isBuilding(t) || areaKind(t) !== null);
}

export interface ExtractStats {
  nodes: number;
  ways: number;
  relations: number;
  features: Record<string, number>;
}

export function extract(bboxName: string, bbox: BBox, pbfPath = RAW_PBF): ExtractStats {
  const t0 = Date.now();
  const lat0 = Math.round((bbox.minLat - MARGIN_DEG) * 1e7);
  const lat1 = Math.round((bbox.maxLat + MARGIN_DEG) * 1e7);
  const lon0 = Math.round((bbox.minLon - MARGIN_DEG) * 1e7);
  const lon1 = Math.round((bbox.maxLon + MARGIN_DEG) * 1e7);

  const store = new NodeStore();
  const tagged: Array<{ id: number; lat: number; lon: number; tags: Tags }> = [];
  const ways = new Map<number, StoredWay>();
  const rels: StoredRel[] = [];
  const progress = (label: string) => (f: number) => {
    if (process.stdout.isTTY) process.stdout.write(`\r  ${label} ${(f * 100).toFixed(0)}%   `);
  };

  // ---- pass 1
  readPbf(
    pbfPath,
    {
      nodes(b) {
        for (let i = 0; i < b.ids.length; i++) {
          const la = b.lat[i];
          const lo = b.lon[i];
          if (la < lat0 || la > lat1 || lo < lon0 || lo > lon1) continue;
          store.push(b.ids[i], la, lo);
          const t = b.tags.get(i);
          if (t && (pointClass(t) || t.public_transport || t.highway)) tagged.push({ id: b.ids[i], lat: la, lon: lo, tags: t });
        }
      },
      ways(ws) {
        store.ensureSorted();
        for (const w of ws) {
          let hit = false;
          for (const r of w.refs)
            if (store.indexOf(r) >= 0) {
              hit = true;
              break;
            }
          if (!hit) continue;
          ways.set(w.id, { refs: w.refs, tags: isInterestingWay(w.tags) ? filterTags(w.tags) : null });
        }
      },
      relations(rs) {
        for (const r of rs) {
          const t = r.tags;
          if (isAreaRelation(t) || t.route === 'bus' || t.route_master === 'bus' || t.type === 'restriction') rels.push(r);
        }
      },
    },
    progress('pass 1/3'),
  );
  console.log(`\n  pass 1: ${store.n} nodes, ${ways.size} ways, ${rels.length} relations (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // ---- pass 2: missing multipolygon member ways
  const areaRels = rels.filter((r) => isAreaRelation(r.tags) && r.members.some((m) => m.type === 'w' && ways.has(m.ref)));
  const needWays = new Set<number>();
  for (const r of areaRels) for (const m of r.members) if (m.type === 'w' && !ways.has(m.ref)) needWays.add(m.ref);
  if (needWays.size) {
    readPbf(
      pbfPath,
      {
        wantTags: false,
        ways(ws) {
          for (const w of ws) if (needWays.has(w.id)) ways.set(w.id, { refs: w.refs, tags: null });
        },
      },
      progress('pass 2/3'),
    );
    console.log(`\n  pass 2: fetched ${needWays.size} outside member ways`);
  }

  // ---- pass 3: missing nodes of area ways (closed ways + multipolygon members)
  const memberOfArea = new Set<number>();
  for (const r of areaRels) for (const m of r.members) if (m.type === 'w') memberOfArea.add(m.ref);
  const needNodes = new Set<number>();
  for (const [id, w] of ways) {
    const closed = w.refs.length >= 4 && w.refs[0] === w.refs[w.refs.length - 1];
    const isArea = memberOfArea.has(id) || (closed && w.tags && (isBuilding(w.tags) || areaKind(w.tags) !== null));
    if (!isArea) continue;
    for (const r of w.refs) if (store.indexOf(r) < 0) needNodes.add(r);
  }
  const extra = new Map<number, [number, number]>();
  if (needNodes.size) {
    readPbf(
      pbfPath,
      {
        nodes(b) {
          for (let i = 0; i < b.ids.length; i++) if (needNodes.has(b.ids[i])) extra.set(b.ids[i], [b.lat[i], b.lon[i]]);
        },
      },
      progress('pass 3/3'),
    );
    console.log(`\n  pass 3: fetched ${extra.size}/${needNodes.size} outside nodes`);
  }

  const xy = (id: number): [number, number] | null => {
    const i = store.indexOf(id);
    if (i >= 0) return project(store.lon[i] / 1e7, store.lat[i] / 1e7);
    const e = extra.get(id);
    return e ? project(e[1] / 1e7, e[0] / 1e7) : null;
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const ringXY = (ids: number[]): Flat => {
    const out: Flat = [];
    for (const id of ids) {
      const p = xy(id);
      if (p) out.push(r1(p[0]), r1(p[1]));
    }
    return out;
  };

  // ---- write features
  const dir = workDir(bboxName);
  mkdirSync(dir, { recursive: true });
  const fd = openSync(join(dir, 'features.ndjson'), 'w');
  let buf: string[] = [];
  let bufLen = 0;
  const flushOut = () => {
    writeSync(fd, buf.join(''));
    buf = [];
    bufLen = 0;
  };
  const counts: Record<string, number> = {};
  const emit = (f: Record<string, unknown>, label: string) => {
    counts[label] = (counts[label] ?? 0) + 1;
    const s = JSON.stringify(f) + '\n';
    buf.push(s);
    bufLen += s.length;
    if (bufLen > 1 << 22) flushOut();
  };
  const names = (t: Tags) => ({
    name: t['name:en'] || t.name || undefined,
    nameBn: t['name:bn'] || (t.name && /[ঀ-৿]/.test(t.name) ? t.name : undefined),
  });
  const emitAreaPoint = (t: Tags, ring: Flat, id: number) => {
    if (!t.name) return;
    const pc = pointClass(t);
    const [cx, cy] = centroid(ring);
    emit(
      { t: 'p', id, k: pc?.kind ?? PointKind.Poi, sub: pc?.sub ?? 'area', x: r1(cx), y: r1(cy), area: Math.round(Math.abs(signedArea(ring))), ...names(t) },
      'point:area-label',
    );
  };

  for (const [id, w] of ways) {
    const t = w.tags;
    if (!t) continue;
    const closed = w.refs.length >= 4 && w.refs[0] === w.refs[w.refs.length - 1];
    if (closed && isBuilding(t)) {
      const ring = ringXY(w.refs.slice(0, -1));
      if (ring.length < 6) continue;
      emit({ t: 'b', id, h: Math.round(buildingHeight(t, id)), el: isElevatedBuilding(t) ? 1 : undefined, rings: [ring], name: t.name }, 'building');
      if (t.name && (t.amenity || t.tourism || t.historic || t.shop || t.railway || t.public_transport)) emitAreaPoint(t, ring, id);
      continue;
    }
    const ak = closed ? areaKind(t) : null;
    if (ak !== null) {
      const ring = ringXY(w.refs.slice(0, -1));
      if (ring.length >= 6) {
        emit({ t: 'a', id, k: ak, rings: [ring], ...names(t) }, `area:${ak}`);
        emitAreaPoint(t, ring, id);
      }
      continue;
    }
    const lc = lineClass(t, closed);
    if (lc) {
      // split at missing nodes
      let seg: number[] = [];
      let segIds: number[] = [];
      const flush = () => {
        if (seg.length >= 4) {
          let pts = seg;
          let ids = segIds;
          if (lc.reverse) {
            pts = [];
            for (let i = seg.length - 2; i >= 0; i -= 2) pts.push(seg[i], seg[i + 1]);
            ids = segIds.slice().reverse();
          }
          emit(
            {
              t: 'l', id, k: lc.kind, c: lc.cls, f: lc.flags, layer: lc.layer, lanes: lc.lanes, ms: lc.maxspeed, w: lc.widthDm,
              ref: t.ref, surface: t.surface, ...names(t), pts, ids,
            },
            `line:${lc.kind}:${lc.cls}`,
          );
        }
        seg = [];
        segIds = [];
      };
      for (const r of w.refs) {
        const p = xy(r);
        if (!p) {
          flush();
          continue;
        }
        seg.push(r1(p[0]), r1(p[1]));
        segIds.push(r);
      }
      flush();
    }
  }

  // multipolygon relations
  for (const r of areaRels) {
    const t = r.tags;
    const outerIds: number[][] = [];
    const innerIds: number[][] = [];
    for (const m of r.members) {
      if (m.type !== 'w') continue;
      const w = ways.get(m.ref);
      if (!w) continue;
      (m.role === 'inner' ? innerIds : outerIds).push(w.refs);
    }
    const outers = assembleRings(outerIds).map(ringXY).filter((x) => x.length >= 6);
    const inners = assembleRings(innerIds).map(ringXY).filter((x) => x.length >= 6);
    const groups = outers.map((o) => ({ o, holes: [] as Flat[] }));
    for (const h of inners) {
      const g = groups.find((g) => pointInRing(h[0], h[1], g.o));
      if (g) g.holes.push(h);
    }
    const building = isBuilding(t);
    const ak = building ? null : areaKind(t);
    for (const g of groups) {
      if (building) emit({ t: 'b', id: r.id, h: Math.round(buildingHeight(t, r.id)), el: isElevatedBuilding(t) ? 1 : undefined, rings: [g.o, ...g.holes], name: t.name }, 'building');
      else if (ak !== null) emit({ t: 'a', id: r.id, k: ak, rings: [g.o, ...g.holes], ...names(t) }, `area:${ak}`);
    }
    if (groups.length) emitAreaPoint(t, groups.sort((a, b) => Math.abs(signedArea(b.o)) - Math.abs(signedArea(a.o)))[0].o, r.id);
  }

  // points
  for (const n of tagged) {
    const pc = pointClass(n.tags);
    if (!pc) continue;
    const [x, y] = project(n.lon / 1e7, n.lat / 1e7);
    emit({ t: 'p', id: n.id, k: pc.kind, sub: pc.sub, x: r1(x), y: r1(y), ...names(n.tags) }, `point:${pc.kind}`);
  }
  flushOut();
  closeSync(fd);

  // bus routes + turn restrictions (consumed in later phases)
  const nodeInfo = new Map(tagged.map((n) => [n.id, n]));
  const routes = rels
    .filter((r) => r.tags.route === 'bus')
    .map((r) => ({
      id: r.id,
      tags: r.tags,
      ways: r.members.filter((m) => m.type === 'w').map((m) => ({ id: m.ref, role: m.role, present: ways.has(m.ref) })),
      stops: r.members
        .filter((m) => m.type === 'n')
        .map((m) => {
          const n = nodeInfo.get(m.ref);
          const p = n ? project(n.lon / 1e7, n.lat / 1e7) : null;
          return { id: m.ref, role: m.role, name: n?.tags.name, nameBn: n?.tags['name:bn'], x: p && r1(p[0]), y: p && r1(p[1]) };
        }),
    }));
  const restrictions = rels
    .filter((r) => r.tags.type === 'restriction')
    .map((r) => ({
      id: r.id,
      restriction: r.tags.restriction,
      from: r.members.find((m) => m.role === 'from')?.ref,
      via: r.members.find((m) => m.role === 'via'),
      to: r.members.find((m) => m.role === 'to')?.ref,
    }));
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(routes));
  writeFileSync(join(dir, 'restrictions.json'), JSON.stringify(restrictions));
  counts['route:bus'] = routes.length;
  counts['restriction'] = restrictions.length;
  writeFileSync(join(dir, 'extract-stats.json'), JSON.stringify({ bbox, counts, seconds: (Date.now() - t0) / 1000 }, null, 1));
  console.log(`  extract done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { nodes: store.n, ways: ways.size, relations: rels.length, features: counts };
}
