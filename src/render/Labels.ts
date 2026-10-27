// Screen-space labels: road names along roads, place names, landmarks.
// Text objects are cached per string/style and placed greedily by priority with
// rectangle collision so the map never gets cluttered.
import { Container, Text, type TextStyleOptions } from 'pixi.js';
import type { ChunkEntry } from '../world/World';
import type { Camera } from '../game/Camera';
import { PointKind, RoadClass, LF_BRIDGE } from '../shared/kinds';
import { roadCasing, roadWidth } from '../shared/style';

export type Lang = 'en' | 'bn';

export const FONT_FAMILY = "'Noto Sans', 'Noto Sans Bengali', system-ui, sans-serif";

type Style = 'road' | 'roadMajor' | 'flyover' | 'place' | 'placeMajor' | 'landmark' | 'station';

const STYLES: Record<Style, TextStyleOptions> = {
  road: { fontFamily: FONT_FAMILY, fontSize: 11, fill: 0x2d2d2f, stroke: { color: 0xf4f1ea, width: 3 } },
  roadMajor: { fontFamily: FONT_FAMILY, fontSize: 12.5, fontWeight: '600', fill: 0x26272b, stroke: { color: 0xf7f4ec, width: 3.5 } },
  flyover: { fontFamily: FONT_FAMILY, fontSize: 12.5, fontWeight: '700', fill: 0x5b3f12, stroke: { color: 0xfff4d6, width: 3.5 } },
  place: { fontFamily: FONT_FAMILY, fontSize: 13, fontWeight: '600', fill: 0x3b3a44, stroke: { color: 0xffffff, width: 3.5 }, letterSpacing: 0.5 },
  placeMajor: { fontFamily: FONT_FAMILY, fontSize: 17, fontWeight: '700', fill: 0x2a2933, stroke: { color: 0xffffff, width: 4 }, letterSpacing: 1 },
  landmark: { fontFamily: FONT_FAMILY, fontSize: 11.5, fontStyle: 'italic', fill: 0x6b3d14, stroke: { color: 0xfffaf0, width: 3 } },
  station: { fontFamily: FONT_FAMILY, fontSize: 12, fontWeight: '700', fill: 0x0b5e3a, stroke: { color: 0xffffff, width: 3.5 } },
};

interface Candidate {
  en: string;
  bn: string;
  style: Style;
  prio: number;
  x: number; // world
  y: number;
  angle: number; // world radians, NaN = horizontal
  segLen: number; // metres of straight road available (road labels)
  halfWidth: number; // metres from road centreline to its outer edge (labels sit beside it)
  minZoom: number;
  maxZoom: number;
}

const PLACE_RANK: Record<string, number> = { city: 0, town: 1, suburb: 2, quarter: 3, neighbourhood: 4, village: 4, locality: 5, hamlet: 6, isolated_dwelling: 7 };

export class Labels {
  readonly container = new Container({ label: 'labels' });
  private byChunk = new Map<string, Candidate[]>();
  private cache = new Map<string, Text>();
  private used = new Set<Text>();
  lang: Lang = 'en';
  enabled = true;
  maxLabels = 220;

