// Chunk container format ("DBC1"), shared by pipeline (encode) and game (decode).
//
//   [4]  magic "DBC1"
//   [4]  u32 LE jsonLength
//   [n]  UTF-8 JSON header (ChunkHeader)
//   pad to 8-byte boundary
//   [..] binary section blob; each typed array located by header.sections[name]
//
// The file on disk is gzip-compressed and served with a neutral extension (.dbc)
// so no server adds Content-Encoding; the client inflates via DecompressionStream.
//
// Coordinates are Int16 in 1/scale metres (decimetres at LOD0/1) relative to the
// chunk origin (cx*size, cy*size).

export const CHUNK_MAGIC = 0x31434244; // "DBC1" little-endian
export const COORD_SCALE = 10; // decimetres
/** building flag: stands above street level (no ground collision) */
export const BF_ELEVATED = 1;

/** Line meta record layout (Int32 stride). */
export const L_KIND = 0;
export const L_CLASS = 1;
export const L_FLAGS = 2;
export const L_LAYER = 3;
export const L_LANES = 4;
export const L_NAME = 5;
export const L_NAME_BN = 6;
export const L_PT_START = 7;
export const L_PT_COUNT = 8;
export const L_START_DIST = 9; // decimetres along the original way
export const L_MAXSPEED = 10;
export const L_WIDTH = 11; // decimetres, 0 = derive from class/lanes
export const LINE_STRIDE = 12;

/** Point record layout (stride in header.points). */
export const P_KIND = 0;
export const P_SUB = 1;
export const P_X = 2;
export const P_Y = 3;
export const P_NAME = 4;
export const P_NAME_BN = 5;
export const POINT_STRIDE = 6;

type ArrayKind = 'i16' | 'u8' | 'u32' | 'i32' | 'f32' | 'f64';

export interface ChunkHeader {
  v: 1;
  lod: number;
  cx: number;
  cy: number;
  size: number;
  /** coordinate units per metre (10 = decimetres) */
  scale?: number;
  strings: string[];
  /** Flat array, POINT_STRIDE per record. x/y in decimetres local. */
  points: number[];
  sections: Record<string, [offset: number, length: number, kind: ArrayKind]>;
}

export interface AreaSection {
  pos: Int16Array; // x,y pairs
  kind: Uint8Array; // per vertex AreaKind
  idx: Uint32Array;
}

export interface ChunkData {
  lod: number;
  cx: number;
  cy: number;
  size: number;
  scale: number;
  strings: string[];
  points: number[];
  land: AreaSection;
  water: AreaSection;
  buildings: {
    pos: Int16Array;
    idx: Uint32Array;
    /** per building: [vertexStart, outerRingLength] */
    ring: Uint32Array;
    /** per building height in metres (clamped to 255) */
    height: Uint8Array;
    /** per building flags: BF_ELEVATED */
    flags: Uint8Array;
  };
  lines: {
    pos: Int16Array;
    meta: Int32Array;
    wayId: Float64Array;
  };
}

const CTORS = {
  i16: Int16Array,
  u8: Uint8Array,
  u32: Uint32Array,
  i32: Int32Array,
  f32: Float32Array,
  f64: Float64Array,
} as const;

function kindOf(a: ArrayBufferView): ArrayKind {
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  throw new Error('unsupported array');
}

export function encodeChunk(c: ChunkData): Uint8Array {
  const arrays: Record<string, ArrayBufferView> = {
    'land.pos': c.land.pos,
    'land.kind': c.land.kind,
    'land.idx': c.land.idx,
    'water.pos': c.water.pos,
    'water.kind': c.water.kind,
    'water.idx': c.water.idx,
    'bld.pos': c.buildings.pos,
    'bld.idx': c.buildings.idx,
    'bld.ring': c.buildings.ring,
    'bld.height': c.buildings.height,
    'bld.flags': c.buildings.flags,
    'line.pos': c.lines.pos,
    'line.meta': c.lines.meta,
    'line.wayId': c.lines.wayId,
  };
  const sections: ChunkHeader['sections'] = {};
  let off = 0;
  for (const [name, a] of Object.entries(arrays)) {
    off = (off + 7) & ~7;
    sections[name] = [off, (a as Int16Array).length, kindOf(a)];
    off += a.byteLength;
  }
  const header: ChunkHeader = {
    v: 1,
    lod: c.lod,
    cx: c.cx,
    cy: c.cy,
    size: c.size,
    scale: c.scale,
    strings: c.strings,
    points: c.points,
    sections,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const binStart = (8 + json.length + 7) & ~7;
  const out = new Uint8Array(binStart + off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, CHUNK_MAGIC, true);
  dv.setUint32(4, json.length, true);
  out.set(json, 8);
  for (const [name, a] of Object.entries(arrays)) {
    const [o] = sections[name];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), binStart + o);
  }
  return out;
}

