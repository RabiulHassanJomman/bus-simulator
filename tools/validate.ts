// `npm run data:validate` — counts per layer, PNG renders, landmark position checks.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import { buildChunk, type BuiltChunk, type LayerName } from '../src/world/buildChunk';
import { project } from '../src/shared/geo';
import type { WorldIndex } from '../src/shared/format';
import { PUBLIC_DATA, ROOT } from './config';
import { LANDMARKS } from './landmarks';

export function loadIndex(): WorldIndex {
  return JSON.parse(readFileSync(join(PUBLIC_DATA, 'index.json'), 'utf8'));
}

export function* iterChunks(index: WorldIndex): Generator<BuiltChunk> {
  for (const key of Object.keys(index.lods[0].chunks)) {
    const [cx, cy] = key.split(',').map(Number);
    const gz = readFileSync(join(PUBLIC_DATA, `lod0/${cx}_${cy}.dbc`));
    const raw = gunzipSync(gz);
    yield buildChunk(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  }
}

export interface LandmarkResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  distance?: number;
  found?: string;
}

/** Nearest feature whose (English or Bangla) name matches, per landmark. */
export function checkLandmarks(index: WorldIndex, chunks?: BuiltChunk[]): LandmarkResult[] {
  const best = LANDMARKS.map(() => ({ d: Infinity, name: '' }));
  const targets = LANDMARKS.map((l) => project(l.lon, l.lat));
  const consider = (i: number, x: number, y: number, name: string) => {
    const d = Math.hypot(x - targets[i][0], y - targets[i][1]);
    if (d < best[i].d) best[i] = { d, name };
  };
  for (const c of chunks ?? iterChunks(index)) {
    const ox = c.cx * c.size;
    const oy = c.cy * c.size;
    LANDMARKS.forEach((lm, i) => {
      for (const p of c.points) {
        const n = `${p.name} ${p.nameBn}`;
        if (lm.match.test(n)) consider(i, p.x + ox, p.y + oy, n.trim());
      }
      for (const l of c.labels) {
        const n = `${l.name} ${l.nameBn}`;
        if (!lm.match.test(n)) continue;
        for (let k = 0; k < l.pts.length; k += 2) consider(i, l.pts[k] + ox, l.pts[k + 1] + oy, n.trim());
      }
    });
  }
  const b = index.bbox;
  return LANDMARKS.map((lm, i) => {
    const inside = lm.lat >= b.minLat && lm.lat <= b.maxLat && lm.lon >= b.minLon && lm.lon <= b.maxLon;
    if (!inside) return { name: lm.name, status: 'SKIP' as const };
    const r = best[i];
    return {
      name: lm.name,
      status: r.d <= lm.radius ? ('PASS' as const) : ('FAIL' as const),
      distance: Number.isFinite(r.d) ? Math.round(r.d) : undefined,
      found: r.name || undefined,
    };
  });
}

const DRAW: LayerName[] = ['land', 'water', 'paths', 'roadCasing', 'roadFill', 'roadMark', 'rail', 'bldShadow', 'bld', 'bridgeShadow', 'bridges', 'metroShadow', 'metro'];

