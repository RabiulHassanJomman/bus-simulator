// Procedural top-down art for traffic and pedestrians, baked once into textures so hundreds
// of sprites batch into a few draw calls. Local frame: +x forward, +y right, units metres.
// (Placeholder until the Phase 7 asset pass, drawn with shading rather than flat boxes.)
import { Container, Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { VType } from '../game/traffic/types';
import type { PedKind } from '../game/traffic/Pedestrians';

const PX_PER_M = 20;
/** sprite scale for atlas textures (baked at PX_PER_M pixels per metre) */
export const ART_SCALE = 1 / PX_PER_M;

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

const CAR_COLORS = [0xf2f2f0, 0xbfc3c7, 0x2b2d31, 0xb3262b, 0x1f4e8c, 0x6d7b84, 0xe8e3d3, 0x2f5d3a, 0x8a6a43];
const RICKSHAW_HOODS = [0xd7263d, 0x1b998b, 0xf46036, 0x2e294e, 0xc5d86d, 0x3d348b, 0xe2b714];
const BUS_LIVERIES = [
  [0x2f7d3b, 0xf2b632],
  [0xb5322a, 0xf4f0e6],
  [0x2459a6, 0xf2c94c],
  [0x6b2fa3, 0xf5d547],
  [0xd9831f, 0x1e5a9c],
  [0x0f7c7c, 0xe63946],
];
const TRUCK_COLORS = [0xe8a317, 0xd94f30, 0x2a9d8f, 0x3a86ff];
const SAREE = [0xd7263d, 0xe2b714, 0x1b998b, 0xc2185b, 0x7b1fa2, 0xf46036, 0x0288d1, 0x2e7d32];
const SHIRT = [0xf5f5f5, 0x8fa9c4, 0x6d4c41, 0x37474f, 0xbcaaa4, 0x5c6bc0, 0x9e9d24];

function windshield(g: Graphics, x: number, w: number, len: number) {
  g.roundRect(x, -w / 2 + 0.12, len, w - 0.24, 0.12).fill(0x22303b);
  g.roundRect(x + len * 0.15, -w / 2 + 0.25, len * 0.3, w * 0.35, 0.05).fill({ color: 0xc8dcea, alpha: 0.35 });
}

function carBody(g: Graphics, L: number, W: number, color: number, roof?: number) {
  g.roundRect(-L / 2, -W / 2, L, W, 0.45).fill(shade(color, 0.75));
  g.roundRect(-L / 2 + 0.05, -W / 2 + 0.05, L - 0.1, W - 0.1, 0.42).fill(color);
  // bonnet crease highlight
  g.roundRect(L * 0.18, -W * 0.3, L * 0.27, W * 0.6, 0.2).fill({ color: 0xffffff, alpha: 0.08 });
  windshield(g, L * 0.06, W, L * 0.14);
  // roof
  g.roundRect(-L * 0.24, -W / 2 + 0.16, L * 0.32, W - 0.32, 0.18).fill(roof ?? shade(color, 1.06));
  g.roundRect(-L * 0.34, -W / 2 + 0.16, L * 0.1, W - 0.32, 0.12).fill(0x22303b); // rear glass
  // lights
  for (const s of [-1, 1]) {
    g.roundRect(L / 2 - 0.12, s * (W / 2 - 0.3) - 0.12, 0.1, 0.24, 0.04).fill(0xfff3c4);
    g.roundRect(-L / 2 + 0.02, s * (W / 2 - 0.28) - 0.11, 0.08, 0.22, 0.03).fill(0x9c1c1c);
    // mirrors
    g.roundRect(L * 0.08, s * (W / 2 + 0.06) - 0.07, 0.16, 0.14, 0.04).fill(shade(color, 0.7));
  }
}

function drawVehicle(type: VType, variant: number): Graphics {
  const g = new Graphics();
  switch (type) {
    case 'car':
      carBody(g, 4.4, 1.8, CAR_COLORS[variant % CAR_COLORS.length]);
      break;
    case 'taxi':
      carBody(g, 4.3, 1.75, 0xf2c200);
      g.roundRect(-0.25, -0.22, 0.5, 0.44, 0.06).fill(0x1d1d1d); // roof sign
      break;
    case 'police':
      carBody(g, 5.0, 1.9, 0xf4f4f4, 0x1d3f8f);
      g.rect(-0.6, -0.8, 0.25, 1.6).fill(0xd32f2f);
      g.rect(-0.35, -0.8, 0.25, 1.6).fill(0x1e88e5);
      g.rect(-2.5, -0.95, 1.6, 1.9).fill({ color: 0x1d3f8f, alpha: 0.3 }); // load bed
      break;
    case 'ambulance': {
      const L = 5.3;
      const W = 2.0;
      g.roundRect(-L / 2, -W / 2, L, W, 0.3).fill(0xdedede);
      g.roundRect(-L / 2 + 0.05, -W / 2 + 0.05, L - 0.1, W - 0.1, 0.28).fill(0xffffff);
      windshield(g, L / 2 - 1.0, W, 0.4);
      g.rect(-L / 2 + 0.2, -W / 2 + 0.05, L - 1.4, 0.18).fill(0xd32f2f);
      g.rect(-L / 2 + 0.2, W / 2 - 0.23, L - 1.4, 0.18).fill(0xd32f2f);
      g.rect(-0.9, -0.15, 1.0, 0.3).fill(0xd32f2f);
      g.rect(-0.55, -0.5, 0.3, 1.0).fill(0xd32f2f);
      g.roundRect(L / 2 - 1.25, -0.6, 0.18, 1.2, 0.05).fill(0x1e88e5);
      break;
    }
    case 'pickup': {
      const c = [0xf0f0f0, 0x3f51b5, 0x8d6e63, 0x546e7a][variant % 4];
      carBody(g, 5.0, 1.85, c);
      g.rect(-2.45, -0.85, 2.1, 1.7).fill(shade(c, 0.65)); // open bed
      g.rect(-2.3, -0.7, 1.8, 1.4).fill(0x4e3b2a);
      // a load of sacks
      for (let i = 0; i < 3; i++) g.ellipse(-2.0 + i * 0.6, (i % 2) * 0.4 - 0.2, 0.32, 0.28).fill(0xd7c9a7);
      break;
    }
    case 'cng': {
      // green auto-rickshaw: canvas roof, metal grille sides, three wheels
      const L = 2.7;
      const W = 1.4;
      g.roundRect(-L / 2, -W / 2, L, W, 0.35).fill(0x1b5e20);
      g.roundRect(-L / 2 + 0.06, -W / 2 + 0.06, L - 0.12, W - 0.12, 0.3).fill(0x2e7d32);
      g.roundRect(-L / 2 + 0.15, -W / 2 + 0.12, L * 0.62, W - 0.24, 0.25).fill(0x16361a); // canvas roof
      for (let i = 0; i < 5; i++) g.rect(-L / 2 + 0.25 + i * 0.32, -W / 2 + 0.14, 0.04, W - 0.28).fill({ color: 0x000000, alpha: 0.18 });
      windshield(g, L / 2 - 0.62, W, 0.28);
      g.roundRect(L / 2 - 0.25, -0.15, 0.18, 0.3, 0.05).fill(0x1b5e20); // nose
      g.circle(L / 2 - 0.08, 0, 0.09).fill(0xfff3c4);
      // grille cage sides
      for (const s of [-1, 1]) g.rect(-L / 2 + 0.2, s * (W / 2 - 0.05) - 0.03, L * 0.6, 0.06).fill(0xa5a5a5);
      break;
    }
    case 'rickshaw': {
      // cycle rickshaw: puller at the front, painted hood folded over the passenger seat
      const hood = RICKSHAW_HOODS[variant % RICKSHAW_HOODS.length];
      const accent = RICKSHAW_HOODS[(variant + 3) % RICKSHAW_HOODS.length];
      g.rect(0.2, -0.04, 0.85, 0.08).fill(0x3b3b3b); // frame
      g.roundRect(0.9, -0.08, 0.12, 0.16, 0.03).fill(0x222222); // front wheel
      // puller: head + shoulders, lungi-checked shirt
      g.ellipse(0.45, 0, 0.2, 0.26).fill(SHIRT[variant % SHIRT.length]);
      g.circle(0.5, 0, 0.11).fill(0x2a1a12);
      g.rect(-1.05, -0.55, 0.12, 1.1).fill(0x222222); // rear axle wheels
      // seat + hood
      g.roundRect(-0.95, -0.5, 0.8, 1.0, 0.18).fill(0x7a1f1f);
      g.roundRect(-1.0, -0.52, 0.62, 1.04, 0.3).fill(hood);
      g.roundRect(-0.98, -0.42, 0.58, 0.84, 0.25).fill(shade(hood, 1.18));
      for (let i = 0; i < 3; i++) g.rect(-0.92 + i * 0.18, -0.5, 0.04, 1.0).fill({ color: accent, alpha: 0.85 });
      g.circle(-0.7, 0, 0.12).fill({ color: 0xffffff, alpha: 0.6 }); // painted motif
      break;
    }
    case 'motorcycle': {
      // small and fast, so drawn to stand out against dark asphalt: white rim, bright helmet/shirt
      const helmet = [0xe53935, 0xfdd835, 0xfafafa, 0x1e88e5, 0xff7043][variant % 5];
      const shirt = [0xfafafa, 0xffb300, 0x4fc3f7, 0xef5350, 0xaed581, 0xf48fb1][variant % 6];
      const rim = { color: 0xffffff, width: 0.14, alpha: 0.9 };
      g.roundRect(-1.0, -0.15, 2.0, 0.3, 0.12).fill(0x303030).stroke(rim);
      g.roundRect(0.52, -0.42, 0.12, 0.84, 0.05).fill(0xb0b0b0).stroke(rim); // handlebar
      if (variant % 3 === 0) g.roundRect(-0.88, -0.25, 0.42, 0.5, 0.18).fill(SAREE[variant % SAREE.length]).stroke(rim); // pillion
      g.roundRect(-0.6, -0.29, 0.92, 0.58, 0.24).fill(shirt).stroke(rim); // rider
      g.circle(0.07, 0, 0.2).fill(helmet).stroke({ color: 0x1a1a1a, width: 0.05 });
      g.circle(0.12, -0.06, 0.06).fill({ color: 0xffffff, alpha: 0.6 });
      g.circle(0.98, 0, 0.12).fill(0xfff3c4);
      break;
    }
    case 'leguna': {
      // small human-hauler minibus with roof rails and passengers hanging off the back
      const c = [0xf5f5f5, 0x26a69a, 0xffca28][variant % 3];
      const L = 4.0;
      const W = 1.65;
      g.roundRect(-L / 2, -W / 2, L, W, 0.3).fill(shade(c, 0.75));
      g.roundRect(-L / 2 + 0.05, -W / 2 + 0.05, L - 0.1, W - 0.1, 0.28).fill(c);
      windshield(g, L / 2 - 0.8, W, 0.35);
      g.rect(-L / 2 + 0.2, -W / 2 + 0.2, L - 1.3, W - 0.4).fill(shade(c, 0.9));
      for (const s of [-1, 1]) g.rect(-L / 2 + 0.2, s * (W / 2 - 0.25) - 0.03, L - 1.3, 0.06).fill(0x9e9e9e);
      g.circle(-L / 2 - 0.15, -0.3, 0.17).fill(0x2a1a12);
      g.circle(-L / 2 - 0.15, 0.3, 0.17).fill(0x2a1a12);
      break;
    }
    case 'truck': {
      // decorated Bangladeshi truck: painted cab, wooden body with tarp
      const c = TRUCK_COLORS[variant % TRUCK_COLORS.length];
      const L = 8;
      const W = 2.4;
      g.roundRect(L / 2 - 1.9, -W / 2, 1.9, W, 0.3).fill(shade(c, 0.8));
      g.roundRect(L / 2 - 1.85, -W / 2 + 0.06, 1.8, W - 0.12, 0.28).fill(c);
      windshield(g, L / 2 - 0.55, W, 0.4);
      g.rect(L / 2 - 1.6, -W / 2 + 0.15, 0.1, W - 0.3).fill(0xd32f2f);
      g.roundRect(-L / 2, -W / 2, L - 2.0, W, 0.15).fill(0x6d4c2f);
      g.roundRect(-L / 2 + 0.1, -W / 2 + 0.1, L - 2.2, W - 0.2, 0.12).fill([0x1565c0, 0x2e7d32, 0x5d4037][variant % 3]); // tarp
      for (let i = 0; i < 6; i++) g.rect(-L / 2 + 0.4 + i * 0.95, -W / 2 + 0.1, 0.06, W - 0.2).fill({ color: 0x000000, alpha: 0.2 });
      break;
    }
    case 'bus': {
      const [body, stripe] = BUS_LIVERIES[variant % BUS_LIVERIES.length];
      const L = 10.5;
      const W = 2.5;
      g.roundRect(-L / 2, -W / 2, L, W, 0.4).fill(shade(body, 0.8));
      g.roundRect(-L / 2 + 0.06, -W / 2 + 0.06, L - 0.12, W - 0.12, 0.36).fill(body);
      for (const s of [-1, 1]) g.rect(-L / 2 + 0.5, s * (W / 2 - 0.2) - 0.06, L - 1.3, 0.12).fill(stripe);
      g.roundRect(-L / 2 + 0.5, -W / 2 + 0.32, L - 1.2, W - 0.64, 0.28).fill(0xe6e0d0);
      g.roundRect(-L / 2 + 0.7, -0.4, L - 1.6, 0.8, 0.2).fill(0xece7da);
      g.roundRect(-L / 2 + L * 0.35, -0.33, 0.7, 0.66, 0.08).fill(0xc9c2b2);
      windshield(g, L / 2 - 0.6, W, 0.48);
      // dents and grime: Dhaka buses lead hard lives
      for (let i = 0; i < 4; i++) g.ellipse(-L / 2 + 1 + ((variant * 7 + i * 13) % 8), (i % 2 ? 1 : -1) * (W / 2 - 0.12), 0.35, 0.12).fill({ color: 0x000000, alpha: 0.25 });
      break;
    }
  }
  return g;
}

function drawPed(kind: PedKind, variant: number): Graphics {
  const g = new Graphics();
  if (kind === 'vendor') {
    // push-cart with fruit/vegetables, vendor standing behind it
    g.roundRect(-0.2, -0.55, 1.2, 1.1, 0.06).fill(0x8d6e63);
    g.roundRect(-0.15, -0.5, 1.1, 1.0, 0.05).fill(0x6d4c41);
    const goods = [0xffb300, 0x43a047, 0xe53935, 0xfdd835];
    for (let i = 0; i < 12; i++) g.circle(-0.05 + (i % 4) * 0.27, -0.35 + Math.floor(i / 4) * 0.33, 0.12).fill(goods[(i + variant) % goods.length]);
    g.ellipse(-0.45, 0, 0.18, 0.26).fill(SHIRT[variant % SHIRT.length]);
    g.circle(-0.43, 0, 0.11).fill(0x2a1a12);
    return g;
  }
  const body =
    kind === 'woman' ? SAREE[variant % SAREE.length] : kind === 'student' ? 0xf5f5f5 : SHIRT[variant % SHIRT.length];
  // shoulders / torso, seen from above
  g.ellipse(0, 0, 0.17, 0.25).fill(body);
  if (kind === 'woman') {
    // saree drape over one shoulder
    g.poly([-0.1, -0.24, 0.12, -0.1, 0.0, 0.24, -0.16, 0.05]).fill(shade(body, 0.75));
  }
  if (kind === 'student') {
    g.roundRect(-0.2, -0.16, 0.14, 0.32, 0.04).fill(0x1a237e); // school bag
  }
  // head: black hair, women with a scarf sometimes
  const head = kind === 'woman' && variant % 3 === 0 ? shade(body, 1.1) : 0x1f1510;
  g.circle(0.02, 0, 0.11).fill(head);
  return g;
}

export interface TrafficAtlas {
  vehicle(type: VType, variant: number): Texture;
  ped(kind: PedKind, variant: number): Texture;
}

const VARIANTS: Record<VType, number> = {
  car: CAR_COLORS.length,
  taxi: 1,
  police: 1,
  ambulance: 1,
  pickup: 4,
  cng: 1,
  rickshaw: RICKSHAW_HOODS.length,
  motorcycle: 5,
  leguna: 3,
  truck: 4,
  bus: BUS_LIVERIES.length,
};

export function buildAtlas(renderer: Renderer): TrafficAtlas {
  const vtex = new Map<string, Texture>();
  const ptex = new Map<string, Texture>();
  // Bake in pixels, not metres: generateTexture truncates its frame to whole units, which
  // in metres cut a 0.8 m-wide motorcycle down to a 5 cm sliver. The texture's default anchor
  // is the art's origin, and mipmaps keep small sprites solid when zoomed out.
  const bake = (g: Graphics) => {
    const b = g.getLocalBounds();
    g.scale.set(PX_PER_M);
    const wrap = new Container();
    wrap.addChild(g);
    const x = Math.floor(b.x * PX_PER_M) - 2;
    const y = Math.floor(b.y * PX_PER_M) - 2;
    const frame = new Rectangle(x, y, Math.ceil(b.maxX * PX_PER_M) + 2 - x, Math.ceil(b.maxY * PX_PER_M) + 2 - y);
    const t = renderer.generateTexture({
      target: wrap,
      frame,
      resolution: 1,
      antialias: true,
      defaultAnchor: { x: -frame.x / frame.width, y: -frame.y / frame.height },
      textureSourceOptions: { autoGenerateMipmaps: true, scaleMode: 'linear' },
    });
    wrap.destroy({ children: true });
    return t;
  };
  for (const [type, n] of Object.entries(VARIANTS) as Array<[VType, number]>)
    for (let i = 0; i < n; i++) vtex.set(`${type}:${i}`, bake(drawVehicle(type, i)));
  for (const kind of ['man', 'woman', 'student', 'vendor'] as PedKind[]) for (let i = 0; i < 8; i++) ptex.set(`${kind}:${i}`, bake(drawPed(kind, i)));
  return {
    vehicle: (type, variant) => vtex.get(`${type}:${variant % VARIANTS[type]}`)!,
    ped: (kind, variant) => ptex.get(`${kind}:${variant % 8}`)!,
  };
}
