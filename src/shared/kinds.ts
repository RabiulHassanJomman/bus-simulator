// Feature kind enums. Numeric values are stored in chunk files: append only.

/** Area kinds (polygons). Order of declaration is NOT draw order; see AREA_Z. */
export enum AreaKind {
  Residential = 1,
  Commercial,
  Retail,
  Industrial,
  Military,
  Railway,
  Construction,
  Education,
  Hospital,
  Cemetery,
  Farmland,
  Grass,
  Park,
  Forest,
  Pitch,
  Wetland,
  Water,
  Aerodrome,
  Apron,
  Parking,
  Pedestrian,
  Religious,
  Sand,
  Platform,
}

/** Paint order group: lower draws first. Water gets its own mesh layer. */
export const AREA_Z: Record<number, number> = {
  [AreaKind.Aerodrome]: 0,
  [AreaKind.Residential]: 1,
  [AreaKind.Commercial]: 1,
  [AreaKind.Retail]: 1,
  [AreaKind.Industrial]: 1,
  [AreaKind.Military]: 1,
  [AreaKind.Railway]: 1,
  [AreaKind.Construction]: 1,
  [AreaKind.Farmland]: 1,
  [AreaKind.Education]: 2,
  [AreaKind.Hospital]: 2,
  [AreaKind.Religious]: 2,
  [AreaKind.Cemetery]: 3,
  [AreaKind.Grass]: 3,
  [AreaKind.Forest]: 3,
  [AreaKind.Park]: 3,
  [AreaKind.Wetland]: 3,
  [AreaKind.Sand]: 3,
  [AreaKind.Pitch]: 4,
  [AreaKind.Apron]: 4,
  [AreaKind.Parking]: 4,
  [AreaKind.Pedestrian]: 5,
  [AreaKind.Platform]: 5,
  [AreaKind.Water]: 10,
};

/** Line kinds. */
export enum LineKind {
  Road = 1,
  Rail,
  Metro, // MRT Line 6 and other elevated urban rail
  Waterway,
  Runway,
  Barrier, // walls/fences, render-only obstacles
}

/** Road classes, roughly ordered by importance (higher = more important). */
export enum RoadClass {
  Path = 1,
  Footway,
  Steps,
  Cycleway,
  Track,
  Service,
  Pedestrian,
  LivingStreet,
  Residential,
  Unclassified,
  Link,
  Tertiary,
  Secondary,
  Primary,
  Trunk,
  Motorway,
}

export enum WaterwayClass {
  Drain = 1,
  Ditch,
  Stream,
  Canal,
  River,
}

export enum RailClass {
  Rail = 1,
  Light,
  Subway,
  Platform,
}

/** Bit flags for lines. */
export const LF_ONEWAY = 1;
export const LF_BRIDGE = 2;
export const LF_TUNNEL = 4;
export const LF_ROUNDABOUT = 8;
export const LF_AREA_EDGE = 16;

/** Point kinds. */
export enum PointKind {
  Poi = 1,
  Place,
  BusStop,
  Signal,
  Crossing,
  Fuel,
  Station,
  Tree,
  StreetLamp,
  Landmark,
}

export const MIN_SHADOW_HEIGHT = 3;
