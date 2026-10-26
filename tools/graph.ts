// Step 3: build the routable road graph (public/data/graph.dgz) from extracted features.
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { simplify } from './lib/geom';
import { encodeSections, GRAPH_MAGIC } from '../src/shared/format';
import { NF_CROSSING, NF_MAIN, NF_SIGNAL, type GraphMeta } from '../src/shared/graph';
import { LF_BRIDGE, LF_TUNNEL, LineKind, PointKind, RoadClass } from '../src/shared/kinds';
import { roadWidth } from '../src/shared/style';
import { PUBLIC_DATA, workDir } from './config';

const DEFAULT_SPEED: Record<number, number> = {
  [RoadClass.Motorway]: 80,
  [RoadClass.Trunk]: 60,
  [RoadClass.Primary]: 50,
  [RoadClass.Secondary]: 40,
  [RoadClass.Tertiary]: 35,
  [RoadClass.Link]: 35,
  [RoadClass.Unclassified]: 30,
  [RoadClass.Residential]: 25,
  [RoadClass.LivingStreet]: 15,
  [RoadClass.Service]: 15,
  [RoadClass.Track]: 15,
};

interface Way {
  id: number;
  cls: number;
  flags: number;
  layer: number;
  lanes: number;
  ms: number;
  w: number;
  name?: string;
  nameBn?: string;
  pts: number[];
  ids: number[];
}

