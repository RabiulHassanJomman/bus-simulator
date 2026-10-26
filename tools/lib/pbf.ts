// Minimal streaming OpenStreetMap PBF decoder (no native deps).
// Spec: https://wiki.openstreetmap.org/wiki/PBF_Format
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export type Tags = Record<string, string>;

export interface PbfNodeBlock {
  type: 'nodes';
  ids: Float64Array;
  lat: Int32Array; // 1e-7 degrees
  lon: Int32Array;
  /** tags for tagged nodes only, keyed by index in ids */
  tags: Map<number, Tags>;
}
export interface PbfWay {
  id: number;
  tags: Tags;
  refs: number[];
}
export interface PbfRelation {
  id: number;
  tags: Tags;
  members: Array<{ type: 'n' | 'w' | 'r'; ref: number; role: string }>;
}

export interface PbfHandlers {
  nodes?: (b: PbfNodeBlock) => void;
  ways?: (ws: PbfWay[]) => void;
  relations?: (rs: PbfRelation[]) => void;
  /** Return false to skip decoding way/relation tags for speed (ids/refs only). */
  wantTags?: boolean;
}

class Reader {
  pos: number;
  constructor(
    public buf: Uint8Array,
    start = 0,
    public end = buf.length,
  ) {
    this.pos = start;
  }
  varint(): number {
    const b = this.buf;
    let byte = b[this.pos++];
    if (byte < 0x80) return byte;
    let x = byte & 0x7f;
    let mul = 128;
    do {
      byte = b[this.pos++];
      x += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte >= 0x80);
    return x;
  }
  svarint(): number {
    const n = this.varint();
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      const l = this.varint();
      this.pos += l;
    } else if (wire === 5) this.pos += 4;
    else throw new Error('bad wire type ' + wire);
  }
  bytes(): [number, number] {
    const l = this.varint();
    const s = this.pos;
    this.pos += l;
    return [s, this.pos];
  }
}

const td = new TextDecoder();

function packedVarints(r: Reader, out: number[], signed: boolean, delta: boolean) {
  const [s, e] = r.bytes();
  const sub = new Reader(r.buf, s, e);
  let acc = 0;
  while (sub.pos < e) {
    const v = signed ? sub.svarint() : sub.varint();
    if (delta) {
      acc += v;
      out.push(acc);
    } else out.push(v);
  }
}

function readBlob(fd: number, pos: number, size: number): { type: string; data: Uint8Array; next: number } | null {
  if (pos + 4 > size) return null;
  const lenBuf = Buffer.alloc(4);
  readSync(fd, lenBuf, 0, 4, pos);
  const hlen = lenBuf.readUInt32BE(0);
  const hbuf = Buffer.alloc(hlen);
  readSync(fd, hbuf, 0, hlen, pos + 4);
  const hr = new Reader(hbuf);
  let type = '';
  let datasize = 0;
  while (hr.pos < hlen) {
    const key = hr.varint();
    const f = key >> 3;
    if (f === 1) {
      const [s, e] = hr.bytes();
      type = td.decode(hbuf.subarray(s, e));
    } else if (f === 3) datasize = hr.varint();
    else hr.skip(key & 7);
  }
  const bbuf = Buffer.alloc(datasize);
  readSync(fd, bbuf, 0, datasize, pos + 4 + hlen);
  const br = new Reader(bbuf);
  let data: Uint8Array | null = null;
  while (br.pos < datasize) {
    const key = br.varint();
    const f = key >> 3;
    if (f === 1) {
      const [s, e] = br.bytes();
      data = bbuf.subarray(s, e);
    } else if (f === 3) {
      const [s, e] = br.bytes();
      data = inflateSync(bbuf.subarray(s, e));
    } else if (f === 4 || f === 6 || f === 7) {
      throw new Error('Unsupported PBF blob compression (field ' + f + '); expected zlib');
    } else br.skip(key & 7);
  }
  return { type, data: data ?? new Uint8Array(0), next: pos + 4 + hlen + datasize };
}

