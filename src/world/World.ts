// Streams chunks around the camera and owns the layered scene graph.
import { AlphaFilter, Container, Rectangle, type Geometry, type Mesh, type Shader } from 'pixi.js';
import { LAYERS, SHADOW_LAYERS, type BuiltChunk, type LayerName } from './buildChunk';
import { colorMesh, shadowMesh } from '../render/shaders';
import { WorkerPool } from './WorkerPool';
import { chunkUrl, type WorldIndex } from '../shared/format';
import type { Rect } from '../game/Camera';

interface ChunkEntry {
  key: string;
  cx: number;
  cy: number;
  state: 'loading' | 'ready' | 'failed';
  meshes: Mesh<Geometry, Shader>[];
  built?: BuiltChunk;
  visible: boolean;
}

const MAX_IN_FLIGHT = 8;
const KEEP_MARGIN_CHUNKS = 3;

export class World {
  readonly root = new Container();
  readonly layers = {} as Record<LayerName, Container>;
  /** Container for entities (vehicles, pedestrians) between ground and bridges. */
  readonly entities = new Container();
  readonly chunks = new Map<string, ChunkEntry>();
  private pool = new WorkerPool();
  private shadowFilters: Container[] = [];
  readonly size: number;
  readonly available: Set<string>;
  onChunkReady?: (c: BuiltChunk) => void;
  onChunkRemoved?: (key: string) => void;
  stats = { loaded: 0, visible: 0, vertices: 0, failed: 0, loadMs: 0 };

  constructor(public index: WorldIndex) {
    this.size = index.lods[0].size;
    this.available = new Set(Object.keys(index.lods[0].chunks));
    for (const name of LAYERS) {
      const c = new Container({ label: name });
      if (SHADOW_LAYERS.has(name)) {
        // render shadow volumes opaque, then composite once with alpha so overlaps don't darken
        c.filters = [new AlphaFilter({ alpha: name === 'bldShadow' ? 0.3 : 0.26 })];
        c.filterArea = new Rectangle();
        this.shadowFilters.push(c);
      }
      this.layers[name] = c;
      this.root.addChild(c);
      if (name === 'bld') this.root.addChild(this.entities);
    }
  }

  /** Request/unload chunks for the given view and cull meshes. */
  update(view: Rect) {
    const s = this.size;
    const cx0 = Math.floor(view.x0 / s);
    const cy0 = Math.floor(view.y0 / s);
    const cx1 = Math.floor(view.x1 / s);
    const cy1 = Math.floor(view.y1 / s);

    // load missing, nearest to centre first
    const mx = (cx0 + cx1) / 2;
    const my = (cy0 + cy1) / 2;
    const want: Array<[number, number, number]> = [];
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++)
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
        const key = `${cx},${cy}`;
        if (!this.available.has(key) || this.chunks.has(key)) continue;
        want.push([cx, cy, (cx - mx) ** 2 + (cy - my) ** 2]);
      }
    want.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of want) {
      if (this.pool.inFlight >= MAX_IN_FLIGHT) break;
      this.load(cx, cy);
    }

    // unload far chunks, cull the rest
    let visible = 0;
    for (const e of this.chunks.values()) {
      if (e.state === 'loading') continue;
      const far =
        e.cx < cx0 - KEEP_MARGIN_CHUNKS || e.cx > cx1 + KEEP_MARGIN_CHUNKS || e.cy < cy0 - KEEP_MARGIN_CHUNKS || e.cy > cy1 + KEEP_MARGIN_CHUNKS;
      if (far) {
        this.unload(e);
        continue;
      }
      const vis = e.cx >= cx0 - 0 && e.cx <= cx1 && e.cy >= cy0 && e.cy <= cy1;
      // line overlap means neighbours can draw into view: include 1-chunk ring cheaply
      const near = e.cx >= cx0 - 1 && e.cx <= cx1 + 1 && e.cy >= cy0 - 1 && e.cy <= cy1 + 1;
      const v = vis || near;
      if (v !== e.visible) {
        e.visible = v;
        for (const m of e.meshes) m.visible = v;
      }
      if (v) visible++;
    }
    this.stats.visible = visible;

    const pad = 200;
    for (const c of this.shadowFilters) {
      const r = c.filterArea!;
      r.x = view.x0 - pad;
      r.y = view.y0 - pad;
      r.width = view.x1 - view.x0 + pad * 2;
      r.height = view.y1 - view.y0 + pad * 2;
    }
  }

  private load(cx: number, cy: number) {
    const key = `${cx},${cy}`;
    const e: ChunkEntry = { key, cx, cy, state: 'loading', meshes: [], visible: true };
    this.chunks.set(key, e);
    this.pool
      .load(chunkUrl(0, cx, cy))
      .then((built) => {
        if (this.chunks.get(key) !== e) return; // unloaded meanwhile
        e.built = built;
        e.state = 'ready';
        for (const name of LAYERS) {
          const d = built.layers[name];
          if (!d) continue;
          const m = SHADOW_LAYERS.has(name) ? shadowMesh(d) : colorMesh(d);
          m.position.set(cx * this.size, cy * this.size);
          this.layers[name].addChild(m);
          e.meshes.push(m);
        }
        this.stats.loaded++;
        this.stats.vertices += built.stats.vertices;
        this.onChunkReady?.(built);
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
    this.onChunkRemoved?.(e.key);
  }

  get loading() {
    return this.pool.inFlight;
  }
}
