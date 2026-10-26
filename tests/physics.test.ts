import { describe, expect, it } from 'vitest';
import { BusPhysics, BUSES, type Controls } from '../src/game/BusPhysics';
import { CollisionWorld, circleOBB, satPolygons } from '../src/game/CollisionWorld';
import type { ChunkCollision } from '../src/world/buildChunk';

const DT = 1 / 60;
const ctl = (c: Partial<Controls>): Controls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...c });

function runUntil(bus: BusPhysics, c: Controls, done: () => boolean, maxT = 120, world?: CollisionWorld) {
  let t = 0;
  while (!done() && t < maxT) {
    bus.step(DT, c, world);
    t += DT;
  }
  return t;
}

describe('bus physics', () => {
  it('accelerates 0-40 km/h in a bus-like time', () => {
    const bus = new BusPhysics(BUSES.local);
    const t = runUntil(bus, ctl({ throttle: 1 }), () => bus.kmh >= 40);
    expect(t).toBeGreaterThan(6);
    expect(t).toBeLessThan(16);
  });

  it('stops from 40 km/h within a realistic distance', () => {
    const bus = new BusPhysics(BUSES.local);
    bus.speed = bus.vx = 40 / 3.6;
    const x0 = bus.x;
    runUntil(bus, ctl({ brake: 1 }), () => bus.speed <= 0.01, 20);
    const d = bus.x - x0;
    // v²/2a = 11.1²/(2·6.5) ≈ 9.5 m plus rolling/drag help; real buses need 9–14 m
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(14);
    expect(bus.speed).toBeCloseTo(0, 2);
  });

  it('coasts to a stop without reversing', () => {
    const bus = new BusPhysics(BUSES.local);
    bus.speed = bus.vx = 5;
    runUntil(bus, ctl({}), () => bus.speed === 0, 200);
    expect(bus.speed).toBe(0);
    expect(bus.x).toBeGreaterThan(0);
  });

  it('respects the speed governor', () => {
    const bus = new BusPhysics(BUSES.local);
    runUntil(bus, ctl({ throttle: 1 }), () => false, 90);
    expect(bus.kmh).toBeLessThanOrEqual(82);
    expect(bus.kmh).toBeGreaterThan(70);
    expect(bus.gear).toBe(BUSES.local.gears.length);
  });

  it('has a bus-sized turning circle at full lock', () => {
    const bus = new BusPhysics(BUSES.local);
    bus.speed = bus.vx = 3;
    let minX = Infinity;
    let maxX = -Infinity;
    // drive a full circle at walking pace on full right lock
    let turned = 0;
    let last = bus.heading;
    while (turned < Math.PI * 2) {
      bus.step(DT, ctl({ steer: 1, throttle: 0.15 }));
      turned += bus.heading - last;
      last = bus.heading;
      minX = Math.min(minX, bus.x);
      maxX = Math.max(maxX, bus.x);
    }
    const rearAxleRadius = (maxX - minX) / 2;
    // city buses: ~ 8–10 m rear-axle radius (kerb-to-kerb ~ 21–24 m)
    expect(rearAxleRadius).toBeGreaterThan(6.5);
    expect(rearAxleRadius).toBeLessThan(11);
  });

  it('engages reverse after holding brake at a standstill', () => {
    const bus = new BusPhysics(BUSES.local);
    runUntil(bus, ctl({ brake: 1 }), () => false, 2);
    expect(bus.gear).toBe(-1);
    expect(bus.speed).toBeLessThan(0);
    expect(bus.kmh).toBeLessThanOrEqual(15);
  });
});