export async function buildGraph(bboxName: string) {
  const t0 = Date.now();
  const ways: Way[] = [];
  const signals = new Set<number>();
  const crossings = new Set<number>();
  const rl = createInterface({ input: createReadStream(join(workDir(bboxName), 'features.ndjson')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.startsWith('{"t":"p"')) {
      const f = JSON.parse(line);
      if (f.k === PointKind.Signal) signals.add(f.id);
      else if (f.k === PointKind.Crossing) crossings.add(f.id);
      continue;
    }
    if (!line.startsWith('{"t":"l"')) continue;
    const f = JSON.parse(line);
    if (f.k !== LineKind.Road || f.c < RoadClass.Service || f.c === RoadClass.Pedestrian || f.f & LF_TUNNEL) continue;
    ways.push({ id: f.id, cls: f.c, flags: f.f, layer: f.layer, lanes: f.lanes, ms: f.ms, w: f.w, name: f.name, nameBn: f.nameBn, pts: f.pts, ids: f.ids });
  }

  // graph nodes: way ends, nodes shared by 2+ ways, signals
  const uses = new Map<number, number>();
  for (const w of ways) for (const id of w.ids) uses.set(id, (uses.get(id) ?? 0) + 1);
  const nodeIndex = new Map<number, number>();
  const nodeX: number[] = [];
  const nodeY: number[] = [];
  const nodeFlags: number[] = [];
  const nodeOf = (id: number, x: number, y: number) => {
    let n = nodeIndex.get(id);
    if (n === undefined) {
      n = nodeX.length;
      nodeIndex.set(id, n);
      nodeX.push(x);
      nodeY.push(y);
      nodeFlags.push((signals.has(id) ? NF_SIGNAL : 0) | (crossings.has(id) ? NF_CROSSING : 0));
    }
    return n;
  };

  const strings = new Map<string, number>();
  const str = (s?: string) => {
    if (!s) return -1;
    let i = strings.get(s);
    if (i === undefined) strings.set(s, (i = strings.size));
    return i;
  };
  const E = {
    a: [] as number[], b: [] as number[], len: [] as number[], cls: [] as number[], flags: [] as number[], level: [] as number[],
    lanes: [] as number[], hw: [] as number[], speed: [] as number[], name: [] as number[], nameBn: [] as number[],
    geoStart: [] as number[], geoCount: [] as number[],
  };
  const geo: number[] = [];
  const edgesOfWay = new Map<number, number[]>();

  for (const w of ways) {
    const n = w.ids.length;
    let start = 0;
    for (let i = 1; i < n; i++) {
      const id = w.ids[i];
      const isNode = i === n - 1 || (uses.get(id) ?? 0) > 1 || signals.has(id) || crossings.has(id);
      if (!isNode) continue;
      const a = nodeOf(w.ids[start], w.pts[start * 2], w.pts[start * 2 + 1]);
      const b = nodeOf(id, w.pts[i * 2], w.pts[i * 2 + 1]);
      const seg = simplify(w.pts.slice(start * 2, i * 2 + 2), 0.5);
      let len = 0;
      for (let k = 0; k + 3 < seg.length; k += 2) len += Math.hypot(seg[k + 2] - seg[k], seg[k + 3] - seg[k + 1]);
      start = i;
      if (a === b || len < 0.5) continue;
      const e = E.a.length;
      E.a.push(a);
      E.b.push(b);
      E.len.push(len);
      E.cls.push(w.cls);
      E.flags.push(w.flags);
      E.level.push(w.flags & LF_BRIDGE && w.layer > 0 ? w.layer : 0);
      E.lanes.push(w.lanes);
      E.hw.push(roadWidth(w.cls, w.lanes, w.flags, w.w) / 2);
      E.speed.push(Math.min(120, w.ms > 0 ? w.ms : DEFAULT_SPEED[w.cls] ?? 25));
      E.name.push(str(w.name));
      E.nameBn.push(str(w.nameBn));
      E.geoStart.push(geo.length / 2);
      E.geoCount.push(seg.length / 2);
      for (const v of seg) geo.push(Math.round(v * 10) / 10);
      let list = edgesOfWay.get(w.id);
      if (!list) edgesOfWay.set(w.id, (list = []));
      list.push(e);
    }
  }
  const nNodes = nodeX.length;
  const nEdges = E.a.length;

  // CSR adjacency
  const deg = new Uint32Array(nNodes + 1);
  for (let e = 0; e < nEdges; e++) {
    deg[E.a[e]]++;
    deg[E.b[e]]++;
  }
  const adjStart = new Uint32Array(nNodes + 1);
  for (let i = 0; i < nNodes; i++) adjStart[i + 1] = adjStart[i] + deg[i];
  const fill = adjStart.slice(0, nNodes);
  const adjEdge = new Uint32Array(adjStart[nNodes]);
  for (let e = 0; e < nEdges; e++) {
    adjEdge[fill[E.a[e]]++] = e;
    adjEdge[fill[E.b[e]]++] = e;
  }

  // largest weakly connected component → NF_MAIN
  const comp = new Int32Array(nNodes).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < nNodes; s++) {
    if (comp[s] >= 0) continue;
    const c = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = c;
    while (stack.length) {
      const n = stack.pop()!;
      size++;
      for (let k = adjStart[n]; k < adjStart[n + 1]; k++) {
        const e = adjEdge[k];
        const m = E.a[e] === n ? E.b[e] : E.a[e];
        if (comp[m] < 0) {
          comp[m] = c;
          stack.push(m);
        }
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  for (let n = 0; n < nNodes; n++) if (comp[n] === main) nodeFlags[n] |= NF_MAIN;

  // turn restrictions with a via node
  const restrictions = JSON.parse(readFileSync(join(workDir(bboxName), 'restrictions.json'), 'utf8')) as Array<{
    restriction?: string;
    from?: number;
    to?: number;
    via?: { type: string; ref: number };
  }>;
  const banned: number[] = [];
  const only: GraphMeta['only'] = [];
  let usedRestrictions = 0;
  for (const r of restrictions) {
    if (!r.restriction || !r.from || !r.to || r.via?.type !== 'n') continue;
    const via = nodeIndex.get(r.via.ref);
    if (via === undefined) continue;
    const touching = (wayId: number) => (edgesOfWay.get(wayId) ?? []).find((e) => E.a[e] === via || E.b[e] === via);
    const fe = touching(r.from);
    const te = touching(r.to);
    if (fe === undefined || te === undefined) continue;
    if (r.restriction.startsWith('no_')) banned.push(fe, te);
    else if (r.restriction.startsWith('only_')) only.push([fe, via, te]);
    else continue;
    usedRestrictions++;
  }

  const meta: GraphMeta = {
    nodes: nNodes,
    edges: nEdges,
    names: [...strings.keys()],
    namesBn: [],
    only,
  };
  // node positions, edge lengths, geoStart and adjacency are derived on load (smaller file)
  const buf = encodeSections(GRAPH_MAGIC, meta, {
    nodeFlags: Uint8Array.from(nodeFlags),
    edgeA: Uint32Array.from(E.a),
    edgeB: Uint32Array.from(E.b),
    edgeCls: Uint8Array.from(E.cls),
    edgeFlags: Uint8Array.from(E.flags),
    edgeLevel: Uint8Array.from(E.level),
    edgeLanes: Uint8Array.from(E.lanes),
    edgeHw: Uint8Array.from(E.hw, (v) => Math.min(255, Math.round(v * 10))),
    edgeSpeed: Uint8Array.from(E.speed),
    edgeName: Int32Array.from(E.name),
    edgeNameBn: Int32Array.from(E.nameBn),
    nodeX: Int32Array.from(nodeX, (v) => Math.round(v * 10)),
    nodeY: Int32Array.from(nodeY, (v) => Math.round(v * 10)),
    ...interiorGeo(geo, E.geoStart, E.geoCount),
    banned: Uint32Array.from(banned),
  });
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(join(PUBLIC_DATA, 'graph.dgz'), gz);
  const signalNodes = nodeFlags.filter((f) => f & NF_SIGNAL).length;
  console.log(
    `  graph: ${nNodes} nodes, ${nEdges} edges, ${signalNodes} signals, ${usedRestrictions} turn restrictions, ` +
      `main component ${((sizes[main] / nNodes) * 100).toFixed(1)}% — ${(gz.length / 1e6).toFixed(2)} MB gz (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  return { nodes: nNodes, edges: nEdges, signals: signalNodes, bytes: gz.length };
}

/**
 * Edge geometry without its endpoints (they are the edge's nodes): interior points as Int16
 * decimetre deltas from the previous point, starting at node A. Long segments are subdivided
 * so every delta fits.
 */
function interiorGeo(geo: number[], start: number[], count: number[]) {
  const inner: number[] = [];
  const innerCount: number[] = [];
  for (let e = 0; e < start.length; e++) {
    const pts: number[] = [];
    for (let k = 0; k < count[e]; k++) pts.push(Math.round(geo[(start[e] + k) * 2] * 10), Math.round(geo[(start[e] + k) * 2 + 1] * 10));
    // subdivide long segments
    const dense: number[] = [pts[0], pts[1]];
    for (let k = 2; k < pts.length; k += 2) {
      const dx = pts[k] - pts[k - 2];
      const dy = pts[k + 1] - pts[k - 1];
      const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 30000);
      for (let j = 1; j < n; j++) dense.push(Math.round(pts[k - 2] + (dx * j) / n), Math.round(pts[k - 1] + (dy * j) / n));
      dense.push(pts[k], pts[k + 1]);
    }
    let px = dense[0];
    let py = dense[1];
    let c = 0;
    for (let k = 2; k < dense.length - 2; k += 2) {
      inner.push(dense[k] - px, dense[k + 1] - py);
      px = dense[k];
      py = dense[k + 1];
      c++;
    }
    innerCount.push(c);
  }
  return { geoInner: Int16Array.from(inner), geoInnerCount: Uint16Array_from(innerCount) };
}

function Uint16Array_from(a: number[]) {
  // stored as Uint8 when possible (most edges have < 255 interior points)
  return a.every((v) => v < 255) ? Uint8Array.from(a) : Uint32Array.from(a);
}
