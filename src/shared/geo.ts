// Projection and world constants shared by the data pipeline and the game.
// Local equirectangular projection centred on Dhaka: 1 world unit = 1 metre,
// +x = east, +y = south (screen-down). Distortion across the ~35 km city is < 0.1%.

export const EARTH_R = 6378137;
export const LAT0 = 23.8;
export const LON0 = 90.41;
const DEG = Math.PI / 180;
export const KX = EARTH_R * DEG * Math.cos(LAT0 * DEG); // metres per degree longitude
export const KY = EARTH_R * DEG; // metres per degree latitude

export function project(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * KX, (LAT0 - lat) * KY];
}

export function unproject(x: number, y: number): [number, number] {
  return [LON0 + x / KX, LAT0 - y / KY];
}

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export const BBOXES: Record<string, BBox> = {
  // Farmgate -> Shahbag -> Motijheel/Kamalapur: fast iteration box.
  core: { minLat: 23.72, minLon: 90.38, maxLat: 23.765, maxLon: 90.43 },
  // Mirpur -> Motijheel.
  mid: { minLat: 23.715, minLon: 90.34, maxLat: 23.83, maxLon: 90.44 },
  // Whole Dhaka: Uttara to Demra/Jatrabari, Savar side to Purbachal approach.
  full: { minLat: 23.65, minLon: 90.3, maxLat: 23.95, maxLon: 90.52 },
};

/** Chunk edge length in metres for each LOD level. LOD0 = full detail. */
export const CHUNK_SIZE = [512, 2048, 8192] as const;