describe('collisions', () => {
  // a wall of two triangles at x in [20, 22], y in [-50, 50]
  const wall: ChunkCollision = {
    tris: Float32Array.of(20, -50, 22, -50, 22, 50, 20, -50, 22, 50, 20, 50),
    pillars: Float32Array.of(5, 30),
    roads: [],
    cover: new Float32Array(0),
  };
  const world = new CollisionWorld();
  world.add('0:0,0', 0, 0, 512, wall);

  it('SAT finds overlap and the push direction', () => {
    const c = satPolygons([0, 0, 2, 0, 2, 2, 0, 2], [1, -1, 4, -1, 4, 4]);
    expect(c).not.toBeNull();
    expect(c!.nx).toBeLessThan(0);
    expect(satPolygons([0, 0, 1, 0, 1, 1], [5, 5, 6, 5, 6, 6])).toBeNull();
  });

  it('detects pillars', () => {
    const c = circleOBB(0, 2, 1, { cx: 0, cy: 0, hl: 5, hw: 1.25, fx: 1, fy: 0 });
    expect(c).not.toBeNull();
    expect(c!.ny).toBeLessThan(0);
  });

  it('a bus driven into a wall stops at the wall and registers an impact', () => {
    const bus = new BusPhysics(BUSES.local);
    bus.placeCentre(0, 0, 0);
    let maxImpact = 0;
    runUntil(bus, ctl({ throttle: 1 }), () => {
      maxImpact = Math.max(maxImpact, bus.impact);
      return false;
    }, 8, world);
    const front = bus.cx + BUSES.local.length / 2;
    expect(front).toBeLessThanOrEqual(20.1);
    expect(front).toBeGreaterThan(19);
    expect(maxImpact).toBeGreaterThan(2);
  });
});

describe('flyover levels', () => {
  // ground road north to a ramp junction at y=-100; the flyover (level 1) continues north;
  // a ground cross street passes under the flyover at y=-200
  const road = (pts: number[], level: number, name: string) => ({
    pts: Float32Array.from(pts), cls: 14, flags: 1, level, hw: 5, lanes: 2, name, nameBn: '',
  });
  const world = new CollisionWorld();
  world.add('0:0,-1', 0, -1, 512, {
    tris: new Float32Array(0),
    pillars: new Float32Array(0),
    cover: new Float32Array(0),
    roads: [
      road([100, 512, 100, 412], 0, 'Approach'),
      road([100, 412, 100, 100], 1, 'Flyover'),
      road([0, 312, 300, 312], 0, 'Under street'),
    ],
  });

  it('climbs onto the flyover only through the ramp junction and stays up over cross streets', async () => {
    const { Bus } = await import('../src/game/Bus');
    const bus = new Bus(BUSES.local);
    bus.phys.placeCentre(100, -40, -Math.PI / 2); // world y = -512 + 472
    const levels = new Set<number>();
    for (let i = 0; i < 60 * 25; i++) {
      bus.step(DT, ctl({ throttle: 0.6 }), world);
      levels.add(bus.level);
      if (bus.phys.cy < -300) break;
    }
    expect(bus.level).toBe(1);
    expect(bus.roadName).toBe('Flyover');
    expect(bus.damage).toBe(0);
  });

  it('a bus on the cross street stays on the ground under the flyover', async () => {
    const { Bus } = await import('../src/game/Bus');
    const bus = new Bus(BUSES.local);
    bus.phys.placeCentre(10, -200, 0);
    for (let i = 0; i < 60 * 40; i++) {
      bus.step(DT, ctl({ throttle: 0.8 }), world);
      if (bus.phys.cx > 250) break;
    }
    expect(bus.phys.cx).toBeGreaterThan(150);
    expect(bus.level).toBe(0);
  });

  it('flyover parapets keep the bus on the deck', async () => {
    const { Bus } = await import('../src/game/Bus');
    const bus = new Bus(BUSES.local);
    bus.phys.placeCentre(100, -250, -Math.PI / 2);
    bus.level = 1;
    // steer hard right for a while: the parapet must stop the bus leaving the 10 m deck
    for (let i = 0; i < 60 * 6; i++) bus.step(DT, ctl({ throttle: 0.7, steer: 1 }), world);
    expect(Math.abs(bus.phys.cx - 100)).toBeLessThan(6);
    expect(bus.level).toBe(1);
  });
});