function decodeBlock(data: Uint8Array, h: PbfHandlers) {
  const r = new Reader(data);
  const strings: string[] = [];
  const groups: Array<[number, number]> = [];
  let gran = 100;
  let latOff = 0;
  let lonOff = 0;
  while (r.pos < r.end) {
    const key = r.varint();
    const f = key >> 3;
    if (f === 1) {
      const [s, e] = r.bytes();
      const sr = new Reader(data, s, e);
      while (sr.pos < e) {
        const k2 = sr.varint();
        if (k2 >> 3 === 1) {
          const [a, b] = sr.bytes();
          strings.push(td.decode(data.subarray(a, b)));
        } else sr.skip(k2 & 7);
      }
    } else if (f === 2) groups.push(r.bytes());
    else if (f === 17) gran = r.varint();
    else if (f === 19) latOff = r.varint();
    else if (f === 20) lonOff = r.varint();
    else r.skip(key & 7);
  }
  // Coordinates are converted to 1e-7 degree integers (OSM native precision).
  const scale = gran / 100;
  const latOff7 = latOff / 100;
  const lonOff7 = lonOff / 100;
  const wantTags = h.wantTags !== false;

  for (const [gs, ge] of groups) {
    const g = new Reader(data, gs, ge);
    const ways: PbfWay[] = [];
    const rels: PbfRelation[] = [];
    while (g.pos < ge) {
      const key = g.varint();
      const f = key >> 3;
      if (f === 2 && h.nodes) {
        // DenseNodes
        const [s, e] = g.bytes();
        const d = new Reader(data, s, e);
        const ids: number[] = [];
        const lats: number[] = [];
        const lons: number[] = [];
        const kv: number[] = [];
        while (d.pos < e) {
          const k = d.varint();
          const ff = k >> 3;
          if (ff === 1) packedVarints(d, ids, true, true);
          else if (ff === 8) packedVarints(d, lats, true, true);
          else if (ff === 9) packedVarints(d, lons, true, true);
          else if (ff === 10) packedVarints(d, kv, false, false);
          else d.skip(k & 7);
        }
        const n = ids.length;
        const blk: PbfNodeBlock = {
          type: 'nodes',
          ids: Float64Array.from(ids),
          lat: new Int32Array(n),
          lon: new Int32Array(n),
          tags: new Map(),
        };
        for (let i = 0; i < n; i++) {
          blk.lat[i] = Math.round(latOff7 + lats[i] * scale);
          blk.lon[i] = Math.round(lonOff7 + lons[i] * scale);
        }
        if (kv.length) {
          let j = 0;
          for (let i = 0; i < n && j < kv.length; i++) {
            let t: Tags | null = null;
            while (kv[j] !== 0) {
              (t ??= {})[strings[kv[j]]] = strings[kv[j + 1]];
              j += 2;
            }
            j++;
            if (t) blk.tags.set(i, t);
          }
        }
        h.nodes(blk);
      } else if (f === 1 && h.nodes) {
        // Plain Node (rare in modern files)
        const [s, e] = g.bytes();
        const d = new Reader(data, s, e);
        let id = 0;
        let lat = 0;
        let lon = 0;
        const keys: number[] = [];
        const vals: number[] = [];
        while (d.pos < e) {
          const k = d.varint();
          const ff = k >> 3;
          if (ff === 1) id = d.svarint();
          else if (ff === 2) packedVarints(d, keys, false, false);
          else if (ff === 3) packedVarints(d, vals, false, false);
          else if (ff === 8) lat = d.svarint();
          else if (ff === 9) lon = d.svarint();
          else d.skip(k & 7);
        }
        const tags = new Map<number, Tags>();
        if (keys.length) {
          const t: Tags = {};
          keys.forEach((k, i) => (t[strings[k]] = strings[vals[i]]));
          tags.set(0, t);
        }
        h.nodes({
          type: 'nodes',
          ids: Float64Array.of(id),
          lat: Int32Array.of(Math.round(latOff7 + lat * scale)),
          lon: Int32Array.of(Math.round(lonOff7 + lon * scale)),
          tags,
        });
      } else if (f === 3 && h.ways) {
        const [s, e] = g.bytes();
        const d = new Reader(data, s, e);
        let id = 0;
        const keys: number[] = [];
        const vals: number[] = [];
        const refs: number[] = [];
        while (d.pos < e) {
          const k = d.varint();
          const ff = k >> 3;
          if (ff === 1) id = d.varint();
          else if (ff === 2 && wantTags) packedVarints(d, keys, false, false);
          else if (ff === 3 && wantTags) packedVarints(d, vals, false, false);
          else if (ff === 8) packedVarints(d, refs, true, true);
          else d.skip(k & 7);
        }
        const tags: Tags = {};
        for (let i = 0; i < keys.length; i++) tags[strings[keys[i]]] = strings[vals[i]];
        ways.push({ id, tags, refs });
      } else if (f === 4 && h.relations) {
        const [s, e] = g.bytes();
        const d = new Reader(data, s, e);
        let id = 0;
        const keys: number[] = [];
        const vals: number[] = [];
        const roles: number[] = [];
        const mids: number[] = [];
        const types: number[] = [];
        while (d.pos < e) {
          const k = d.varint();
          const ff = k >> 3;
          if (ff === 1) id = d.varint();
          else if (ff === 2) packedVarints(d, keys, false, false);
          else if (ff === 3) packedVarints(d, vals, false, false);
          else if (ff === 8) packedVarints(d, roles, false, false);
          else if (ff === 9) packedVarints(d, mids, true, true);
          else if (ff === 10) packedVarints(d, types, false, false);
          else d.skip(k & 7);
        }
        const tags: Tags = {};
        for (let i = 0; i < keys.length; i++) tags[strings[keys[i]]] = strings[vals[i]];
        rels.push({
          id,
          tags,
          members: mids.map((ref, i) => ({
            type: types[i] === 0 ? 'n' : types[i] === 1 ? 'w' : 'r',
            ref,
            role: strings[roles[i]] ?? '',
          })),
        });
      } else g.skip(key & 7);
    }
    if (ways.length && h.ways) h.ways(ways);
    if (rels.length && h.relations) h.relations(rels);
  }
}

/** Stream through a PBF file, calling handlers per primitive block. */
export function readPbf(path: string, h: PbfHandlers, onProgress?: (frac: number) => void) {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  let pos = 0;
  let lastReport = 0;
  try {
    for (;;) {
      const blob = readBlob(fd, pos, size);
      if (!blob) break;
      pos = blob.next;
      if (blob.type === 'OSMData') decodeBlock(blob.data, h);
      if (onProgress && pos - lastReport > size / 50) {
        lastReport = pos;
        onProgress(pos / size);
      }
    }
  } finally {
    closeSync(fd);
  }
}
