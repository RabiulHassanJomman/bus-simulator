import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeGraph } from '../src/shared/graph';
import { canTraverse, PROFILES, Router } from '../src/game/Router';
import { project } from '../src/shared/geo';
import { LF_ONEWAY, RoadClass } from '../src/shared/kinds';
import { PUBLIC_DATA } from '../tools/config';

const file = join(PUBLIC_DATA, 'graph.dgz');
const has = existsSync(file);

describe.skipIf(!has)('road graph router', () => {
  const raw = has ? gunzipSync(readFileSync(file)) : Buffer.alloc(0);
  const g = has ? decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer) : null!;
  const router = has ? new Router(g) : null!;
  const at = (lat: number, lon: number) => {
    const [x, y] = project(lon, lat);
    return router.nearestNode(x, y);
  };

  it('decodes a consistent graph', () => {
    expect(g.edgeA.length).toBeGreaterThan(50000);
    // node positions match edge geometry endpoints
    for (const e of [0, 1000, 50000]) {
      const s = g.geoStart[e] * 2;
      expect(g.geo[s]).toBeCloseTo(g.nodeX[g.edgeA[e]], 1);
      expect(g.edgeLen[e]).toBeGreaterThan(0);
    }
  });

  it('routes Farmgate → Shapla Chattar (Motijheel) along one-way-legal roads', () => {
    const a = at(23.7577, 90.3897);
    const b = at(23.7262, 90.4207);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    const r = router.route(a, b, PROFILES.bus)!;
    expect(r).not.toBeNull();
    // straight line ≈ 4.6 km; real road distance 5–8 km
    expect(r.length).toBeGreaterThan(4600);
    expect(r.length).toBeLessThan(9000);
    for (let i = 0; i < r.edges.length; i++) expect(canTraverse(g, r.edges[i], r.nodes[i])).toBe(true);
    // consecutive edges share nodes
    expect(r.nodes[r.nodes.length - 1]).toBe(b);
  });

  it('routes Mirpur 10 → Gulistan and Uttara → Sadarghat', () => {
    const r1 = router.route(at(23.8069, 90.3687), at(23.7239, 90.4126), PROFILES.bus);
    expect(r1).not.toBeNull();
    const r2 = router.route(at(23.8652, 90.3993), at(23.7058, 90.4093), PROFILES.bus);
    expect(r2).not.toBeNull();
    expect(r2!.length).toBeGreaterThan(19000);
    expect(r2!.length).toBeLessThan(32000);
  });

  it('keeps rickshaws off main roads and flyovers', () => {
    const r = router.route(at(23.7465, 90.3760), at(23.7330, 90.3880), PROFILES.rickshaw);
    expect(r).not.toBeNull();
    for (const e of r!.edges) {
      expect(g.edgeCls[e]).toBeLessThan(RoadClass.Primary);
      expect(g.edgeLevel[e]).toBe(0);
    }
  });

  it('never goes the wrong way down a one-way edge', () => {
    let oneway = -1;
    for (let e = 0; e < g.edgeA.length; e++)
      if (g.edgeFlags[e] & LF_ONEWAY && g.edgeCls[e] >= RoadClass.Secondary) {
        oneway = e;
        break;
      }
    expect(canTraverse(g, oneway, g.edgeA[oneway])).toBe(true);
    expect(canTraverse(g, oneway, g.edgeB[oneway])).toBe(false);
  });
});
