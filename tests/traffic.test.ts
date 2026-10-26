import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeGraph } from '../src/shared/graph';
import { Signals } from '../src/game/traffic/Signals';
import { Traffic } from '../src/game/traffic/Traffic';
import { project } from '../src/shared/geo';
import { PUBLIC_DATA } from '../tools/config';
import { Clock } from '../src/game/Clock';

const file = join(PUBLIC_DATA, 'graph.dgz');
const has = existsSync(file);

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('clock', () => {
  it('has rush hours and quiet Friday mornings', () => {
    const rush = new Clock(0, 9, 0).density();
    const night = new Clock(0, 3, 0).density();
    const friday = new Clock(5, 9, 0).density();
    expect(rush).toBeGreaterThan(1.2);
    expect(night).toBeLessThan(0.4);
    expect(friday).toBeLessThan(rush * 0.5);
  });
});

describe.skipIf(!has)('traffic simulation on the real graph', () => {
  const raw = has ? gunzipSync(readFileSync(file)) : Buffer.alloc(0);
  const g = has ? decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer) : null!;
  const signals = has ? new Signals(g) : null!;

  it('builds intersection controllers incl. police junctions', () => {
    expect(signals.controllers.length).toBeGreaterThan(80);
    expect(signals.controllers.some((c) => c.police)).toBe(true);
    const c = signals.controllers.find((k) => !k.broken)!;
    // the two groups are never green at the same time
    for (let t = 0; t < 300; t += 0.5) {
      const a = signals.light(c, 0, t);
      const b = signals.light(c, 1, t);
      expect(a === 'green' && b === 'green').toBe(false);
    }
  });

  it('runs 2 minutes of Farmgate traffic without NaNs, pile-ups or deadlock', () => {
    const traffic = new Traffic(g, signals, seeded(42));
    const [px, py] = project(90.3897, 23.7577);
    const player = { x: px, y: py };
    const dt = 1 / 30;
    let moving = 0;
    let samples = 0;
    let overlapSamples = 0;
    let overlapping = 0;
    for (let i = 0; i < 30 * 120; i++) {
      traffic.update(dt, player, [], 1.2);
      if (i % 30 === 0 && i > 30 * 20) {
        for (const v of traffic.vehicles) {
          expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.v)).toBe(true);
          samples++;
          if (v.v > 1) moving++;
        }
        // overlapping centres (same level, < 40% of the shorter length apart)
        const vs = traffic.vehicles;
        for (let a = 0; a < vs.length; a++)
          for (let b = a + 1; b < vs.length; b++) {
            if (vs[a].level !== vs[b].level) continue;
            const d = Math.hypot(vs[a].x - vs[b].x, vs[a].y - vs[b].y);
            if (d < 15) overlapSamples++;
            if (d < Math.min(vs[a].spec.length, vs[b].spec.length) * 0.4) overlapping++;
          }
      }
    }
    const police = signals.controllers.filter((k) => k.police).length;
    console.log(`  ${signals.controllers.length} controllers (${police} police), ${traffic.vehicles.length} vehicles, moving ${((moving / samples) * 100).toFixed(0)}%, overlap ${((overlapping / Math.max(1, overlapSamples)) * 100).toFixed(1)}%`);
    expect(traffic.vehicles.length).toBeGreaterThan(80);
    // traffic flows: a good share is moving at any moment
    expect(moving / samples).toBeGreaterThan(0.3);
    // vehicles rarely sit inside each other
    expect(overlapping / Math.max(1, overlapSamples)).toBeLessThan(0.05);
  });

  it('vehicles stop for a red light', () => {
    const traffic = new Traffic(g, signals, seeded(7));
    // pick a working, non-police controller and watch vehicles passing its nodes
    const c = signals.controllers.find((k) => !k.broken && !k.police)!;
    const player = { x: c.x, y: c.y };
    const dt = 1 / 30;
    let violations = 0;
    let checks = 0;
    const lastEdge = new Map<number, number>();
    const lastCleared = new Map<number, number>();
    const lastHeading = new Map<number, number>();
    let passed = 0;
    for (let i = 0; i < 30 * 150; i++) {
      traffic.update(dt, player, [], 1.5);
      for (const v of traffic.vehicles) {
        const prev = lastEdge.get(v.id);
        if (prev !== undefined && prev !== v.edge) {
          // the vehicle just crossed a node: was it a controlled node of c on a red approach?
          const node = g.edgeA[v.edge] === g.edgeB[prev] || g.edgeA[v.edge] === g.edgeA[prev] ? g.edgeA[v.edge] : g.edgeB[v.edge];
          if (signals.byNode.get(node) === c && Math.hypot(c.x - g.nodeX[node], c.y - g.nodeY[node]) < 30) {
            checks++;
            // entering the junction (not already cleared) against a red light is a violation
            if (lastCleared.get(v.id) !== c.id) {
              passed++;
              if (signals.light(c, signals.group(c, lastHeading.get(v.id)!), traffic.time) === 'red') violations++;
            }
          }
        }
        lastEdge.set(v.id, v.edge);
        lastCleared.set(v.id, v.clearedCtrl);
        lastHeading.set(v.id, v.heading);
      }
    }
    console.log(`  red-light test: ${passed} junction entries, ${violations} on red (${checks} node crossings)`);
    expect(passed).toBeGreaterThan(5);
    expect(violations).toBeLessThanOrEqual(Math.max(1, passed * 0.1));
  });
});
