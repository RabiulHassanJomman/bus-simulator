// Step 5: build playable routes (public/data/routes.json + docs/ROUTES.md).
// Each configured stop is snapped to the matching OSM bus stop; consecutive stops are joined
// with the road-graph router. Candidate graph nodes per stop are chosen with a Viterbi pass so
// the bus uses the correct carriageway of divided roads and never U-turns at a stop.
import { readFileSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeGraph, NF_MAIN, type RoadGraph } from '../src/shared/graph';
import { PROFILES, Router, type Route } from '../src/game/Router';
import { project, unproject } from '../src/shared/geo';
import { PointKind, RoadClass } from '../src/shared/kinds';
import type { RouteData, RouteDirection, RouteStop } from '../src/shared/routes';
import { simplify } from './lib/geom';
import { ROUTES, type StopSpec } from './routes.config';
import { PUBLIC_DATA, ROOT, workDir } from './config';

interface NamedPoint {
  id: number;
  kind: number;
  name: string;
  nameBn: string;
  x: number;
  y: number;
}

const UTURN_PENALTY = 240; // seconds

export async function buildRoutes(bboxName: string) {
  const t0 = Date.now();
  const raw = gunzipSync(readFileSync(join(PUBLIC_DATA, 'graph.dgz')));
  const g = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  const router = new Router(g);
  const points: NamedPoint[] = [];
  const rl = createInterface({ input: createReadStream(join(workDir(bboxName), 'features.ndjson')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith('{"t":"p"')) continue;
    const f = JSON.parse(line);
    if (!(f.name || f.nameBn)) continue;
    if (![PointKind.BusStop, PointKind.Place, PointKind.Station, PointKind.Landmark, PointKind.Poi].includes(f.k)) continue;
    points.push({ id: f.id, kind: f.k, name: f.name ?? '', nameBn: f.nameBn ?? '', x: f.x, y: f.y });
  }

  const report: string[] = [];
  const out: RouteData[] = [];
  for (const spec of ROUTES) {
    const dirs: RouteDirection[] = [];
    for (const reverse of [false, true]) {
      const stops = reverse ? [...spec.stops].reverse() : spec.stops;
      const resolved = stops.map((s) => resolveStop(s, points));
      const legs = viterbi(g, router, resolved.map((r) => candidates(g, router, r.x, r.y)));
      if (!legs) throw new Error(`no route for ${spec.id}${reverse ? ' (reverse)' : ''}`);
      const line = buildLine(g, legs);
      const placed = placeStops(resolved, line);
      const length = cumulative(line).at(-1)!;
      dirs.push({ from: stops[0].name, to: stops[stops.length - 1].name, stops: placed, line: line.map((v) => Math.round(v * 10) / 10), length: Math.round(length) });
      if (!reverse) {
        report.push(`\n## ${spec.name} (${spec.nameBn})\n`);
        report.push(`Via ${spec.via}. Length ${(length / 1000).toFixed(1)} km (reverse direction ${'{REV}'} km). Unlock: ${spec.unlock ? `৳${spec.unlock.toLocaleString('en-IN')}` : 'free'}.\n`);
        report.push('| # | Stop | বাংলা | Matched | At (km) | Lat, Lon |');
        report.push('|---|---|---|---|---|---|');
        placed.forEach((st, i) => {
          const [lon, lat] = unproject(st.x, st.y);
          const m = st.match === 'osm-stop' ? `OSM bus stop [${st.osm}](https://www.openstreetmap.org/node/${st.osm})` : st.match === 'osm-place' ? `OSM place [${st.osm}](https://www.openstreetmap.org/node/${st.osm})` : 'manual position';
          report.push(`| ${i + 1} | ${st.name} | ${st.nameBn} | ${m} | ${(st.s / 1000).toFixed(2)} | ${lat.toFixed(5)}, ${lon.toFixed(5)} |`);
        });
      } else {
        const i = report.findIndex((l) => l.includes('{REV}'));
        report[i] = report[i].replace('{REV}', (length / 1000).toFixed(1));
      }
    }
    out.push({ id: spec.id, name: spec.name, nameBn: spec.nameBn, via: spec.via, color: spec.color, unlock: spec.unlock, demand: spec.demand, dirs: dirs as [RouteDirection, RouteDirection] });
    const d = dirs[0];
    console.log(`  ${spec.name.padEnd(26)} ${(d.length / 1000).toFixed(1).padStart(5)} km / ${(dirs[1].length / 1000).toFixed(1).padStart(5)} km, ${d.stops.length} stops, ${d.stops.filter((s) => s.match === 'osm-stop').length} matched to OSM bus stops`);
  }
  writeFileSync(join(PUBLIC_DATA, 'routes.json'), JSON.stringify(out));
  writeFileSync(join(ROOT, 'docs/ROUTES.md'), routesDoc(report));
  console.log(`  routes.json written (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return out;
}

interface Resolved {
  spec: StopSpec;
  x: number;
  y: number;
  match: RouteStop['match'];
  osm?: number;
}

function resolveStop(spec: StopSpec, points: NamedPoint[]): Resolved {
  const [sx, sy] = project(spec.lon, spec.lat);
  let best: NamedPoint | null = null;
  let bd = Infinity;
  for (const kindPass of [[PointKind.BusStop], [PointKind.Place, PointKind.Station, PointKind.Landmark, PointKind.Poi]]) {
    for (const p of points) {
      if (!kindPass.includes(p.kind)) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d > 450 || d >= bd) continue;
      if (spec.match.test(p.name) || spec.match.test(p.nameBn)) {
        best = p;
        bd = d;
      }
    }
    if (best) break;
  }
  if (!best) return { spec, x: sx, y: sy, match: 'manual' };
  return { spec, x: best.x, y: best.y, match: best.kind === PointKind.BusStop ? 'osm-stop' : 'osm-place', osm: best.id };
}

/** Graph nodes near a stop the bus could start/end a leg at: on main roads where possible. */
function candidates(g: RoadGraph, router: Router, x: number, y: number): number[] {
  let c: number[] = [];
  for (const minCls of [RoadClass.Tertiary, RoadClass.Residential]) {
    const list: Array<[number, number]> = [];
    for (let n = 0; n < g.nodeX.length; n++) {
      if (!(g.nodeFlags[n] & NF_MAIN)) continue;
      const d = Math.hypot(g.nodeX[n] - x, g.nodeY[n] - y);
      if (d > 220) continue;
      let ok = false;
      for (let k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) {
        const e = g.adjEdge[k];
        if (PROFILES.bus.allow(g, e) && g.edgeCls[e] >= minCls && g.edgeCls[e] !== RoadClass.Link && g.edgeLevel[e] === 0) ok = true;
      }
      if (ok) list.push([d, n]);
    }
    list.sort((a, b) => a[0] - b[0]);
    c = list.slice(0, 12).map((v) => v[1]);
    if (c.length) break;
  }
  if (!c.length) {
    const n = router.nearestNode(x, y, 800, PROFILES.bus);
    if (n >= 0) c.push(n);
  }
  return c;
}

/** Choose one node per stop minimising total travel time incl. U-turn penalties. */
function viterbi(g: RoadGraph, router: Router, cands: number[][]): Route[] | null {
  type St = { cost: number; legs: Route[]; lastEdge: number };
  let layer = new Map<number, St>(cands[0].map((n) => [n, { cost: 0, legs: [], lastEdge: -1 }]));
  for (let i = 1; i < cands.length; i++) {
    const next = new Map<number, St>();
    for (const b of cands[i]) {
      for (const [a, st] of layer) {
        const r = router.route(a, b, PROFILES.bus);
        if (!r) continue;
        let cost = st.cost + r.time + Math.hypot(g.nodeX[b] - g.nodeX[cands[i][0]], g.nodeY[b] - g.nodeY[cands[i][0]]) * 0.2;
        if (r.edges.length && st.lastEdge === r.edges[0]) cost += UTURN_PENALTY;
        const prev = next.get(b);
        if (!prev || cost < prev.cost) next.set(b, { cost, legs: [...st.legs, r], lastEdge: r.edges.at(-1) ?? st.lastEdge });
      }
    }
    if (!next.size) return null;
    layer = next;
  }
  let best: St | null = null;
  for (const st of layer.values()) if (!best || st.cost < best.cost) best = st;
  return best?.legs ?? null;
}

function buildLine(g: RoadGraph, legs: Route[]): number[] {
  const pts: number[] = [];
  for (const leg of legs)
    leg.edges.forEach((e, i) => {
      const s = g.geoStart[e];
      const n = g.geoCount[e];
      const seq: number[] = [];
      for (let k = 0; k < n; k++) {
        const j = leg.dirs[i] === 1 ? k : n - 1 - k;
        seq.push(g.geo[(s + j) * 2], g.geo[(s + j) * 2 + 1]);
      }
      const start = pts.length >= 2 && Math.hypot(pts[pts.length - 2] - seq[0], pts[pts.length - 1] - seq[1]) < 0.5 ? 2 : 0;
      for (let k = start; k < seq.length; k++) pts.push(seq[k]);
    });
  return simplify(pts, 0.8);
}

function cumulative(line: number[]): number[] {
  const c = [0];
  for (let i = 2; i < line.length; i += 2) c.push(c[c.length - 1] + Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]));
  return c;
}

/** Project stops onto the line in order (monotonic s). */
function placeStops(stops: Resolved[], line: number[]): RouteStop[] {
  const cum = cumulative(line);
  const out: RouteStop[] = [];
  let sMin = 0;
  for (const st of stops) {
    let best = Infinity;
    let bs = sMin;
    let bx = 0;
    let by = 0;
    let tx = 1;
    let ty = 0;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const k = i / 2;
      if (cum[k + 1] < sMin - 5) continue;
      const ax = line[i];
      const ay = line[i + 1];
      const dx = line[i + 2] - ax;
      const dy = line[i + 3] - ay;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((st.x - ax) * dx + (st.y - ay) * dy) / L2));
      const qx = ax + dx * t;
      const qy = ay + dy * t;
      const d = Math.hypot(st.x - qx, st.y - qy);
      // prefer the first good match going forward (routes can pass a place twice)
      if (d < best - 1) {
        best = d;
        bs = cum[k] + Math.sqrt(L2) * t;
        bx = qx;
        by = qy;
        const L = Math.sqrt(L2);
        tx = dx / L;
        ty = dy / L;
      }
    }
    sMin = bs + 10;
    // marker on the kerb (left, Bangladesh) unless the matched OSM stop is right beside the road
    const useOsm = st.match !== 'manual' && best < 25;
    out.push({
      name: st.spec.name,
      nameBn: st.spec.nameBn,
      x: Math.round((useOsm ? st.x : bx + ty * 7) * 10) / 10,
      y: Math.round((useOsm ? st.y : by - tx * 7) * 10) / 10,
      s: Math.round(bs),
      osm: st.osm,
      match: st.match,
    });
  }
  return out;
}

function routesDoc(report: string[]): string {
  return `# Bus routes

OpenStreetMap has almost no \`route=bus\` relations for Dhaka (the extract contains 3, all
incomplete), so the playable routes are built **semi-manually**, as allowed by the project spec:

1. \`tools/routes.config.ts\` lists each route as an ordered list of stops along a real Dhaka bus
   corridor, with an approximate coordinate and a name pattern (English and Bangla).
2. \`tools/routes.ts\` snaps every stop to the nearest OSM \`highway=bus_stop\` whose name matches
   (within 450 m); failing that, to a matching named place/landmark; failing that, the configured
   coordinate is used ("manual").
3. Consecutive stops are joined with the game's own road-graph router (bus profile: one-way streets
   and turn restrictions respected). A Viterbi pass over candidate graph nodes near each stop picks
   the correct carriageway of divided roads and avoids U-turns at stops.
4. Both directions are routed separately (one-way streets differ), so lengths can differ.

The corridors and stop sequences follow well-known Dhaka city bus services (Mirpur–Motijheel,
Gabtoli–Sayedabad, Airport Road, Uttara–Sadarghat); exact stop lists of individual operators vary
and are simplified here.

**Fares** follow the BRTA city-bus rate: ৳${2.45}/km, minimum ৳10; students pay half (minimum ৳5).
Fares are charged by distance travelled between boarding and alighting stops.

Generated by \`npm run data:build\` — do not edit by hand.
${report.join('\n')}
`;
}
