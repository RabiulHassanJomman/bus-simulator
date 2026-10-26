// Syncs AI vehicles, pedestrians and signals to batched sprites/graphics.
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Traffic, Vehicle } from '../game/traffic/Traffic';
import type { Pedestrians, Ped } from '../game/traffic/Pedestrians';
import type { Signals, Controller } from '../game/traffic/Signals';
import type { TrafficAtlas } from './TrafficArt';
import type { World } from '../world/World';
import type { Rect } from '../game/Camera';
import { canTraverse } from '../game/Router';

const HEIGHT: Record<string, number> = { bus: 3.2, truck: 3.0, leguna: 2.0, ambulance: 2.4, pickup: 1.7, police: 1.7, car: 1.5, taxi: 1.5, cng: 1.7, rickshaw: 1.8, motorcycle: 1.3 };

interface VSprites {
  body: Sprite;
  shadow: Sprite;
}

export class TrafficView {
  private groundShadows = new Container({ label: 'trafficShadows' });
  private ground = new Container({ label: 'traffic' });
  private elevatedShadows = new Container();
  private elevated = new Container({ label: 'trafficElevated' });
  private pedLayer = new Container({ label: 'peds' });
  private signalLayer = new Container({ label: 'signals' });
  private vs = new Map<number, VSprites>();
  private ps = new Map<number, Sprite>();
  private sg = new Map<number, { g: Graphics; key: string }>();
  sunX = 0.42;
  sunY = 0.55;

  constructor(
    world: World,
    private atlas: TrafficAtlas,
  ) {
    // pedestrians and signal furniture under vehicles; elevated traffic above the decks
    world.entities.addChildAt(this.signalLayer, 0);
    world.entities.addChildAt(this.pedLayer, 1);
    world.entities.addChildAt(this.groundShadows, 2);
    world.entities.addChildAt(this.ground, 3);
    world.entitiesElevated.addChild(this.elevatedShadows, this.elevated);
    for (const c of [this.groundShadows, this.elevatedShadows]) c.alpha = 0.3;
  }

  private vehicleSprites(v: Vehicle): VSprites {
    let s = this.vs.get(v.id);
    if (s) return s;
    const tex = this.atlas.vehicle(v.spec.type, v.variant);
    const body = new Sprite({ texture: tex, anchor: 0.5 });
    const shadow = new Sprite({ texture: tex, anchor: 0.5, tint: 0x000000 });
    s = { body, shadow };
    this.vs.set(v.id, s);
    return s;
  }

  sync(traffic: Traffic, peds: Pedestrians, signals: Signals, view: Rect) {
    const seen = new Set<number>();
    for (const v of traffic.vehicles) {
      seen.add(v.id);
      const s = this.vehicleSprites(v);
      const elevated = v.level > 0;
      const parent = elevated ? this.elevated : this.ground;
      if (s.body.parent !== parent) {
        parent.addChild(s.body);
        (elevated ? this.elevatedShadows : this.groundShadows).addChild(s.shadow);
      }
      const vis = v.x > view.x0 - 15 && v.x < view.x1 + 15 && v.y > view.y0 - 15 && v.y < view.y1 + 15;
      s.body.visible = s.shadow.visible = vis;
      if (!vis) continue;
      s.body.position.set(v.x, v.y);
      s.body.rotation = v.heading;
      const h = (HEIGHT[v.spec.type] ?? 1.5) + (elevated ? v.level * 4.5 : 0);
      s.shadow.position.set(v.x + this.sunX * h, v.y + this.sunY * h);
      s.shadow.rotation = v.heading;
    }
    for (const [id, s] of this.vs)
      if (!seen.has(id)) {
        s.body.destroy();
        s.shadow.destroy();
        this.vs.delete(id);
      }

    const pseen = new Set<number>();
    for (const p of peds.peds) {
      pseen.add(p.id);
      let sp = this.ps.get(p.id);
      if (!sp) {
        sp = new Sprite({ texture: this.atlas.ped(p.kind, p.variant), anchor: 0.5 });
        this.ps.set(p.id, sp);
        this.pedLayer.addChild(sp);
      }
      const vis = p.x > view.x0 - 5 && p.x < view.x1 + 5 && p.y > view.y0 - 5 && p.y < view.y1 + 5;
      sp.visible = vis;
      if (!vis) continue;
      sp.position.set(p.x, p.y);
      this.pedPose(sp, p);
    }
    for (const [id, sp] of this.ps)
      if (!pseen.has(id)) {
        sp.destroy();
        this.ps.delete(id);
      }

    this.syncSignals(traffic, signals, view);
  }

  private pedPose(sp: Sprite, p: Ped) {
    if (p.mode === 'down') {
      sp.rotation = p.heading + Math.PI / 2;
      sp.alpha = Math.min(1, p.timer / 2);
      sp.scale.set(1.15, 1.15);
      return;
    }
    sp.alpha = 1;
    sp.rotation = p.heading;
    const bob = p.mode === 'idle' ? 0 : Math.sin(p.anim * 2) * 0.06;
    sp.scale.set(1 + bob, 1 - bob * 0.5);
  }

