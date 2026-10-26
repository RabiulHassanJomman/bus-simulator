import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOXES, type BBox } from '../src/shared/geo';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PBF_URL = 'https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf';
export const RAW_PBF = join(ROOT, 'data/raw/bangladesh-latest.osm.pbf');
export const PUBLIC_DATA = join(ROOT, 'public/data');

export const workDir = (bboxName: string) => join(ROOT, 'data/work', bboxName);

/**
 * Bbox selection: DHAKA_BBOX=core|mid|full, or explicit
 * DHAKA_BBOX="minLat,minLon,maxLat,maxLon". Defaults to "core".
 */
export function selectedBBox(): { name: string; bbox: BBox } {
  const v = process.env.DHAKA_BBOX ?? 'core';
  if (BBOXES[v]) return { name: v, bbox: BBOXES[v] };
  const parts = v.split(',').map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [minLat, minLon, maxLat, maxLon] = parts;
    return { name: 'custom', bbox: { minLat, minLon, maxLat, maxLon } };
  }
  throw new Error(`Unknown DHAKA_BBOX "${v}". Use one of ${Object.keys(BBOXES).join(', ')} or "minLat,minLon,maxLat,maxLon".`);
}