  addChunk(e: ChunkEntry) {
    const b = e.built!;
    const ox = e.cx * e.size;
    const oy = e.cy * e.size;
    const out: Candidate[] = [];
    for (const l of b.labels) {
      // longest straight-ish run of the polyline
      const p = l.pts;
      let bestLen = 0;
      let bx = 0;
      let by = 0;
      let ba = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        let j = i;
        let len = 0;
        const a0 = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]);
        while (j + 3 < p.length) {
          const a = Math.atan2(p[j + 3] - p[j + 1], p[j + 2] - p[j]);
          let da = Math.abs(a - a0);
          if (da > Math.PI) da = 2 * Math.PI - da;
          if (da > 0.18) break;
          len += Math.hypot(p[j + 2] - p[j], p[j + 3] - p[j + 1]);
          j += 2;
        }
        if (len > bestLen) {
          bestLen = len;
          bx = (p[i] + p[j]) / 2;
          by = (p[i + 1] + p[j + 1]) / 2;
          ba = Math.atan2(p[j + 1] - p[i + 1], p[j] - p[i]);
        }
        i = Math.max(i, j - 2);
      }
      if (bestLen < 25) continue;
      // keep labels inside their own chunk (pieces overlap neighbours by a margin)
      if (bx < 0 || by < 0 || bx > e.size || by > e.size) continue;
      const flyover = (l.flags & LF_BRIDGE) !== 0 && l.layer > 0;
      const major = l.cls >= RoadClass.Secondary;
      out.push({
        en: l.name,
        bn: l.nameBn,
        style: flyover ? 'flyover' : major ? 'roadMajor' : 'road',
        prio: (flyover ? 30 : 0) + l.cls * 2,
        x: ox + bx,
        y: oy + by,
        angle: ba,
        segLen: bestLen,
        halfWidth: roadWidth(l.cls, 0, l.flags) / 2 + roadCasing(l.cls),
        minZoom: e.lod === 0 ? (major ? 0.45 : 1.1) : 0.12,
        maxZoom: 99,
      });
    }
    for (const p of b.points) {
      if (!p.name && !p.nameBn) continue;
      const x = ox + p.x;
      const y = oy + p.y;
      if (p.kind === PointKind.Place) {
        const r = PLACE_RANK[p.sub] ?? 6;
        out.push({
          en: p.name, bn: p.nameBn, style: r <= 2 ? 'placeMajor' : 'place', prio: 100 - r * 10, x, y, angle: NaN, segLen: 0, halfWidth: 0,
          minZoom: [0, 0, 0.03, 0.08, 0.2, 0.45, 0.9, 2][r] ?? 1, maxZoom: r <= 3 ? 1.2 : 4,
        });
      } else if (p.kind === PointKind.Station) {
        out.push({ en: p.name, bn: p.nameBn, style: 'station', prio: 70, x, y, angle: NaN, segLen: 0, halfWidth: 0, minZoom: e.lod === 0 ? 0.42 : 0.15, maxZoom: 99 });
      } else if (p.kind === PointKind.Landmark) {
        out.push({ en: p.name, bn: p.nameBn, style: 'landmark', prio: 55, x, y, angle: NaN, segLen: 0, halfWidth: 0, minZoom: e.lod === 0 ? 0.6 : 0.25, maxZoom: 99 });
      } else if (p.kind === PointKind.Poi && e.lod === 0 && p.sub === 'area') {
        out.push({ en: p.name, bn: p.nameBn, style: 'landmark', prio: 20, x, y, angle: NaN, segLen: 0, halfWidth: 0, minZoom: 1.4, maxZoom: 99 });
      }
    }
    this.byChunk.set(e.key, out);
  }

  removeChunk(e: ChunkEntry) {
    this.byChunk.delete(e.key);
  }

  private text(s: string, style: Style): Text {
    const key = `${style}|${s}`;
    let t = this.cache.get(key);
    if (!t) {
      t = new Text({ text: s, style: STYLES[style], anchor: 0.5, resolution: Math.min(2, window.devicePixelRatio || 1) * 1.25 });
      this.cache.set(key, t);
    }
    return t;
  }

  update(cam: Camera) {
    for (const t of this.used) t.visible = false;
    this.used.clear();
    if (!this.enabled) return;
    const z = cam.zoom;
    const view = cam.view(50 / z);
    const cands: Candidate[] = [];
    for (const list of this.byChunk.values())
      for (const c of list) {
        if (z < c.minZoom || z > c.maxZoom) continue;
        if (c.x < view.x0 || c.x > view.x1 || c.y < view.y0 || c.y > view.y1) continue;
        cands.push(c);
      }
    cands.sort((a, b) => b.prio - a.prio);

    const placed: Array<[number, number, number, number]> = [];
    const placedText = new Map<string, Array<[number, number]>>();
    const cos = Math.cos(-cam.rotation);
    const sin = Math.sin(-cam.rotation);
    const hw = cam.width / 2;
    const hh = cam.height / 2;
    let count = 0;
    for (const c of cands) {
      if (count >= this.maxLabels) break;
      const s = shortName(this.lang === 'bn' ? c.bn || c.en : c.en || c.bn);
      if (!s) continue;
      const dx = (c.x - cam.x) * z;
      const dy = (c.y - cam.y) * z;
      let sx = hw + dx * cos - dy * sin;
      let sy = hh + dx * sin + dy * cos;
      if (sx < -100 || sy < -40 || sx > cam.width + 100 || sy > cam.height + 40) continue;
      // same text nearby already shown (roads span many chunk pieces)
      const prev = placedText.get(s);
      if (prev && prev.some(([px, py]) => (px - sx) ** 2 + (py - sy) ** 2 < 260 * 260)) continue;
      const t = this.text(s, c.style);
      const w = t.width;
      const h = t.height;
      let rot = 0;
      if (!Number.isNaN(c.angle)) {
        if (c.segLen * z < w * 1.05) continue; // label longer than the straight run
        rot = c.angle - cam.rotation;
        // keep text upright
        while (rot > Math.PI / 2) rot -= Math.PI;
        while (rot < -Math.PI / 2) rot += Math.PI;
        // beside the road (on its upper side on screen) rather than painted over the lanes
        const off = c.halfWidth * z + h / 2 + 1;
        sx += Math.sin(rot) * off;
        sy -= Math.cos(rot) * off;
      }
      const ac = Math.abs(Math.cos(rot));
      const as = Math.abs(Math.sin(rot));
      const bw = (w * ac + h * as) / 2 + 3;
      const bh = (w * as + h * ac) / 2 + 2;
      const box: [number, number, number, number] = [sx - bw, sy - bh, sx + bw, sy + bh];
      if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      if (prev) prev.push([sx, sy]);
      else placedText.set(s, [[sx, sy]]);
      t.position.set(Math.round(sx), Math.round(sy));
      t.rotation = rot;
      t.visible = true;
      if (!t.parent) this.container.addChild(t);
      this.used.add(t);
      count++;
    }
    // trim cache
    if (this.cache.size > 1500) {
      for (const [k, t] of this.cache) {
        if (this.used.has(t)) continue;
        t.destroy();
        this.cache.delete(k);
        if (this.cache.size < 1000) break;
      }
    }
  }
}

/** OSM names are sometimes comma-joined descriptions; keep the first meaningful part. */
function shortName(s: string): string {
  if (!s || s.length <= 30) return s;
  const first = s.split(/[,;]/)[0].trim();
  return first.length >= 3 ? first : s.slice(0, 30) + '…';
}
