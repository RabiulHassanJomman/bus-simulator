import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { project, unproject } from '../src/shared/geo';
import { clipLine, clipRing, signedArea, simplify, simplifyRing } from '../tools/lib/geom';
import { assembleRings } from '../tools/lib/rings';
import { decodeChunk, encodeChunk } from '../src/shared/format';
import { PUBLIC_DATA } from '../tools/config';
import { checkLandmarks, iterChunks, loadIndex } from '../tools/validate';
import { FLYOVERS } from '../tools/landmarks';

describe('projection', () => {
  it('round-trips and uses metres', () => {
    const [x, y] = project(90.3958, 23.7383);
    const [lon, lat] = unproject(x, y);
    expect(lon).toBeCloseTo(90.3958, 9);
    expect(lat).toBeCloseTo(23.7383, 9);
    // Shahbag -> Farmgate is ~2.2 km
    const [fx, fy] = project(90.3897, 23.7577);
    expect(Math.hypot(fx - x, fy - y)).toBeGreaterThan(2000);
    expect(Math.hypot(fx - x, fy - y)).toBeLessThan(2400);
  });
});

describe('geometry', () => {
  it('clips a square to a rectangle', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    const c = clipRing(sq, 5, -5, 20, 20);
    expect(Math.abs(signedArea(c))).toBeCloseTo(50);
  });
  it('clips lines into pieces with running distance', () => {
    const pieces = clipLine([0, 0, 30, 0], 10, -1, 20, 1);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].start).toBeCloseTo(10);
    expect(pieces[0].pts).toEqual([10, 0, 20, 0]);
  });
  it('simplifies collinear points', () => {
    expect(simplify([0, 0, 1, 0.01, 2, 0, 3, 0], 0.1)).toEqual([0, 0, 3, 0]);
    expect(simplifyRing([0, 0, 5, 0, 10, 0, 10, 10, 0, 10], 0.1).length).toBe(8);
  });
  it('assembles multipolygon rings from split ways', () => {
    const rings = assembleRings([
      [1, 2, 3],
      [5, 1],
      [3, 4, 5],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });
});

describe('chunk format', () => {
  it('encodes and decodes', () => {
    const enc = encodeChunk({
      lod: 0,
      cx: 1,
      cy: -2,
      size: 512,
      scale: 10,
      strings: ['Shahbag'],
      points: [1, 0, 10, 20, 0, -1],
      land: { pos: Int16Array.of(0, 0, 10, 0, 0, 10), kind: Uint8Array.of(1, 1, 1), idx: Uint32Array.of(0, 1, 2) },
      water: { pos: new Int16Array(0), kind: new Uint8Array(0), idx: new Uint32Array(0) },
      buildings: { pos: new Int16Array(0), idx: new Uint32Array(0), ring: new Uint32Array(0), height: new Uint8Array(0), flags: new Uint8Array(0) },
      lines: { pos: Int16Array.of(1, 2, 3, 4), meta: new Int32Array(12), wayId: Float64Array.of(123456789012) },
    });
    const dec = decodeChunk(enc.buffer.slice(0) as ArrayBuffer);
    expect(dec.cy).toBe(-2);
    expect(dec.strings).toEqual(['Shahbag']);
    expect(Array.from(dec.land.idx)).toEqual([0, 1, 2]);
    expect(dec.lines.wayId[0]).toBe(123456789012);
  });
});

const hasData = existsSync(join(PUBLIC_DATA, 'index.json'));
describe.skipIf(!hasData)('built data: landmarks', () => {
  const index = hasData ? loadIndex() : null!;
  const chunks = hasData ? [...iterChunks(index)] : [];
  it('finds flyovers as elevated roads near their real location', () => {
    const res = checkLandmarks(index, chunks, FLYOVERS, true);
    const failed = res.filter((r) => r.status === 'FAIL');
    expect(failed, JSON.stringify(failed)).toHaveLength(0);
  });
  it('finds known Dhaka landmarks at their real coordinates', () => {
    const res = checkLandmarks(index, chunks);
    const failed = res.filter((r) => r.status === 'FAIL');
    expect(failed, JSON.stringify(failed)).toHaveLength(0);
    expect(res.some((r) => r.status === 'PASS')).toBe(true);
  });
});
