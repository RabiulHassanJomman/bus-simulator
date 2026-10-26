// Routable road graph shared by the pipeline (encode), the game and tests (decode).
// Nodes are OSM junctions, way ends and traffic-signal nodes; edges are the road pieces
// between them with simplified geometry. Coordinates in world metres.
import { decodeSections, GRAPH_MAGIC } from './format';

export const NF_SIGNAL = 1;
export const NF_CROSSING = 2;
/** node belongs to the largest connected component (safe for routing endpoints) */
export const NF_MAIN = 4;

export interface GraphMeta {
  nodes: number;
  edges: number;
  names: string[];
  namesBn: string[];
  /** [fromEdge, viaNode, toEdge] for "only_*" restrictions */
  only: Array<[number, number, number]>;
}

export interface RoadGraph {
  nodeX: Float32Array;
  nodeY: Float32Array;
  nodeFlags: Uint8Array;
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  edgeLen: Float32Array;
  edgeCls: Uint8Array;
  /** LF_* line flags (oneway, bridge, roundabout) */
  edgeFlags: Uint8Array;
  /** elevation level: > 0 on flyover decks */
  edgeLevel: Uint8Array;
  edgeLanes: Uint8Array;
  /** half carriageway width, metres */
  edgeHw: Float32Array;
  /** speed limit, km/h */
  edgeSpeed: Uint8Array;
  edgeName: Int32Array;
  edgeNameBn: Int32Array;
  geoStart: Uint32Array;
  geoCount: Uint32Array;
  /** xy pairs; edge geometry runs from node A to node B */
  geo: Float32Array;
  adjStart: Uint32Array;
  adjEdge: Uint32Array;
  /** banned turn keys: from * 2^21 + to */
  banned: Set<number>;
  /** only-turns: key from * 2^21 + via -> required to-edge */
  only: Map<number, number>;
  names: string[];
  namesBn: string[];
}

export const turnKey = (a: number, b: number) => a * 2097152 + b;

export function decodeGraph(buf: ArrayBuffer): RoadGraph {
  const { meta, get } = decodeSections<GraphMeta>(buf, GRAPH_MAGIC);
  const bannedArr = get<Uint32Array>('banned');
  const banned = new Set<number>();
  for (let i = 0; i < bannedArr.length; i += 2) banned.add(turnKey(bannedArr[i], bannedArr[i + 1]));
  const only = new Map<number, number>();
  for (const [f, v, t] of meta.only) only.set(turnKey(f, v), t);

  const edgeA = get<Uint32Array>('edgeA');
  const edgeB = get<Uint32Array>('edgeB');
  const nE = edgeA.length;
  const nN = meta.nodes;
  const nodeX = Float32Array.from(get<Int32Array>('nodeX'), (v) => v / 10);
  const nodeY = Float32Array.from(get<Int32Array>('nodeY'), (v) => v / 10);
  // geometry: node A, interior points as Int16 decimetre deltas, node B
  const inner = get<Int16Array>('geoInner');
  const innerCount = get<Uint8Array | Uint32Array>('geoInnerCount');
  const geoStart = new Uint32Array(nE);
  const geoCount = new Uint32Array(nE);
  const geo = new Float32Array((inner.length / 2 + nE * 2) * 2);
  const edgeLen = new Float32Array(nE);
  let p = 0; // output point index
  let q = 0; // input interior point index
  for (let e = 0; e < nE; e++) {
    geoStart[e] = p;
    const a = edgeA[e];
    let x = Math.round(nodeX[a] * 10);
    let y = Math.round(nodeY[a] * 10);
    geo[p * 2] = nodeX[a];
    geo[p * 2 + 1] = nodeY[a];
    p++;
    let len = 0;
    for (let k = 0; k < innerCount[e]; k++, q++) {
      const nx = x + inner[q * 2];
      const ny = y + inner[q * 2 + 1];
      len += Math.hypot(nx - x, ny - y) / 10;
      x = nx;
      y = ny;
      geo[p * 2] = x / 10;
      geo[p * 2 + 1] = y / 10;
      p++;
    }
    const b = edgeB[e];
    len += Math.hypot(nodeX[b] - x / 10, nodeY[b] - y / 10);
    geo[p * 2] = nodeX[b];
    geo[p * 2 + 1] = nodeY[b];
    p++;
    geoCount[e] = p - geoStart[e];
    edgeLen[e] = len;
  }
  // CSR adjacency
  const adjStart = new Uint32Array(nN + 1);
  for (let e = 0; e < nE; e++) {
    adjStart[edgeA[e] + 1]++;
    adjStart[edgeB[e] + 1]++;
  }
  for (let i = 0; i < nN; i++) adjStart[i + 1] += adjStart[i];
  const fill = adjStart.slice(0, nN);
  const adjEdge = new Uint32Array(adjStart[nN]);
  for (let e = 0; e < nE; e++) {
    adjEdge[fill[edgeA[e]]++] = e;
    adjEdge[fill[edgeB[e]]++] = e;
  }
  return {
    nodeX,
    nodeY,
    nodeFlags: get('nodeFlags'),
    edgeA,
    edgeB,
    edgeLen,
    edgeCls: get('edgeCls'),
    edgeFlags: get('edgeFlags'),
    edgeLevel: get('edgeLevel'),
    edgeLanes: get('edgeLanes'),
    edgeHw: Float32Array.from(get<Uint8Array>('edgeHw'), (v) => v / 10),
    edgeSpeed: get('edgeSpeed'),
    edgeName: get('edgeName'),
    edgeNameBn: get('edgeNameBn'),
    geoStart,
    geoCount,
    geo,
    adjStart,
    adjEdge,
    banned,
    only,
    names: meta.names,
    namesBn: meta.names, // one string table for both columns
  };
}

/** Other end of edge e from node n. */
export const otherEnd = (g: RoadGraph, e: number, n: number) => (g.edgeA[e] === n ? g.edgeB[e] : g.edgeA[e]);
