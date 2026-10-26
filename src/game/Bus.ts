// Player bus: physics + elevation level + damage/fines + road snapping. No rendering here.
import { BusPhysics, type BusSpec, type Controls } from './BusPhysics';
import type { CollisionWorld, RoadHit } from './CollisionWorld';
import { LF_ONEWAY, RoadClass } from '../shared/kinds';
import { LANE_WIDTH } from '../shared/style';

export interface BusEvent {
  type: 'crash' | 'reset' | 'level';
  impact?: number; // m/s
  fine?: number; // taka
  /** local body point of the hit (x along, y across) */
  local?: [number, number];
  level?: number;
}

export class Bus {
  readonly phys: BusPhysics;
  /** 0 = ground; >0 = on a flyover/expressway deck of that OSM layer */
  level = 0;
  damage = 0; // 0..100
  fines = 0; // taka
  doorsOpen = false;
  headlights = false;
  roadName = '';
  roadNameBn = '';
  onRoad = true;
  events: BusEvent[] = [];
  /** levels seen overlapping the current level recently (ramp junctions), with time */
  private junctionLevels = new Map<number, number>();
  private time = 0;
  private crashCooldown = 0;

  constructor(spec: BusSpec) {
    this.phys = new BusPhysics(spec);
  }

  get spec() {
    return this.phys.spec;
  }

  step(dt: number, c: Controls, world: CollisionWorld) {
    this.time += dt;
    this.crashCooldown -= dt;
    const p = this.phys;
    // obstacles on the ground only; decks are bounded by their edges instead
    p.step(dt, c, this.level === 0 ? world : undefined);
    if (this.level > 0) this.keepOnDeck(world);
    this.updateLevel(world);
    this.registerImpact();
  }

  private registerImpact() {
    const p = this.phys;
    const impact = p.impact;
    if (impact < 1.2 || this.crashCooldown > 0) return;
    this.crashCooldown = 0.35;
    const sev = Math.min(1, impact / 8);
    this.damage = Math.min(100, this.damage + (impact - 0.8) ** 2 * 1.5);
    const fine = Math.round(impact * 3.6 * 20 / 10) * 10; // ~৳20 per km/h of impact
    this.fines += fine;
    // locate the hit on the body from the deepest contact normal
    let local: [number, number] | undefined;
    const ct = p.contacts[0];
    if (ct) {
      const dx = -ct.nx;
      const dy = -ct.ny;
      const lf = dx * p.fx + dy * p.fy;
      const lr = dx * -p.fy + dy * p.fx;
      const hl = p.spec.length / 2 - 0.25;
      const hw = p.spec.width / 2 - 0.15;
      const t = Math.min(hl / Math.max(1e-6, Math.abs(lf)), hw / Math.max(1e-6, Math.abs(lr)));
      local = [lf * t + (Math.random() - 0.5) * 0.6, lr * t];
    }
    this.events.push({ type: 'crash', impact, fine, local, level: sev });
  }

  /** Elevation: change level only where both roads overlap (ramp junctions). */
  private updateLevel(world: CollisionWorld) {
    const p = this.phys;
    const { under, nearest } = world.roadsAt(p.cx, p.cy, 30, RoadClass.Track);
    const levels = new Set(under.map((h) => h.road.level));
    this.onRoad = levels.has(this.level);
    if (levels.has(this.level)) {
      for (const l of levels) if (l !== this.level) this.junctionLevels.set(l, this.time);
    } else if (under.length) {
      // pick the overlapping level we passed through most recently
      let best = -1;
      let bestT = -Infinity;
      for (const l of levels) {
        const t = this.junctionLevels.get(l);
        if (t !== undefined && this.time - t < 6 && t > bestT) {
          best = l;
          bestT = t;
        }
      }
      if (best >= 0) {
        this.level = best;
        this.junctionLevels.clear();
        this.onRoad = true;
        this.events.push({ type: 'level', level: best });
      }
    }
    const named = under.find((h) => h.road.level === this.level && (h.road.name || h.road.nameBn)) ?? (nearest && nearest.dist < 15 ? nearest : null);
    if (named) {
      this.roadName = named.road.name;
      this.roadNameBn = named.road.nameBn;
    } else if (!under.length) {
      this.roadName = '';
      this.roadNameBn = '';
    }
  }

  /** On a deck: the parapets keep the bus within the carriageway. */
  private keepOnDeck(world: CollisionWorld) {
    const p = this.phys;
    const { under } = world.roadsAt(p.cx, p.cy, 30, RoadClass.Track);
    if (under.some((h) => h.road.level === this.level)) return;
    // nearest road on this level
    const near = world.roadsAt(p.cx, p.cy, 40, RoadClass.Track);
    let best: RoadHit | null = null;
    for (const h of [...near.under, ...(near.nearest ? [near.nearest] : [])]) if (h.road.level > 0 && (!best || h.dist < best.dist)) best = h;
    if (!best) {
      // deck data not loaded / left the deck: drop to the ground
      this.level = 0;
      return;
    }
    const inner = Math.max(0.5, best.road.hw - 0.2);
    const depth = best.dist - inner;
    if (depth <= 0) return;
    const nx = (best.x - p.cx) / best.dist;
    const ny = (best.y - p.cy) / best.dist;
    p.applyContact({ nx, ny, depth }, 0.1, 0.15);
  }

  /** Snap to the nearest drivable road, in the left lane, facing along the current heading. */
  snapToRoad(world: CollisionWorld, x: number, y: number, maxDist = 400, preferHeading?: number): boolean {
    const { nearest } = world.roadsAt(x, y, maxDist, RoadClass.Service);
    if (!nearest) return false;
    const h0 = preferHeading ?? this.phys.heading;
    let dx = nearest.dx;
    let dy = nearest.dy;
    const oneway = (nearest.road.flags & LF_ONEWAY) !== 0;
    // two-way: choose the direction closest to the preferred heading
    if (!oneway && dx * Math.cos(h0) + dy * Math.sin(h0) < 0) {
      dx = -dx;
      dy = -dy;
    }
    const heading = Math.atan2(dy, dx);
    // left-hand traffic: keep left of the centreline on two-way roads
    // middle of the left half: clears median obstacles (MRT pillars) on wide roads
    const hw = nearest.road.hw;
    const maxOff = Math.max(0, hw - this.spec.width / 2 - 0.2);
    const off = oneway ? 0 : Math.min(maxOff, Math.max(LANE_WIDTH / 2 + 0.2, hw / 2));
    // the driver's left in y-down world space is (dy, -dx)
    this.phys.placeCentre(nearest.x + dy * off, nearest.y - dx * off, heading);
    this.level = nearest.road.level;
    this.junctionLevels.clear();
    return true;
  }

  /** R: back onto the road with a penalty. */
  resetToRoad(world: CollisionWorld): boolean {
    const p = this.phys;
    const ok = this.snapToRoad(world, p.cx, p.cy, 400);
    if (ok) {
      this.fines += 100;
      this.events.push({ type: 'reset', fine: 100 });
    }
    return ok;
  }
}
