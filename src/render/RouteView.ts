// World + minimap visuals for the active route: guide line, stop shelters, waiting
// passengers, and the stop box marking where to halt at the next stop.
import { Container, Graphics, Sprite } from 'pixi.js';
import type { RouteRun } from '../game/career/RouteRun';
import type { TrafficAtlas } from './TrafficArt';
import type { World } from '../world/World';
import type { MapView } from '../ui/MapView';

export class RouteView {
  private line = new Graphics();
  private shelters = new Graphics();
  private box = new Graphics();
  private paxLayer = new Container();
  private mini = new Graphics();
  private pax = new Map<number, Sprite>();
  private run: RouteRun | null = null;

  constructor(
    world: World,
    map: MapView,
    private atlas: TrafficAtlas | null,
  ) {
    world.entities.addChildAt(this.line, 0);
    world.entities.addChildAt(this.box, 1);
    world.entities.addChild(this.shelters);
    world.entities.addChild(this.paxLayer);
    map.overlay.addChild(this.mini);
    this.line.alpha = 0.42;
  }

  setAtlas(atlas: TrafficAtlas) {
    this.atlas = atlas;
  }

  setRun(run: RouteRun | null) {
    this.run = run;
    for (const g of [this.line, this.shelters, this.box, this.mini]) g.clear();
    for (const s of this.pax.values()) s.destroy();
    this.pax.clear();
    if (!run) return;
    const L = run.d.line;
    const color = run.route.color;
    // guide line along the centre of our lane side
    this.line.moveTo(L[0], L[1]);
    for (let i = 2; i < L.length; i += 2) this.line.lineTo(L[i], L[i + 1]);
    this.line.stroke({ color, width: 2.4, cap: 'round', join: 'round' });
    // minimap / fullscreen map
    this.mini.moveTo(L[0], L[1]);
    for (let i = 2; i < L.length; i += 2) this.mini.lineTo(L[i], L[i + 1]);
    this.mini.stroke({ color, width: 70, cap: 'round', join: 'round', alpha: 0.85 });
    for (const st of run.stops) this.mini.circle(st.x, st.y, 70).fill(0xffffff).stroke({ color, width: 25 });
    // shelters: concrete pad, roof in the route colour, sign post
    for (const st of run.stops) {
      const [, , tx, ty] = run.pointAt(st.s);
      const ang = Math.atan2(ty, tx);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const rect = (lx: number, ly: number, w: number, h: number) => {
        const pts: number[] = [];
        for (const [a, b] of [
          [lx, ly],
          [lx + w, ly],
          [lx + w, ly + h],
          [lx, ly + h],
        ])
          pts.push(st.x + a * c - b * s, st.y + a * s + b * c);
        return pts;
      };
      this.shelters.poly(rect(-4, -1.2, 8, 2.4)).fill(0xc9c3b6);
      this.shelters.poly(rect(-3.2, -1.6, 6.4, 1.6)).fill(color).stroke({ color: 0x222222, width: 0.08, alpha: 0.4 });
      this.shelters.poly(rect(-3.2, -1.6, 6.4, 0.35)).fill({ color: 0xffffff, alpha: 0.25 });
      this.shelters.poly(rect(3.6, -0.15, 0.3, 0.3)).fill(0x333333);
      this.shelters.circle(st.x + 3.75 * c, st.y + 3.75 * s, 0.45).fill(0xffd600).stroke({ color: 0x333333, width: 0.08 });
    }
  }

  update(time: number) {
    const run = this.run;
    if (!run) return;
    // stop box for the next stop: where the FRONT DOOR should be
    this.box.clear();
    if (run.next < run.stops.length) {
      const st = run.stops[run.next];
      const [x, y, tx, ty] = run.pointAt(st.s);
      // shift to the left (kerb) side of the centre line
      const lx = ty;
      const ly = -tx;
      const ox = x + lx * 3.2;
      const oy = y + ly * 3.2;
      const len = 13;
      const w = 3.2;
      // box spans from the door position back along the bus
      const corners = [
        [ox + tx * 4 - lx * w / 2, oy + ty * 4 - ly * w / 2],
        [ox + tx * 4 + lx * w / 2, oy + ty * 4 + ly * w / 2],
        [ox + tx * (4 - len) + lx * w / 2, oy + ty * (4 - len) + ly * w / 2],
        [ox + tx * (4 - len) - lx * w / 2, oy + ty * (4 - len) - ly * w / 2],
      ].flat();
      const here = run.atStop === run.next;
      const pulse = 0.35 + 0.25 * Math.sin(time * 4);
      this.box.poly(corners).fill({ color: here ? 0x43a047 : 0xffd600, alpha: here ? 0.35 : pulse }).stroke({ color: here ? 0x2e7d32 : 0xf9a825, width: 0.35 });
      // "BUS STOP" stripes
      for (let k = 1; k < 6; k++) {
        const t = 4 - (len * k) / 6;
        this.box.moveTo(ox + tx * t - lx * w / 2, oy + ty * t - ly * w / 2).lineTo(ox + tx * (t + 0.8) + lx * w / 2, oy + ty * (t + 0.8) + ly * w / 2).stroke({ color: 0xffffff, width: 0.25, alpha: 0.6 });
      }
    }
    // waiting passengers next to each shelter (up to 14 shown per stop)
    if (!this.atlas) return;
    const seen = new Set<number>();
    run.waiting.forEach((list, i) => {
      const st = run.stops[i];
      const [, , tx, ty] = run.pointAt(st.s);
      const lx = ty;
      const ly = -tx;
      list.slice(0, 14).forEach((p, k) => {
        seen.add(p.id);
        let sp = this.pax.get(p.id);
        if (!sp) {
          const kind = p.kind === 'elderly' ? 'man' : p.kind;
          sp = new Sprite({ texture: this.atlas!.ped(kind, p.id), anchor: 0.5 });
          this.pax.set(p.id, sp);
          this.paxLayer.addChild(sp);
        }
        const row = Math.floor(k / 7);
        const col = (k % 7) - 3;
        sp.position.set(st.x + tx * col * 0.9 + lx * (1.6 + row * 0.8) + Math.sin(p.id) * 0.2, st.y + ty * col * 0.9 + ly * (1.6 + row * 0.8));
        // facing the road, fidgeting
        sp.rotation = Math.atan2(-ly, -lx) + Math.sin(time * 1.3 + p.id) * 0.3;
      });
    });
    for (const [id, sp] of this.pax)
      if (!seen.has(id)) {
        sp.destroy();
        this.pax.delete(id);
      }
  }
}
