import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RouteRun, type BusState } from '../src/game/career/RouteRun';
import { fareFor, type RouteData } from '../src/shared/routes';
import { PUBLIC_DATA } from '../tools/config';

const file = join(PUBLIC_DATA, 'routes.json');
const has = existsSync(file);

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('fares', () => {
  it('follow the BRTA per-km rate with minimums and student half fare', () => {
    expect(fareFor(1000, false)).toBe(10); // minimum
    expect(fareFor(10000, false)).toBe(25); // 10 km × 2.45 ≈ 25
    expect(fareFor(10000, true)).toBe(13);
    expect(fareFor(500, true)).toBe(5);
  });
});

describe.skipIf(!has)('routes', () => {
  const routes = has ? (JSON.parse(readFileSync(file, 'utf8')) as RouteData[]) : [];

  it('has at least 5 playable routes with ordered stops in both directions', () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const r of routes)
      for (const d of r.dirs) {
        expect(d.stops.length).toBeGreaterThanOrEqual(5);
        for (let i = 1; i < d.stops.length; i++) expect(d.stops[i].s).toBeGreaterThan(d.stops[i - 1].s);
        expect(d.length).toBeGreaterThan(5000);
        // most stops are real OSM bus stops
        expect(d.stops.filter((s) => s.match !== 'manual').length / d.stops.length).toBeGreaterThan(0.6);
      }
  });

  /** Drive along the route line; stop at every stop with doors open until boarding is done. */
  function drive(route: RouteData, serveStops: boolean) {
    const run = new RouteRun(route, 0, 1.2, seeded(3));
    let s = run.stops[0].s - 5;
    let v = 0;
    let dwell = 0;
    let doors = false;
    const dt = 0.1;
    for (let t = 0; t < 20000 && !run.finished; t++) {
      const target = run.next < run.stops.length ? run.stops[run.next].s - 2 : Infinity;
      const mustStop = serveStops && target - s < 30 && target - s > -5;
      if (mustStop && target - s < 1) {
        v = 0;
        doors = true;
        dwell += dt;
        // leave once everyone is on/off (the stop is marked served), or after a minute
        if (run.served[run.next] || dwell > 60) {
          doors = false;
          v = 3;
          dwell = 0;
        }
      } else {
        v = mustStop ? Math.min(v || 9, Math.max(0.5, (target - s) / 3)) : 9;
        doors = false;
      }
      s += v * dt;
      let [x, y, tx, ty] = run.pointAt(s);
      const end = run.cum[run.cum.length - 1];
      if (s > end) {
        // keep driving straight on past the end of the route
        x += tx * (s - end);
        y += ty * (s - end);
      }
      const bus: BusState = { x, y, speed: v, accel: 0, lateral: 0, doorsOpen: doors, impact: 0 };
      run.update(dt, bus, 2);
    }
    return run;
  }

  it('a careful driver serves every stop, delivers passengers and collects fares', () => {
    const run = drive(routes[0], true);
    expect(run.finished).toBe(true);
    expect(run.missed).toBe(0);
    expect(run.delivered).toBeGreaterThan(10);
    expect(run.fares).toBeGreaterThanOrEqual(run.delivered * 5);
    const res = run.result(0);
    console.log('careful run', JSON.stringify(res));
    expect(res.stars).toBeGreaterThanOrEqual(3);
    expect(res.satisfaction).toBeGreaterThan(60);
  });

  it('blasting past every stop misses them and ruins satisfaction', () => {
    const run = drive(routes[0], false);
    expect(run.finished).toBe(true);
    expect(run.missed).toBeGreaterThan(2);
    expect(run.result(0).stars).toBeLessThanOrEqual(3);
  });
});
