// Minimap (corner, follows camera) and fullscreen map overlay (M) with place search.
// Both show the same LOD2 meshes, re-parented between the two views.
import { Container, Graphics, Text, type Application } from 'pixi.js';
import type { World } from '../world/World';
import type { Camera } from '../game/Camera';
import type { BuiltChunk, LayerName } from '../world/buildChunk';
import { colorMesh } from '../render/shaders';
import { FONT_FAMILY, type Lang } from '../render/Labels';
import { PointKind } from '../shared/kinds';
import { BACKGROUND } from '../render/palette';

const MAP_LAYERS: LayerName[] = ['ground', 'upper'];
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** smaller minimap, top-right, on phones (bottom-right is taken by the pedals) */
const MINI_RADIUS = COARSE ? 58 : 92;
const MINI_ZOOM = 0.03; // px per metre

interface Place {
  n: string;
  b?: string;
  k: string;
  x: number;
  y: number;
}

export class MapView {
  readonly mapWorld = new Container({ label: 'mapWorld' });
  readonly mini = new Container({ label: 'minimap' });
  readonly full = new Container({ label: 'fullmap' });
  private miniHolder = new Container();
  private miniMarker = new Graphics();
  private fullBg = new Graphics();
  private fullMarker = new Graphics();
  private fullLabels = new Container();
  private placeLabels: Array<{ t: Text; x: number; y: number; rank: number }> = [];
  private fullZoom = 0.02;
  private fullX = 0;
  private fullY = 0;
  private places: Place[] | null = null;
  private searchEl: HTMLDivElement;
  private input: HTMLInputElement;
  private results: HTMLUListElement;
  isOpen = false;
  rotateWithCamera = true;
  lang: Lang = 'en';
  /** extra world-space overlays (route line etc.) drawn on both maps */
  readonly overlay = new Container();

