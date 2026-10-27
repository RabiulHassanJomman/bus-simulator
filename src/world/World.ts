// Streams multi-LOD chunks around the camera and owns the layered scene graph.
import { AlphaFilter, Container, Rectangle, type Geometry, type Mesh, type Shader } from 'pixi.js';
import { LAYERS, SHADOW_LAYERS, type BuiltChunk, type LayerName } from './buildChunk';
import { colorMesh, shadowMesh } from '../render/shaders';
import { WorkerPool } from './WorkerPool';
import { XrayFilter } from '../render/XrayFilter';
import { chunkUrl, type WorldIndex } from '../shared/format';
import type { Rect } from '../game/Camera';

export interface ChunkEntry {
  key: string;
  lod: number;
  cx: number;
  cy: number;
  size: number;
  state: 'loading' | 'ready' | 'failed';
  meshes: Mesh<Geometry, Shader>[];
  built?: BuiltChunk;
  visible: boolean;
}

const MAX_IN_FLIGHT = 10;
const KEEP_MARGIN_CHUNKS = 2;
/** zoom (px/m) thresholds: >= LOD0_MIN → LOD0, >= LOD1_MIN → LOD1, else LOD2 */
export const LOD0_MIN = 0.42;
export const LOD1_MIN = 0.1;

export class World {
  readonly root = new Container();
  readonly layers = {} as Record<LayerName, Container>;
  /** Ground-level entities (vehicles, pedestrians): above shadows, below buildings/flyovers. */
  readonly entities = new Container({ label: 'entities' });
  /** Entities on flyovers/expressway decks: above the 'upper' layer. */
  readonly entitiesElevated = new Container({ label: 'entitiesElevated' });
  /** Always on top of the world (e.g. bus outline visible under flyovers). */
  readonly top = new Container({ label: 'top' });
  readonly chunks = new Map<string, ChunkEntry>();
  private pool = new WorkerPool();
  private shadowLayers: Container[] = [];
  readonly lodSizes: number[];
  readonly available: Set<string>[];
  lod = 0;
  shadows = true;
  /** see-through hole in overhead structures (set by setXray) */
  private xray = new XrayFilter();
  private xrayOn = false;
  onChunkReady?: (c: ChunkEntry) => void;
  onChunkRemoved?: (c: ChunkEntry) => void;
  stats = { loaded: 0, visible: 0, vertices: 0, failed: 0 };

  constructor(public index: WorldIndex) {
    this.lodSizes = index.lods.map((l) => l.size);
    this.available = index.lods.map((l) => new Set(Object.keys(l.chunks)));
    for (const name of LAYERS) {
      const c = new Container({ label: name, sortableChildren: true });
      if (SHADOW_LAYERS.has(name)) {
        // render shadow volumes opaque, then composite once with alpha so overlaps don't darken
        c.filters = [new AlphaFilter({ alpha: 0.3 })];
        c.filterArea = new Rectangle();
        this.shadowLayers.push(c);
      }
      this.layers[name] = c;
      this.root.addChild(c);
      if (name === 'shadow') this.root.addChild(this.entities);
      if (name === 'upper') this.root.addChild(this.entitiesElevated);
    }
    this.root.addChild(this.top);
  }

  pickLod(zoom: number): number {
    const max = this.lodSizes.length - 1;
    // hysteresis: stay in the current LOD within ±12% of a threshold
    const h = (t: number, below: boolean) => t * (below ? 0.88 : 1.12);
    let lod: number;
    if (zoom >= h(LOD0_MIN, this.lod === 0)) lod = 0;
    else if (zoom >= h(LOD1_MIN, this.lod <= 1)) lod = 1;
    else lod = 2;
    return Math.min(lod, max);
  }

  private range(view: Rect, lod: number) {
    const s = this.lodSizes[lod];
    return { x0: Math.floor(view.x0 / s), y0: Math.floor(view.y0 / s), x1: Math.floor(view.x1 / s), y1: Math.floor(view.y1 / s) };
  }

  /**
   * Request/unload chunks for the given view and zoom; cull meshes.
   * `focus` (the player's bus) always keeps the surrounding LOD0 chunks loaded, because
   * physics needs their collision data even when the camera shows a coarser LOD.
   */
  update(view: Rect, zoom: number, focus?: { x: number; y: number }) {
    this.lod = this.pickLod(zoom);
    const r = this.range(view, this.lod);
    const keep0 = new Set<string>();
    if (focus) {
      const s0 = this.lodSizes[0];
      const fx = Math.floor(focus.x / s0);
      const fy = Math.floor(focus.y / s0);
      for (let cy = fy - 1; cy <= fy + 1; cy++)
        for (let cx = fx - 1; cx <= fx + 1; cx++) {
          if (!this.available[0].has(`${cx},${cy}`)) continue;
          const key = `0:${cx},${cy}`;
          keep0.add(key);
          if (!this.chunks.has(key) && this.pool.inFlight < MAX_IN_FLIGHT) this.load(0, cx, cy);
        }
    }

    // load missing chunks of the active LOD, nearest to centre first
    const mx = (r.x0 + r.x1) / 2;
    const my = (r.y0 + r.y1) / 2;
    const want: Array<[number, number, number]> = [];
    const avail = this.available[this.lod];
    let pendingInView = 0;
    for (let cy = r.y0 - 1; cy <= r.y1 + 1; cy++)
      for (let cx = r.x0 - 1; cx <= r.x1 + 1; cx++) {
        const key = `${this.lod}:${cx},${cy}`;
        if (!avail.has(`${cx},${cy}`)) continue;
        const e = this.chunks.get(key);
        const inView = cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
        if (!e) {
          want.push([cx, cy, (cx - mx) ** 2 + (cy - my) ** 2]);
          if (inView) pendingInView++;
        } else if (e.state === 'loading' && inView) pendingInView++;
      }
    want.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of want) {
      if (this.pool.inFlight >= MAX_IN_FLIGHT) break;
      this.load(this.lod, cx, cy);
    }

