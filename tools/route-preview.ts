// Draw built routes over the full-res validation render (data/work/<bbox>/map-full.png).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { RouteData } from '../src/shared/routes';
import { PUBLIC_DATA, ROOT } from './config';

async function main() {
  const index = JSON.parse(readFileSync(join(PUBLIC_DATA, 'index.json'), 'utf8'));
  const routes = JSON.parse(readFileSync(join(PUBLIC_DATA, 'routes.json'), 'utf8')) as RouteData[];
  const img = await loadImage(join(ROOT, 'data/work', index.bboxName, 'map-full.png'));
  const b = index.bounds;
  // crop to the routes' extent
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of routes) for (const d of r.dirs) for (let i = 0; i < d.line.length; i += 2) {
    x0 = Math.min(x0, d.line[i]); x1 = Math.max(x1, d.line[i]); y0 = Math.min(y0, d.line[i + 1]); y1 = Math.max(y1, d.line[i + 1]);
  }
  x0 -= 600; y0 -= 600; x1 += 600; y1 += 600;
  const sc = img.width / (b.maxX - b.minX);
  const W = 1600;
  const k = W / (x1 - x0);
  const cv = createCanvas(W, Math.round((y1 - y0) * k));
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, (x0 - b.minX) * sc, (y0 - b.minY) * sc, (x1 - x0) * sc, (y1 - y0) * sc, 0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, 0, cv.width, cv.height);
  routes.forEach((r, ri) => {
    for (const [di, d] of r.dirs.entries()) {
      ctx.strokeStyle = `#${r.color.toString(16).padStart(6, '0')}`;
      ctx.lineWidth = di === 0 ? 5 : 2;
      ctx.globalAlpha = di === 0 ? 0.75 : 1;
      ctx.beginPath();
      for (let i = 0; i < d.line.length; i += 2) {
        const px = (d.line[i] - x0) * k + ri * 2;
        const py = (d.line[i + 1] - y0) * k + ri * 2;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (di === 0) for (const s of d.stops) {
        ctx.fillStyle = s.match === 'manual' ? '#ff00ff' : '#111';
        ctx.beginPath(); ctx.arc((s.x - x0) * k, (s.y - y0) * k, 4, 0, Math.PI * 2); ctx.fill();
        ctx.font = '12px sans-serif'; ctx.fillText(s.name, (s.x - x0) * k + 6, (s.y - y0) * k - 4);
      }
    }
  });
  const out = join(ROOT, 'data/work', index.bboxName, 'routes-preview.png');
  writeFileSync(out, cv.toBuffer('image/png'));
  console.log('wrote', out);
}
main();