export function decodeChunk(buf: ArrayBuffer): ChunkData {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== CHUNK_MAGIC) throw new Error('bad chunk magic');
  const jsonLen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen))) as ChunkHeader;
  const binStart = (8 + jsonLen + 7) & ~7;
  const get = <K extends ArrayKind>(name: string, kind: K): InstanceType<(typeof CTORS)[K]> => {
    const s = header.sections[name];
    if (!s) return new CTORS[kind](0) as InstanceType<(typeof CTORS)[K]>;
    return new CTORS[s[2]](buf, binStart + s[0], s[1]) as InstanceType<(typeof CTORS)[K]>;
  };
  return {
    lod: header.lod,
    cx: header.cx,
    cy: header.cy,
    size: header.size,
    scale: header.scale ?? COORD_SCALE,
    strings: header.strings,
    points: header.points,
    land: { pos: get('land.pos', 'i16'), kind: get('land.kind', 'u8'), idx: get('land.idx', 'u32') },
    water: { pos: get('water.pos', 'i16'), kind: get('water.kind', 'u8'), idx: get('water.idx', 'u32') },
    buildings: {
      pos: get('bld.pos', 'i16'),
      idx: get('bld.idx', 'u32'),
      ring: get('bld.ring', 'u32'),
      height: get('bld.height', 'u8'),
      flags: get('bld.flags', 'u8'),
    },
    lines: { pos: get('line.pos', 'i16'), meta: get('line.meta', 'i32'), wayId: get('line.wayId', 'f64') },
  };
}

/** World index written next to the chunks: /data/index.json */
export interface WorldIndex {
  version: 1;
  generated: string;
  source: string;
  bboxName: string;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  /** World-space bounds in metres. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  projection: { type: 'equirectangular'; lat0: number; lon0: number };
  lods: Array<{
    lod: number;
    size: number;
    /** chunk keys "cx,cy" -> compressed byte size */
    chunks: Record<string, number>;
  }>;
  counts: Record<string, number>;
}

export function chunkUrl(lod: number, cx: number, cy: number): string {
  return `data/lod${lod}/${cx}_${cy}.dbc`;
}

// ---- generic "JSON header + typed array sections" container (road graph etc.)
type AnyArray = Int16Array | Uint8Array | Uint32Array | Int32Array | Float32Array | Float64Array;

export function encodeSections(magic: number, meta: unknown, arrays: Record<string, AnyArray>): Uint8Array {
  const sections: Record<string, [number, number, ArrayKind]> = {};
  let off = 0;
  for (const [name, a] of Object.entries(arrays)) {
    off = (off + 7) & ~7;
    sections[name] = [off, a.length, kindOf(a)];
    off += a.byteLength;
  }
  const json = new TextEncoder().encode(JSON.stringify({ meta, sections }));
  const binStart = (8 + json.length + 7) & ~7;
  const out = new Uint8Array(binStart + off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, magic, true);
  dv.setUint32(4, json.length, true);
  out.set(json, 8);
  for (const [name, a] of Object.entries(arrays)) out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), binStart + sections[name][0]);
  return out;
}

export function decodeSections<M>(buf: ArrayBuffer, magic: number): { meta: M; get: <T extends AnyArray>(name: string) => T } {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== magic) throw new Error('bad magic');
  const jsonLen = dv.getUint32(4, true);
  const { meta, sections } = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen))) as {
    meta: M;
    sections: Record<string, [number, number, ArrayKind]>;
  };
  const binStart = (8 + jsonLen + 7) & ~7;
  return {
    meta,
    get: <T extends AnyArray>(name: string) => {
      const s = sections[name];
      if (!s) throw new Error(`missing section ${name}`);
      return new CTORS[s[2]](buf, binStart + s[0], s[1]) as unknown as T;
    },
  };
}

export const GRAPH_MAGIC = 0x31474244; // "DBG1"