  constructor(
    private app: Application,
    private world: World,
    private cam: Camera,
  ) {
    const b = world.index.bounds;
    this.fullX = (b.minX + b.maxX) / 2;
    this.fullY = (b.minY + b.maxY) / 2;

    // load all LOD2 chunks once
    const lod2 = world.index.lods[2];
    if (lod2)
      for (const key of Object.keys(lod2.chunks)) {
        const [cx, cy] = key.split(',').map(Number);
        world.fetchChunk(2, cx, cy).then((c) => this.addChunk(c));
      }
    // land backdrop under the LOD2 meshes (the main view uses the renderer clear colour)
    this.mapWorld.addChild(new Graphics().rect(b.minX - 9000, b.minY - 9000, b.maxX - b.minX + 18000, b.maxY - b.minY + 18000).fill(BACKGROUND));
    this.mapWorld.addChild(this.overlay);

    // minimap frame
    const ring = new Graphics().circle(0, 0, MINI_RADIUS + 4).fill({ color: 0x1b1d21, alpha: 0.85 }).circle(0, 0, MINI_RADIUS).fill(0xd8d1c1);
    const mask = new Graphics().circle(0, 0, MINI_RADIUS).fill(0xffffff);
    this.miniHolder.mask = mask;
    this.miniMarker.poly([0, -9, 6.5, 7, 0, 3.5, -6.5, 7]).fill(0xe53935).stroke({ color: 0xffffff, width: 1.5 });
    const north = new Text({ text: 'N', style: { fontFamily: FONT_FAMILY, fontSize: 11, fontWeight: '700', fill: 0xffffff } });
    north.anchor.set(0.5);
    north.label = 'north';
    this.mini.addChild(ring, this.miniHolder, mask, this.miniMarker, north);
    this.miniHolder.addChild(this.mapWorld);

    // fullscreen map
    this.fullMarker.poly([0, -12, 9, 10, 0, 5, -9, 10]).fill(0xe53935).stroke({ color: 0xffffff, width: 2 });
    this.full.addChild(this.fullBg, this.fullLabels, this.fullMarker);
    this.full.visible = false;

    // search box (HTML)
    this.searchEl = document.createElement('div');
    this.searchEl.id = 'map-search';
    this.searchEl.hidden = true;
    this.searchEl.innerHTML =
      '<div class="map-title">Dhaka — <span>click to jump, drag to pan, wheel to zoom, M to close</span></div>' +
      '<input type="search" placeholder="Search a road, area or landmark (English / বাংলা)…" autocomplete="off" />' +
      '<ul></ul>';
    document.body.appendChild(this.searchEl);
    this.input = this.searchEl.querySelector('input')!;
    this.results = this.searchEl.querySelector('ul')!;
    this.input.addEventListener('input', () => this.search(this.input.value));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') (this.results.querySelector('li') as HTMLLIElement | null)?.click();
      if (e.key === 'Escape') this.toggle(false);
    });
    this.bindFullInput();
  }

  private addChunk(c: BuiltChunk) {
    const holder = new Container();
    holder.position.set(c.cx * c.size, c.cy * c.size);
    for (const name of MAP_LAYERS) {
      const d = c.layers[name];
      if (d) holder.addChild(colorMesh(d));
    }
    // insert below the overlay (route lines)
    this.mapWorld.addChildAt(holder, Math.max(0, this.mapWorld.children.length - 1));
    for (const p of c.points) {
      if (p.kind !== PointKind.Place || !(p.name || p.nameBn)) continue;
      const rank = p.sub === 'city' || p.sub === 'town' ? 0 : p.sub === 'suburb' ? 1 : 2;
      const t = new Text({
        text: '',
        style: { fontFamily: FONT_FAMILY, fontSize: rank === 0 ? 15 : rank === 1 ? 12.5 : 11, fontWeight: rank < 2 ? '700' : '500', fill: 0x24232b, stroke: { color: 0xffffff, width: 3 } },
        anchor: 0.5,
      });
      (t as Text & { names: [string, string] }).names = [p.name, p.nameBn];
      this.placeLabels.push({ t, x: c.cx * c.size + p.x, y: c.cy * c.size + p.y, rank });
      this.fullLabels.addChild(t);
    }
  }

  toggle(open = !this.isOpen) {
    this.isOpen = open;
    this.full.visible = open;
    this.mini.visible = !open;
    this.searchEl.hidden = !open;
    (open ? this.full : this.miniHolder).addChildAt(this.mapWorld, open ? 1 : 0);
    if (open) {
      this.fullX = this.cam.x;
      this.fullY = this.cam.y;
      const b = this.world.index.bounds;
      this.fullZoom = Math.min(this.app.screen.width / (b.maxX - b.minX), this.app.screen.height / (b.maxY - b.minY)) * 0.9;
      this.fullZoom = Math.max(this.fullZoom, 0.025);
      this.input.value = '';
      this.results.innerHTML = '';
      setTimeout(() => this.input.focus(), 0);
    } else this.input.blur();
  }

  private bindFullInput() {
    const canvas = this.app.canvas;
    let down: { x: number; y: number; moved: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.isOpen) down = { x: e.clientX, y: e.clientY, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.isOpen || !down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
      this.fullX -= dx / this.fullZoom;
      this.fullY -= dy / this.fullZoom;
      down.x = e.clientX;
      down.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.isOpen || !down) return;
      if (!down.moved) {
        const [wx, wy] = this.fullToWorld(e.clientX, e.clientY);
        this.jump(wx, wy);
      }
      down = null;
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.isOpen) return;
      const [wx, wy] = this.fullToWorld(e.clientX, e.clientY);
      this.fullZoom = Math.min(0.5, Math.max(0.01, this.fullZoom * Math.exp(-e.deltaY * 0.0015)));
      const [nx, ny] = this.fullToWorld(e.clientX, e.clientY);
      this.fullX += wx - nx;
      this.fullY += wy - ny;
    });
  }

  private fullToWorld(sx: number, sy: number): [number, number] {
    return [this.fullX + (sx - this.app.screen.width / 2) / this.fullZoom, this.fullY + (sy - this.app.screen.height / 2) / this.fullZoom];
  }

  /** Called when the user picks a place; main.ts overrides to move the bus/camera. */
  onJump = (x: number, y: number) => {
    this.cam.x = x;
    this.cam.y = y;
    this.cam.zoom = Math.max(this.cam.zoom, 1);
  };

  private jump(x: number, y: number) {
    this.onJump(x, y);
    this.toggle(false);
  }

  private async search(q: string) {
    q = q.trim().toLowerCase();
    if (!this.places) this.places = (await (await fetch('data/places.json')).json()) as Place[];
    this.results.innerHTML = '';
    if (q.length < 2) return;
    const rank = (p: Place) => {
      const n = p.n.toLowerCase();
      const b = p.b ?? '';
      const starts = n.startsWith(q) || b.startsWith(q);
      const kindBoost = { suburb: 0, quarter: 0, neighbourhood: 1, landmark: 1, station: 1, road: 2 }[p.k] ?? 3;
      return (starts ? 0 : 10) + kindBoost + n.length / 100;
    };
    const hits = this.places.filter((p) => p.n.toLowerCase().includes(q) || (p.b && p.b.includes(q))).sort((a, b) => rank(a) - rank(b));
    for (const p of hits.slice(0, 9)) {
      const li = document.createElement('li');
      const label = this.lang === 'bn' && p.b ? `${p.b} · ${p.n}` : p.b ? `${p.n} · ${p.b}` : p.n;
      li.innerHTML = `<b></b><span></span>`;
      li.querySelector('b')!.textContent = label;
      li.querySelector('span')!.textContent = p.k.replace('_', ' ');
      li.addEventListener('click', () => this.jump(p.x, p.y));
      this.results.appendChild(li);
    }
  }

  update() {
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    if (this.isOpen) {
      this.fullBg.clear().rect(0, 0, W, H).fill({ color: 0x14161a, alpha: 0.82 });
      this.mapWorld.pivot.set(this.fullX, this.fullY);
      this.mapWorld.position.set(W / 2, H / 2);
      this.mapWorld.scale.set(this.fullZoom);
      this.mapWorld.rotation = 0;
      this.fullMarker.position.set(W / 2 + (this.cam.x - this.fullX) * this.fullZoom, H / 2 + (this.cam.y - this.fullY) * this.fullZoom);
      this.fullMarker.rotation = this.cam.rotation;
      // place labels: thin out by rank at low zoom
      const placed: Array<[number, number, number, number]> = [];
      for (const pl of [...this.placeLabels].sort((a, b) => a.rank - b.rank)) {
        const [en, bn] = (pl.t as Text & { names: [string, string] }).names;
        const s = this.lang === 'bn' ? bn || en : en || bn;
        if (pl.t.text !== s) pl.t.text = s;
        const sx = W / 2 + (pl.x - this.fullX) * this.fullZoom;
        const sy = H / 2 + (pl.y - this.fullY) * this.fullZoom;
        const minZ = [0, 0.018, 0.05][pl.rank];
        const w = pl.t.width / 2 + 4;
        const h = pl.t.height / 2 + 2;
        const ok = this.fullZoom >= minZ && sx > -50 && sy > -20 && sx < W + 50 && sy < H + 20 && !placed.some((p) => sx - w < p[2] && sx + w > p[0] && sy - h < p[3] && sy + h > p[1]);
        pl.t.visible = ok;
        if (ok) {
          placed.push([sx - w, sy - h, sx + w, sy + h]);
          pl.t.position.set(sx, sy);
        }
      }
      return;
    }
    // minimap in the bottom-right corner
    const r = MINI_RADIUS;
    if (COARSE) this.mini.position.set(W - r - 12, 104 + r);
    else this.mini.position.set(W - r - 16, H - r - 28);
    this.mapWorld.pivot.set(this.cam.x, this.cam.y);
    this.mapWorld.position.set(0, 0);
    this.mapWorld.scale.set(MINI_ZOOM);
    this.mapWorld.rotation = this.rotateWithCamera ? -this.cam.rotation : 0;
    this.miniMarker.rotation = this.rotateWithCamera ? 0 : this.cam.rotation;
    const north = this.mini.getChildByLabel('north')!;
    const na = this.rotateWithCamera ? -this.cam.rotation : 0;
    north.position.set(Math.sin(na) * (r - 10), -Math.cos(na) * (r - 10));
  }
}
