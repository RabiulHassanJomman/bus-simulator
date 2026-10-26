import { LF_ONEWAY, RoadClass, WaterwayClass, RailClass } from './kinds';

export const LANE_WIDTH = 3.2;

const DEFAULT_ROAD_WIDTH: Record<number, number> = {
  [RoadClass.Motorway]: 14,
  [RoadClass.Trunk]: 14,
  [RoadClass.Primary]: 12,
  [RoadClass.Secondary]: 10,
  [RoadClass.Tertiary]: 8,
  [RoadClass.Link]: 6.5,
  [RoadClass.Unclassified]: 6.5,
  [RoadClass.Residential]: 5.5,
  [RoadClass.LivingStreet]: 4.5,
  [RoadClass.Service]: 4,
  [RoadClass.Pedestrian]: 5,
  [RoadClass.Track]: 3.5,
  [RoadClass.Cycleway]: 2,
  [RoadClass.Footway]: 2,
  [RoadClass.Steps]: 2,
  [RoadClass.Path]: 1.5,
};

/** Carriageway width in metres (without sidewalk/curb). */
export function roadWidth(cls: number, lanes: number, flags: number, explicitDm = 0): number {
  if (explicitDm > 0) return explicitDm / 10;
  const def = DEFAULT_ROAD_WIDTH[cls] ?? 5;
  if (lanes > 0 && cls >= RoadClass.Residential) {
    const oneway = (flags & LF_ONEWAY) !== 0;
    const w = lanes * LANE_WIDTH + (oneway ? 0.6 : 1.0);
    return Math.max(def * 0.7, Math.min(w, 30));
  }
  // Dual carriageways are mapped as two one-way ways: halve-ish the default.
  if ((flags & LF_ONEWAY) !== 0 && cls >= RoadClass.Secondary) return def * 0.62;
  return def;
}

/** Curb + sidewalk width on each side, metres. */
export function roadCasing(cls: number): number {
  if (cls <= RoadClass.Steps) return 0.3;
  if (cls <= RoadClass.Service) return 0.5;
  if (cls >= RoadClass.Tertiary) return 1.6;
  return 0.9;
}

export function waterwayWidth(cls: number, explicitDm = 0): number {
  if (explicitDm > 0) return explicitDm / 10;
  switch (cls) {
    case WaterwayClass.River:
      return 30;
    case WaterwayClass.Canal:
      return 9;
    case WaterwayClass.Stream:
      return 4;
    case WaterwayClass.Ditch:
      return 1.6;
    default:
      return 2;
  }
}

export function railWidth(cls: number): number {
  return cls === RailClass.Subway || cls === RailClass.Light ? 8.5 : 3.4;
}