  private syncSignals(traffic: Traffic, signals: Signals, view: Rect) {
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const r = Math.hypot(view.x1 - view.x0, view.y1 - view.y0) / 2 + 40;
    const near = signals.near(cx, cy, r);
    const keep = new Set<number>();
    for (const c of near) {
      keep.add(c.id);
      const l0 = signals.light(c, 0, traffic.time);
      const l1 = signals.light(c, 1, traffic.time);
      const key = `${l0}${l1}${Math.floor(traffic.time * 2) % 2}`;
      let entry = this.sg.get(c.id);
      if (!entry) {
        entry = { g: new Graphics(), key: '' };
        this.sg.set(c.id, entry);
        this.signalLayer.addChild(entry.g);
      }
      if (entry.key !== key) {
        entry.key = key;
        this.drawController(entry.g, traffic, signals, c);
      }
    }
    for (const [id, e] of this.sg)
      if (!keep.has(id)) {
        e.g.destroy();
        this.sg.delete(id);
      }
  }

  private drawController(g: Graphics, traffic: Traffic, signals: Signals, c: Controller) {
    g.clear();
    const gr = traffic.g;
    const colorOf = (l: string) => (l === 'green' ? 0x2ee66b : l === 'yellow' ? 0xffc400 : 0xff2d2d);
    const blink = Math.floor(traffic.time * 2) % 2 === 0;
    for (const n of c.nodes) {
      const centreNode = Math.hypot(c.x - gr.nodeX[n], c.y - gr.nodeY[n]) < 6;
      for (let k = gr.adjStart[n]; k < gr.adjStart[n + 1]; k++) {
        const e = gr.adjEdge[k];
        if (gr.edgeLevel[e] > 0) continue;
        // approaches: edges whose travel direction leads INTO this node
        const from = gr.edgeA[e] === n ? gr.edgeB[e] : gr.edgeA[e];
        if (!canTraverse(gr, e, from)) continue;
        const dir: 1 | -1 = gr.edgeB[e] === n ? 1 : -1;
        const L = traffic.edgeLength(e);
        const stop = Math.max(2, 11 - Math.hypot(c.x - gr.nodeX[n], c.y - gr.nodeY[n]));
        if (L < stop + 3 || gr.edgeCls[e] < 9) continue;
        const [px, py, tx, ty] = traffic.pointAt(e, dir, L - stop);
        // only real approaches: outside the junction box, heading towards its centre
        if (Math.hypot(px - c.x, py - c.y) < 7) continue;
        if (!centreNode && tx * (c.x - px) + ty * (c.y - py) < 0) continue;
        const [lo, hi] = traffic.latBand(e, 0);
        const lx = ty;
        const ly = -tx;
        // stop line across our lanes
        const a0x = px + lx * lo;
        const a0y = py + ly * lo;
        const a1x = px + lx * hi;
        const a1y = py + ly * hi;
        g.moveTo(a0x, a0y).lineTo(a1x, a1y).stroke({ color: 0xf2f2ee, width: 0.45, alpha: 0.9 });
        if (c.police) continue;
        // signal head on the kerb (left) side
        const light = c.broken ? (blink ? 'yellow' : 'off') : signals.light(c, signals.group(c, Math.atan2(ty, tx)), traffic.time);
        const hx = px + lx * (gr.edgeHw[e] + 0.7);
        const hy = py + ly * (gr.edgeHw[e] + 0.7);
        g.roundRect(hx - 0.45, hy - 0.45, 0.9, 0.9, 0.15).fill(0x1d1d1d);
        if (light !== 'off') {
          g.circle(hx, hy, 0.32).fill(colorOf(light));
          g.circle(hx, hy, 1.0).fill({ color: colorOf(light), alpha: 0.18 });
        }
      }
    }
    if (c.police) {
      // traffic constable on a little stand, arm along the road that has green
      const l0 = signals.light(c, 0, traffic.time);
      const facing = l0 === 'green' ? c.axis : c.axis + Math.PI / 2;
      g.circle(c.x, c.y, 1.1).fill(0xd9d4c4).stroke({ color: 0x8a8378, width: 0.15 });
      g.ellipse(c.x, c.y, 0.28, 0.2).fill(0xf5f5f0); // white uniform
      g.poly([c.x - 0.22, c.y - 0.14, c.x + 0.22, c.y - 0.14, c.x + 0.16, c.y + 0.16, c.x - 0.16, c.y + 0.16]).fill({ color: 0xc6ff00, alpha: 0.9 }); // hi-vis vest
      g.circle(c.x, c.y, 0.13).fill(0x1a237e); // cap
      const ax = Math.cos(facing);
      const ay = Math.sin(facing);
      g.moveTo(c.x, c.y).lineTo(c.x + ax * 0.6, c.y + ay * 0.6).stroke({ color: 0xf5f5f0, width: 0.12 });
      g.circle(c.x + ax * 0.65, c.y + ay * 0.65, 0.08).fill(0xffffff); // white glove
    }
  }
}
