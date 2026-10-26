// Pedestrians: walk the footpaths beside real roads, jaywalk (more often near zebras),
// dodge the bus, and street vendors who stay put. Pure logic.
import type { RoadGraph } from '../../shared/graph';
import { NF_CROSSING } from '../../shared/graph';
import { RoadClass } from '../../shared/kinds';
import type { Obstacle, Traffic } from './Traffic';

export type PedKind = 'man' | 'woman' | 'student' | 'vendor';

export interface Ped {
  id: number;
  kind: PedKind;
  variant: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  edge: number;
  dir: 1 | -1;
  s: number;
  /** +1 = left footpath of travel direction, -1 = right */
  side: 1 | -1;
  mode: 'walk' | 'cross' | 'idle' | 'dodge' | 'down';
  /** crossing / dodge target */
  tx: number;
  ty: number;
  timer: number;
  anim: number;
  dead: boolean;
}

export class Pedestrians {
  peds: Ped[] = [];
  private nextId = 1;
  baseCount = 70;
  radius = 260;
  /** set when the player knocks someone down this frame */
  hits: Ped[] = [];

  constructor(
    private g: RoadGraph,
    private traffic: Traffic,
    private rand: () => number = Math.random,
  ) {}

  private sidewalk(e: number) {
    const cls = this.g.edgeCls[e];
    return this.g.edgeHw[e] + (cls >= RoadClass.Tertiary ? 1.5 : 0.8);
  }

  private place(p: Ped) {
    const [x, y, tx, ty] = this.traffic.pointAt(p.edge, p.dir, p.s);
    const off = this.sidewalk(p.edge) * p.side;
    return [x + ty * off, y - tx * off, tx, ty] as const;
  }