    // unload: other LODs once the active LOD covers the view; far chunks of any LOD
    let visible = 0;
    for (const e of this.chunks.values()) {
      if (e.state === 'loading') continue;
      const er = this.range(view, e.lod);
      const far =
        e.cx < er.x0 - KEEP_MARGIN_CHUNKS || e.cx > er.x1 + KEEP_MARGIN_CHUNKS || e.cy < er.y0 - KEEP_MARGIN_CHUNKS || e.cy > er.y1 + KEEP_MARGIN_CHUNKS;
      const pinned = keep0.has(e.key);
      if (!pinned && (far || (e.lod !== this.lod && pendingInView === 0))) {
        this.unload(e);
        continue;
      }
      // line overlap means neighbours can draw into view: keep a 1-chunk ring visible
      const ring = e.cx >= er.x0 - 1 && e.cx <= er.x1 + 1 && e.cy >= er.y0 - 1 && e.cy <= er.y1 + 1;
      const v = ring && (e.lod === this.lod || pendingInView > 0);
      if (v !== e.visible) {
        e.visible = v;
        for (const m of e.meshes) m.visible = v;
      }
      if (v) visible++;
    }
    this.stats.visible = visible;

    const pad = 200 / Math.max(zoom, 0.05);
    const up = this.layers.upper;
    for (const c of [...this.shadowLayers, up]) {
      if (c !== up) c.visible = this.shadows && this.lod === 0;
      const fr = (c.filterArea ??= new Rectangle());
      fr.x = view.x0 - pad;
      fr.y = view.y0 - pad;
      fr.width = view.x1 - view.x0 + pad * 2;
      fr.height = view.y1 - view.y0 + pad * 2;
    }
  }

  /**
   * Fade overhead layers (flyovers, metro, buildings) inside a screen-space circle so the
   * ground under them is visible. strength 0 disables the extra render pass.
   */
  setXray(x: number, y: number, radius: number, strength: number) {
    const on = strength > 0.01;
    if (on !== this.xrayOn) {
      this.xrayOn = on;
      this.layers.upper.filters = on ? [this.xray] : null;
    }
    if (on) this.xray.set(x, y, radius, radius * 0.45, 1 - 0.85 * strength);
  }

  private load(lod: number, cx: number, cy: number) {
    const key = `${lod}:${cx},${cy}`;
    const size = this.lodSizes[lod];
    const e: ChunkEntry = { key, lod, cx, cy, size, state: 'loading', meshes: [], visible: true };
    this.chunks.set(key, e);
    this.pool
      .load(chunkUrl(lod, cx, cy))
      .then((built) => {
        if (this.chunks.get(key) !== e) return; // unloaded meanwhile
        e.built = built;
        e.state = 'ready';
        for (const name of LAYERS) {
          const d = built.layers[name];
          if (!d) continue;
          const m = SHADOW_LAYERS.has(name) ? shadowMesh(d) : colorMesh(d);
          m.position.set(cx * size, cy * size);
          // coarser LODs underneath finer ones during transitions
          m.zIndex = -lod;
          this.layers[name].addChild(m);
          e.meshes.push(m);
        }
        this.stats.loaded++;
        this.stats.vertices += built.stats.vertices;
        this.onChunkReady?.(e);
      })
      .catch((err) => {
        console.warn('chunk failed', key, err);
        e.state = 'failed';
        this.stats.failed++;
      });
  }

  private unload(e: ChunkEntry) {
    for (const m of e.meshes) {
      m.geometry.destroy(true);
      m.destroy();
    }
    if (e.built) {
      this.stats.loaded--;
      this.stats.vertices -= e.built.stats.vertices;
    }
    this.chunks.delete(e.key);
    this.onChunkRemoved?.(e);
  }

  get loading() {
    return this.pool.inFlight;
  }

  /** Fetch + tessellate a chunk without adding it to the scene (minimap). */
  fetchChunk(lod: number, cx: number, cy: number) {
    return this.pool.load(chunkUrl(lod, cx, cy));
  }
}
