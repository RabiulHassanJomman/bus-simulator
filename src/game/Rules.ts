// Traffic-law checks for the player: red lights and wrong-way driving. Pure logic.
import type { Bus } from './Bus';
import type { CollisionWorld } from './CollisionWorld';
import type { Signals } from './traffic/Signals';
import { LF_ONEWAY, RoadClass } from '../shared/kinds';

export interface Violation {
  kind: 'red-light' | 'wrong-way';
  fine: number;
}

const JUNCTION_R = 9; // metres from the controller centre counts as "in the junction"

export class Rules {
  wrongWay = false;
  private wrongTimer = 0;
  private inside = new Set<number>();
  private lastFine = new Map<number, number>();

  update(dt: number, bus: Bus, world: CollisionWorld, signals: Signals | null, time: number): Violation[] {
    const out: Violation[] = [];
    const p = bus.phys;
    const speed = p.speed;
    // ---- wrong way down a one-way street (sustained, moving forwards)
    let wrong = false;
    if (speed > 2) {
      const { under } = world.roadsAt(p.cx, p.cy, 20, RoadClass.Residential);
      const mine = under.filter((h) => h.road.level === bus.level);
      if (mine.length && mine.every((h) => h.road.flags & LF_ONEWAY && h.dx * p.fx + h.dy * p.fy < -0.5)) wrong = true;
    }
    this.wrongTimer = wrong ? this.wrongTimer + dt : 0;
    this.wrongWay = this.wrongTimer > 1;
    if (this.wrongTimer > 4) {
      this.wrongTimer = 1;
      out.push({ kind: 'wrong-way', fine: 300 });
    }
    // ---- red light: entering a junction box against the light
    if (signals && bus.level === 0) {
      const nowInside = new Set<number>();
      for (const c of signals.near(p.cx, p.cy, 40)) {
        const d = Math.hypot(c.x - p.cx, c.y - p.cy);
        if (d > JUNCTION_R) continue;
        nowInside.add(c.id);
        if (this.inside.has(c.id) || c.broken || speed < 2) continue;
        // heading into the junction?
        const toward = (c.x - p.cx) * p.fx + (c.y - p.cy) * p.fy > -2;
        if (!toward) continue;
        const light = signals.light(c, signals.group(c, p.heading), time);
        if (light === 'red' && time - (this.lastFine.get(c.id) ?? -1e9) > 30) {
          this.lastFine.set(c.id, time);
          out.push({ kind: 'red-light', fine: c.police ? 300 : 500 });
        }
      }
      this.inside = nowInside;
    }
    return out;
  }
}