  private spawn(px: number, py: number, minDist: number): boolean {
    const g = this.g;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = this.rand() * Math.PI * 2;
      const r = minDist + this.rand() * (this.radius - minDist);
      const qx = px + Math.cos(ang) * r;
      const qy = py + Math.sin(ang) * r;
      // nearest walkable road edge: sample a few vehicles' edges near the point
      const near = this.traffic.query(qx, qy, 60);
      let e = -1;
      if (near.length) e = near[Math.floor(this.rand() * near.length)].edge;
      if (e < 0 || g.edgeLevel[e] > 0 || g.edgeCls[e] < RoadClass.Residential) continue;
      const vendor = g.edgeCls[e] >= RoadClass.Secondary && this.rand() < 0.1;
      const roll = this.rand();
      const kind: PedKind = vendor ? 'vendor' : roll < 0.5 ? 'man' : roll < 0.82 ? 'woman' : 'student';
      const p: Ped = {
        id: this.nextId++,
        kind,
        variant: Math.floor(this.rand() * 1000),
        x: 0,
        y: 0,
        heading: 0,
        speed: vendor ? 0 : 1.0 + this.rand() * 0.6,
        edge: e,
        dir: this.rand() < 0.5 ? 1 : -1,
        s: this.rand() * this.traffic.edgeLength(e),
        side: this.rand() < 0.5 ? 1 : -1,
        mode: vendor ? 'idle' : 'walk',
        tx: 0,
        ty: 0,
        timer: 0,
        anim: this.rand() * 10,
        dead: false,
      };
      const [x, y, tx, ty] = this.place(p);
      p.x = x;
      p.y = y;
      p.heading = vendor ? Math.atan2(-tx * p.side, ty * p.side) + Math.PI : Math.atan2(ty, tx);
      this.peds.push(p);
      return true;
    }
    return false;
  }

  /** Pedestrians standing on the carriageway, as obstacles for traffic. */
  obstacles(out: Obstacle[]) {
    for (const p of this.peds)
      if (p.mode === 'cross' || p.mode === 'dodge' || p.mode === 'down') out.push({ x: p.x, y: p.y, h: p.heading, hl: 0.3, hw: 0.3, vx: 0, vy: 0 });
  }

  update(dt: number, player: { x: number; y: number; vx: number; vy: number; heading: number; hl: number; hw: number }, density: number) {
    const g = this.g;
    this.hits.length = 0;
    const target = Math.round(this.baseCount * Math.max(0.3, density));
    this.peds = this.peds.filter((p) => !p.dead && Math.hypot(p.x - player.x, p.y - player.y) < this.radius + 60);
    const initial = this.peds.length < target * 0.5;
    for (let i = 0; i < (initial ? 25 : 2) && this.peds.length < target; i++) this.spawn(player.x, player.y, initial ? 20 : 160);

    const fx = Math.cos(player.heading);
    const fy = Math.sin(player.heading);
    const pspeed = Math.hypot(player.vx, player.vy);
    for (const p of this.peds) {
      p.anim += dt * p.speed * 3;
      // --- the bus: dodge if it's bearing down on us, get knocked down if not quick enough
      const rx = p.x - player.x;
      const ry = p.y - player.y;
      const along = rx * fx + ry * fy;
      const across = rx * -fy + ry * fx;
      if (p.mode !== 'down' && Math.abs(across) < player.hw + 0.35 && Math.abs(along) < player.hl + 0.35 && pspeed > 1.2) {
        p.mode = 'down';
        p.timer = 5;
        p.speed = 0;
        this.hits.push(p);
        continue;
      }
      if (p.mode !== 'down' && p.mode !== 'dodge' && pspeed > 2 && along > 0 && along < player.hl + 4 + pspeed * 0.8 && Math.abs(across) < player.hw + 1.2 && this.rand() < 0.9) {
        const side = across >= 0 ? 1 : -1;
        p.mode = 'dodge';
        p.tx = p.x - fy * side * (player.hw + 2.2 - Math.abs(across));
        p.ty = p.y + fx * side * (player.hw + 2.2 - Math.abs(across));
        p.timer = 1.2;
      }

      switch (p.mode) {
        case 'down':
          p.timer -= dt;
          if (p.timer <= 0) p.dead = true;
          break;
        case 'dodge': {
          p.timer -= dt;
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          const d = Math.hypot(dx, dy);
          const step = Math.min(d, 4.5 * dt);
          if (d > 0.01) {
            p.x += (dx / d) * step;
            p.y += (dy / d) * step;
          }
          if (p.timer <= 0) p.mode = 'walk';
          break;
        }
        case 'idle':
          break;
        case 'cross': {
          // wait if a vehicle is right in our path, otherwise keep going (this is Dhaka)
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          const d = Math.hypot(dx, dy);
          let blocked = false;
          for (const v of this.traffic.query(p.x, p.y, 12)) {
            const ox = v.x - p.x;
            const oy = v.y - p.y;
            if (Math.hypot(ox, oy) < v.spec.length / 2 + 1.2 && (ox * dx + oy * dy) / Math.max(0.01, d) > -0.5) blocked = true;
          }
          if (!blocked && d > 0.05) {
            const step = Math.min(d, p.speed * 1.15 * dt);
            p.x += (dx / d) * step;
            p.y += (dy / d) * step;
            p.heading = Math.atan2(dy, dx);
          }
          if (d < 0.1) {
            // now on the opposite footpath; pick a new walking direction and re-anchor
            const L = this.traffic.edgeLength(p.edge);
            const u = p.dir === 1 ? p.s : L - p.s; // position along A→B
            const physical = -(p.side * p.dir); // +1 = left of A→B
            const dir: 1 | -1 = this.rand() < 0.5 ? 1 : -1;
            p.mode = 'walk';
            p.dir = dir;
            p.side = (physical * dir) as 1 | -1;
            p.s = dir === 1 ? u : L - u;
          }
          break;
        }
        case 'walk': {
          p.s += p.speed * dt;
          const L = this.traffic.edgeLength(p.edge);
          if (p.s >= L) {
            const node = p.dir === 1 ? g.edgeB[p.edge] : g.edgeA[p.edge];
            const opts: number[] = [];
            for (let k = g.adjStart[node]; k < g.adjStart[node + 1]; k++) {
              const e = g.adjEdge[k];
              if (e !== p.edge && g.edgeLevel[e] === 0 && g.edgeCls[e] >= RoadClass.Service) opts.push(e);
            }
            if (!opts.length) {
              p.dir = p.dir === 1 ? -1 : 1;
              p.s = 0;
            } else {
              const e = opts[Math.floor(this.rand() * opts.length)];
              p.dir = g.edgeA[e] === node ? 1 : -1;
              p.edge = e;
              p.s = 0;
            }
          }
          const [x, y, tx, ty] = this.place(p);
          const k = Math.min(1, dt * 5);
          p.x += (x - p.x) * k;
          p.y += (y - p.y) * k;
          p.heading = Math.atan2(ty, tx);
          // jaywalk: more likely near mapped crossings, only across real roads
          const cls = g.edgeCls[p.edge];
          if (cls >= RoadClass.Residential) {
            const node = p.dir === 1 ? g.edgeB[p.edge] : g.edgeA[p.edge];
            const nearZebra = g.nodeFlags[node] & NF_CROSSING && L - p.s < 8;
            const rate = nearZebra ? 0.5 : cls >= RoadClass.Tertiary ? 0.012 : 0.02;
            if (this.rand() < rate * dt) {
              const off = this.sidewalk(p.edge) * 2 * p.side;
              p.mode = 'cross';
              p.tx = p.x - ty * off;
              p.ty = p.y + tx * off;
            }
          }
          break;
        }
      }
    }
  }
}