/** Rasterise built chunk meshes (same geometry the game uploads to the GPU). */
function render(chunks: BuiltChunk[], x0: number, y0: number, x1: number, y1: number, width: number, layers: LayerName[], out: string) {
  const scale = width / (x1 - x0);
  const height = Math.round((y1 - y0) * scale);
  const cv = createCanvas(width, height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#d8d1c1';
  ctx.fillRect(0, 0, width, height);
  for (const name of layers) {
    const shadow = name.endsWith('Shadow');
    for (const c of chunks) {
      const m = c.layers[name];
      if (!m) continue;
      const ox = c.cx * c.size;
      const oy = c.cy * c.size;
      if (ox > x1 || oy > y1 || ox + c.size < x0 || oy + c.size < y0) continue;
      const sun = [0.42, 0.55];
      const px = (i: number) => (m.pos[i * 2] + ox + (shadow ? sun[0] * m.ext![i] : 0) - x0) * scale;
      const py = (i: number) => (m.pos[i * 2 + 1] + oy + (shadow ? sun[1] * m.ext![i] : 0) - y0) * scale;
      let cur = -1;
      ctx.beginPath();
      for (let t = 0; t < m.idx.length; t += 3) {
        const a = m.idx[t];
        const col = shadow ? 0 : (m.col![a * 4] << 16) | (m.col![a * 4 + 1] << 8) | m.col![a * 4 + 2];
        if (col !== cur) {
          if (cur !== -1) ctx.fill();
          ctx.beginPath();
          cur = col;
          ctx.fillStyle = shadow ? 'rgba(33,30,40,0.3)' : `#${col.toString(16).padStart(6, '0')}`;
        }
        ctx.moveTo(px(a), py(a));
        ctx.lineTo(px(m.idx[t + 1]), py(m.idx[t + 1]));
        ctx.lineTo(px(m.idx[t + 2]), py(m.idx[t + 2]));
        ctx.closePath();
      }
      if (cur !== -1) ctx.fill();
    }
  }
  writeFileSync(out, cv.toBuffer('image/png'));
  console.log(`  wrote ${out} (${width}x${height})`);
}

async function main() {
  if (!existsSync(join(PUBLIC_DATA, 'index.json'))) throw new Error('No data. Run "npm run data:build" first.');
  const index = loadIndex();
  console.log(`World "${index.bboxName}" generated ${index.generated}`);
  console.log('Feature counts:');
  for (const [k, v] of Object.entries(index.counts).sort()) console.log(`  ${k.padEnd(28)} ${v}`);
  const sizes = Object.values(index.lods[0].chunks);
  console.log(`Chunks: ${sizes.length}, total ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(2)} MB, max ${(Math.max(...sizes) / 1e3).toFixed(0)} KB`);

  const t0 = Date.now();
  const chunks = [...iterChunks(index)];
  const verts = chunks.reduce((a, c) => a + c.stats.vertices, 0);
  console.log(`Tessellated all chunks in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(verts / 1e6).toFixed(2)}M vertices`);

  // full-resolution renders go to the (gitignored) work dir; small previews to docs/img
  const workOut = join(ROOT, 'data/work', index.bboxName);
  const docOut = join(ROOT, 'docs/img');
  mkdirSync(workOut, { recursive: true });
  mkdirSync(docOut, { recursive: true });
  const b = index.bounds;
  const overview: LayerName[] = ['land', 'water', 'roadCasing', 'roadFill', 'rail', 'bld', 'bridges', 'metro'];
  render(chunks, b.minX, b.minY, b.maxX, b.maxY, 4000, overview, join(workOut, 'map-full.png'));
  render(chunks, b.minX, b.minY, b.maxX, b.maxY, 1000, overview, join(docOut, `map-${index.bboxName}.png`));
  // close-up around Shahbag, all layers
  const [sx, sy] = project(90.3958, 23.7383);
  render(chunks, sx - 400, sy - 300, sx + 400, sy + 300, 1400, DRAW, join(workOut, 'detail-shahbag.png'));
  render(chunks, sx - 250, sy - 160, sx + 250, sy + 160, 800, DRAW, join(docOut, 'detail-shahbag.png'));

  console.log('Landmarks:');
  const res = checkLandmarks(index, chunks);
  for (const r of res)
    console.log(`  [${r.status}] ${r.name.padEnd(28)} ${r.distance !== undefined ? `${r.distance} m` : ''} ${r.found ? `← "${r.found}"` : ''}`);
  const failed = res.filter((r) => r.status === 'FAIL');
  if (failed.length) {
    console.error(`${failed.length} landmark check(s) failed`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
