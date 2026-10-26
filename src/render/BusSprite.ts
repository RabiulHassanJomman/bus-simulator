// Procedural top-down bus (placeholder until the Phase 7 asset pass, but shaded with care).
// Local frame: +x = forward, +y = right side; units are metres.
import { Container, Graphics } from 'pixi.js';

export interface Livery {
  body: number;
  stripe: number;
  stripe2: number;
  roof: number;
}

export const LIVERIES: Record<string, Livery> = {
  green: { body: 0x2f7d3b, stripe: 0xf2b632, stripe2: 0xd8432f, roof: 0xe7e1d2 },
  red: { body: 0xb5322a, stripe: 0xf4f0e6, stripe2: 0x2b6cb0, roof: 0xe9e3d6 },
  blue: { body: 0x2459a6, stripe: 0xf2c94c, stripe2: 0xffffff, roof: 0xe4e6e8 },
  brtc: { body: 0xc62828, stripe: 0xffffff, stripe2: 0x1b5e20, roof: 0xd32f2f },
};

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export class BusSprite {
  readonly root = new Container({ label: 'bus' });
  private shadow = new Graphics();
  private body = new Graphics();
  private lights = new Graphics();
  private doors = new Graphics();
  private dentsG = new Graphics();
  private dents: Array<[number, number, number]> = [];
  /** outline drawn above flyovers/viaducts so the bus stays visible underneath them */
  readonly ghost = new Graphics();

  constructor(
    public length: number,
    public width: number,
    public livery: Livery,
  ) {
    this.root.addChild(this.shadow, this.body, this.dentsG, this.doors, this.lights);
    this.draw();
  }

  private draw() {
    const L = this.length;
    const W = this.width;
    const x0 = -L / 2;
    const y0 = -W / 2;
    const lv = this.livery;

    this.shadow.clear().roundRect(x0, y0, L, W, 0.5).fill({ color: 0x101018, alpha: 0.28 });
    this.ghost
      .clear()
      .roundRect(x0, y0, L, W, 0.42)
      .fill({ color: lv.body, alpha: 0.55 })
      .stroke({ color: 0xffffff, alpha: 0.9, width: 0.3 })
      .poly([L / 2 - 0.4, 0, L / 2 - 1.6, -0.6, L / 2 - 1.6, 0.6])
      .fill({ color: 0xffffff, alpha: 0.75 });

    const g = this.body.clear();
    // body sides (visible as a rim around the roof) with darker lower edge
    g.roundRect(x0, y0, L, W, 0.42).fill(shade(lv.body, 0.82));
    g.roundRect(x0 + 0.06, y0 + 0.06, L - 0.12, W - 0.12, 0.38).fill(lv.body);
    // livery stripes along both sides
    for (const side of [-1, 1]) {
      const yy = side * (W / 2 - 0.2);
      g.rect(x0 + 0.5, yy - 0.06, L - 1.4, 0.12).fill(lv.stripe);
      g.rect(x0 + 1.2, yy - side * 0.13 - 0.04, L - 2.8, 0.08).fill(lv.stripe2);
    }
    // roof panel, slightly domed: lighter centre band
    g.roundRect(x0 + 0.55, y0 + 0.32, L - 1.25, W - 0.64, 0.3).fill(lv.roof);
    g.roundRect(x0 + 0.75, -0.42, L - 1.65, 0.84, 0.25).fill(shade(lv.roof, 1.05));
    // roof ribs
    for (let x = x0 + 1.4; x < L / 2 - 1.2; x += 1.05) g.rect(x, y0 + 0.36, 0.05, W - 0.72).fill({ color: 0x000000, alpha: 0.07 });
    // roof hatches / vents
    g.roundRect(x0 + L * 0.3, -0.35, 0.8, 0.7, 0.08).fill(shade(lv.roof, 0.82)).stroke({ color: 0x000000, alpha: 0.2, width: 0.04 });
    g.roundRect(x0 + L * 0.62, -0.35, 0.8, 0.7, 0.08).fill(shade(lv.roof, 0.82)).stroke({ color: 0x000000, alpha: 0.2, width: 0.04 });
    // windscreen: wraps around the front, glossy highlight
    g.roundRect(L / 2 - 0.62, y0 + 0.12, 0.5, W - 0.24, 0.2).fill(0x26333f);
    g.poly([L / 2 - 0.55, y0 + 0.3, L / 2 - 0.3, y0 + 0.3, L / 2 - 0.4, -0.2, L / 2 - 0.58, -0.2]).fill({ color: 0xbfd8ea, alpha: 0.35 });
    // rear window
    g.roundRect(x0 + 0.1, y0 + 0.35, 0.28, W - 0.7, 0.12).fill(0x2a3540);
    // side windows hint along the roof edge
    for (const side of [-1, 1]) g.rect(x0 + 0.7, side * (W / 2 - 0.33) - 0.04, L - 1.6, 0.08).fill({ color: 0x1d2730, alpha: 0.55 });
    // mirrors: arms forward of the front corners (bus-style)
    for (const side of [-1, 1]) {
      g.moveTo(L / 2 - 0.2, side * (W / 2 - 0.1)).lineTo(L / 2 + 0.35, side * (W / 2 + 0.25)).stroke({ color: 0x222222, width: 0.07 });
      g.roundRect(L / 2 + 0.25, side * (W / 2 + 0.25) - 0.13, 0.16, 0.26, 0.05).fill(0x1a1a1a);
    }
    // bumpers
    g.roundRect(L / 2 - 0.1, y0 + 0.15, 0.16, W - 0.3, 0.06).fill(0x3a3a3a);
    g.roundRect(x0 - 0.04, y0 + 0.2, 0.14, W - 0.4, 0.06).fill(0x3a3a3a);
    this.setLights(false, false);
    this.setDoors(false);
  }

  setLights(headlights: boolean, braking: boolean, reversing = false) {
    const L = this.length;
    const W = this.width;
    const g = this.lights.clear();
    for (const side of [-1, 1]) {
      g.roundRect(L / 2 - 0.12, side * (W / 2 - 0.3) - 0.14, 0.12, 0.28, 0.04).fill(headlights ? 0xfff6c8 : 0xd9d4c0);
      g.roundRect(-L / 2 - 0.02, side * (W / 2 - 0.3) - 0.14, 0.12, 0.28, 0.04).fill(braking ? 0xff2a1a : 0x8e1d17);
      if (reversing) g.roundRect(-L / 2 - 0.02, side * (W / 2 - 0.62) - 0.08, 0.1, 0.16, 0.03).fill(0xffffff);
    }
    if (braking) for (const side of [-1, 1]) g.circle(-L / 2 - 0.25, side * (W / 2 - 0.3), 0.55).fill({ color: 0xff2a1a, alpha: 0.25 });
  }

  /** Doors are on the LEFT side (y < 0): Bangladesh drives on the left. */
  setDoors(open: boolean) {
    const L = this.length;
    const W = this.width;
    const g = this.doors.clear();
    for (const dx of [L / 2 - 1.6, -L / 2 + 2.4]) {
      if (open) {
        g.rect(dx - 0.55, -W / 2 - 0.05, 1.1, 0.14).fill(0x111111);
        g.poly([dx - 0.55, -W / 2, dx - 0.35, -W / 2 - 0.5, dx - 0.25, -W / 2 - 0.45, dx - 0.45, -W / 2]).fill(shade(this.livery.body, 0.7));
      } else g.rect(dx - 0.55, -W / 2 + 0.02, 1.1, 0.07).fill(shade(this.livery.body, 0.6));
    }
  }

  /** Add a dent at a local body point (x along, y across), severity 0..1. */
  addDent(x: number, y: number, severity: number) {
    this.dents.push([x, y, severity]);
    if (this.dents.length > 40) this.dents.shift();
    const g = this.dentsG.clear();
    for (const [dx, dy, s] of this.dents) {
      const r = 0.15 + s * 0.35;
      g.ellipse(dx, dy, r * 1.4, r).fill({ color: 0x1b1b1b, alpha: 0.35 + s * 0.3 });
      g.ellipse(dx + r * 0.3, dy - r * 0.2, r * 0.6, r * 0.35).fill({ color: 0xffffff, alpha: 0.18 });
    }
  }

  clearDents() {
    this.dents = [];
    this.dentsG.clear();
  }

  /** Position the sprite: centre (world), heading, sun offset for the shadow. */
  update(cx: number, cy: number, heading: number, sunX = 0.42, sunY = 0.55, height = 3.2) {
    this.root.position.set(cx, cy);
    this.ghost.position.set(cx, cy);
    this.ghost.rotation = heading;
    for (const c of [this.body, this.dentsG, this.doors, this.lights]) c.rotation = heading;
    this.shadow.rotation = heading;
    this.shadow.position.set(sunX * height, sunY * height);
  }
}
