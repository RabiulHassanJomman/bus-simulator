// Colour palette for the top-down world (sun-baked, slightly dusty Dhaka tones).
import { AreaKind, RoadClass } from '../shared/kinds';

export type RGBA = [number, number, number, number];

export function hex(c: number, a = 255): RGBA {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255, a];
}

export const BACKGROUND = 0xd8d1c1;

export const AREA_COLORS: Record<number, number> = {
  [AreaKind.Residential]: 0xd3cbbb,
  [AreaKind.Commercial]: 0xd9c9c1,
  [AreaKind.Retail]: 0xdcc6bd,
  [AreaKind.Industrial]: 0xcbc5cf,
  [AreaKind.Military]: 0xc6c9b0,
  [AreaKind.Railway]: 0xc8c0b6,
  [AreaKind.Construction]: 0xc9b998,
  [AreaKind.Education]: 0xe1d5b2,
  [AreaKind.Hospital]: 0xe3cdca,
  [AreaKind.Cemetery]: 0xa9bf96,
  [AreaKind.Farmland]: 0xc8d49a,
  [AreaKind.Grass]: 0x9fc27e,
  [AreaKind.Park]: 0x8fbb72,
  [AreaKind.Forest]: 0x6c9c58,
  [AreaKind.Pitch]: 0x86b864,
  [AreaKind.Wetland]: 0x9dbfae,
  [AreaKind.Water]: 0x5b93c0,
  [AreaKind.Aerodrome]: 0xcfd0c0,
  [AreaKind.Apron]: 0x9a9a98,
  [AreaKind.Parking]: 0xa9a59f,
  [AreaKind.Pedestrian]: 0xc4b9a8,
  [AreaKind.Religious]: 0xdccfb8,
  [AreaKind.Sand]: 0xe0d2a8,
  [AreaKind.Platform]: 0xb7b0a4,
};

export const WATER_LINE = 0x5b93c0;
export const WATER_SHORE = 0x4a7fa9;

/** Asphalt fill by road class. */
export function roadFill(cls: number): number {
  if (cls >= RoadClass.Trunk) return 0x46484d;
  if (cls >= RoadClass.Secondary) return 0x4c4e53;
  if (cls >= RoadClass.Link) return 0x525458;
  if (cls >= RoadClass.Residential) return 0x5d5e60;
  if (cls === RoadClass.Service || cls === RoadClass.LivingStreet) return 0x67676a;
  if (cls === RoadClass.Track) return 0x9a8a6e;
  if (cls === RoadClass.Pedestrian) return 0xb4aa9a;
  return 0xbcb2a2; // footway / path / steps / cycleway
}

/** Curb + sidewalk casing colour. */
export function roadCasing(cls: number): number {
  if (cls <= RoadClass.Cycleway) return 0x9d9486;
  if (cls <= RoadClass.Service) return 0x8a8781;
  return 0xa8a297;
}

export const MARK_WHITE = 0xeeeeea;
export const MARK_YELLOW = 0xe9b934;

export const BRIDGE_CASING = 0x8f8b84;
export const BRIDGE_EDGE = 0x6d6a65;
export const RAIL_BALLAST = 0x8b8378;
export const RAIL_SLEEPER = 0x6a5c4d;
export const RAIL_STEEL = 0x4e4a46;
export const METRO_DECK = 0xc9c5bc;
export const METRO_EDGE = 0x9a958b;
export const STATION_ROOF = 0xd7d3c8;
export const STATION_RIDGE = 0xa9a49a;
export const BARRIER = 0x8a8278;
export const RUNWAY = 0x55575a;

/** Roof tones: concrete, whitewash, faded paint, tin. */
export const ROOFS = [
  0xc8c2b8, 0xbeb8ae, 0xd3ccc0, 0xb2ada6, 0xcbb9a7, 0xaab1b5, 0xd9d3c7, 0xc4b49f, 0xb9bfb8, 0xcfc5b5, 0xa9a49a,
  0xd6c8b2,
];
