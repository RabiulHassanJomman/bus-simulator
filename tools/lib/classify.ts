// Map OSM tags to game feature kinds.
import type { Tags } from './pbf';
import {
  AreaKind,
  LineKind,
  RoadClass,
  WaterwayClass,
  RailClass,
  PointKind,
  LF_BRIDGE,
  LF_ONEWAY,
  LF_ROUNDABOUT,
  LF_TUNNEL,
} from '../../src/shared/kinds';

const ROAD: Record<string, RoadClass> = {
  motorway: RoadClass.Motorway,
  trunk: RoadClass.Trunk,
  primary: RoadClass.Primary,
  secondary: RoadClass.Secondary,
  tertiary: RoadClass.Tertiary,
  motorway_link: RoadClass.Link,
  trunk_link: RoadClass.Link,
  primary_link: RoadClass.Link,
  secondary_link: RoadClass.Link,
  tertiary_link: RoadClass.Link,
  unclassified: RoadClass.Unclassified,
  road: RoadClass.Unclassified,
  residential: RoadClass.Residential,
  living_street: RoadClass.LivingStreet,
  service: RoadClass.Service,
  pedestrian: RoadClass.Pedestrian,
  track: RoadClass.Track,
  footway: RoadClass.Footway,
  steps: RoadClass.Steps,
  path: RoadClass.Path,
  cycleway: RoadClass.Cycleway,
  busway: RoadClass.Primary,
};

const LANDUSE: Record<string, AreaKind> = {
  residential: AreaKind.Residential,
  commercial: AreaKind.Commercial,
  retail: AreaKind.Retail,
  industrial: AreaKind.Industrial,
  military: AreaKind.Military,
  railway: AreaKind.Railway,
  construction: AreaKind.Construction,
  brownfield: AreaKind.Construction,
  greenfield: AreaKind.Grass,
  education: AreaKind.Education,
  institutional: AreaKind.Education,
  cemetery: AreaKind.Cemetery,
  farmland: AreaKind.Farmland,
  farmyard: AreaKind.Farmland,
  orchard: AreaKind.Forest,
  plant_nursery: AreaKind.Grass,
  grass: AreaKind.Grass,
  meadow: AreaKind.Grass,
  village_green: AreaKind.Grass,
  recreation_ground: AreaKind.Park,
  forest: AreaKind.Forest,
  reservoir: AreaKind.Water,
  basin: AreaKind.Water,
  religious: AreaKind.Religious,
  garages: AreaKind.Parking,
};

const LEISURE: Record<string, AreaKind> = {
  park: AreaKind.Park,
  garden: AreaKind.Park,
  playground: AreaKind.Park,
  recreation_ground: AreaKind.Park,
  golf_course: AreaKind.Grass,
  pitch: AreaKind.Pitch,
  stadium: AreaKind.Pitch,
  sports_centre: AreaKind.Pitch,
  track: AreaKind.Pitch,
  nature_reserve: AreaKind.Forest,
  swimming_pool: AreaKind.Water,
};

const NATURAL: Record<string, AreaKind> = {
  water: AreaKind.Water,
  wood: AreaKind.Forest,
  scrub: AreaKind.Forest,
  grassland: AreaKind.Grass,
  heath: AreaKind.Grass,
  wetland: AreaKind.Wetland,
  sand: AreaKind.Sand,
  beach: AreaKind.Sand,
  bare_rock: AreaKind.Sand,
};

const AMENITY_AREA: Record<string, AreaKind> = {
  university: AreaKind.Education,
  college: AreaKind.Education,
  school: AreaKind.Education,
  kindergarten: AreaKind.Education,
  hospital: AreaKind.Hospital,
  clinic: AreaKind.Hospital,
  grave_yard: AreaKind.Cemetery,
  parking: AreaKind.Parking,
  bus_station: AreaKind.Parking,
  marketplace: AreaKind.Retail,
  place_of_worship: AreaKind.Religious,
};

/** Tags we keep on stored ways (everything else dropped to save memory). */
export const KEEP_KEYS = new Set([
  'highway', 'name', 'name:bn', 'name:en', 'oneway', 'lanes', 'maxspeed', 'bridge', 'tunnel', 'layer', 'surface',
  'junction', 'ref', 'building', 'building:levels', 'height', 'landuse', 'leisure', 'natural', 'water', 'waterway',
  'amenity', 'railway', 'aeroway', 'area', 'width', 'service', 'access', 'man_made', 'shop', 'tourism', 'historic',
  'public_transport', 'bus', 'station', 'type', 'route', 'operator', 'network', 'from', 'to', 'restriction',
  'barrier', 'place', 'crossing', 'building:min_level', 'min_height', 'office', 'healthcare', 'religion', 'level', 'location', 'covered', 'min_level',
]);

export function filterTags(t: Tags): Tags {
  const o: Tags = {};
  for (const k in t) if (KEEP_KEYS.has(k)) o[k] = t[k];
  return o;
}

export function isBuilding(t: Tags): boolean {
  const b = t.building;
  return !!b && b !== 'no' && t.location !== 'underground' && t.building !== 'roof';
}

export function areaKind(t: Tags): AreaKind | null {
  if (t.area === 'no') return null;
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock' || t.water) return AreaKind.Water;
  if (t.aeroway === 'aerodrome') return AreaKind.Aerodrome;
  if (t.aeroway === 'apron' || t.aeroway === 'helipad') return AreaKind.Apron;
  if (t.leisure && LEISURE[t.leisure] !== undefined) return LEISURE[t.leisure];
  if (t.natural && NATURAL[t.natural] !== undefined) return NATURAL[t.natural];
  if (t.amenity && AMENITY_AREA[t.amenity] !== undefined) return AMENITY_AREA[t.amenity];
  if (t.landuse && LANDUSE[t.landuse] !== undefined) return LANDUSE[t.landuse];
  if (t.highway === 'pedestrian' && t.area === 'yes') return AreaKind.Pedestrian;
  if (t.public_transport === 'platform' && t.area === 'yes') return AreaKind.Platform;
  if (t.railway === 'platform') return AreaKind.Platform;
  return null;
}

export interface LineClass {
  kind: LineKind;
  cls: number;
  flags: number;
  layer: number;
  lanes: number;
  maxspeed: number;
  widthDm: number;
  reverse: boolean;
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function lineClass(t: Tags, closed: boolean): LineClass | null {
  let layer = Math.round(num(t.layer));
  let flags = 0;
  const bridge = t.bridge && t.bridge !== 'no';
  if (bridge) {
    flags |= LF_BRIDGE;
    if (layer <= 0) layer = 1;
  }
  if (t.tunnel && t.tunnel !== 'no') flags |= LF_TUNNEL;
  const widthDm = Math.round(num(t.width) * 10);

  if (t.highway && ROAD[t.highway] !== undefined) {
    if (closed && t.area === 'yes') return null;
    const cls = ROAD[t.highway];
    let reverse = false;
    if (t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true') flags |= LF_ONEWAY;
    else if (t.oneway === '-1' || t.oneway === 'reverse') {
      flags |= LF_ONEWAY;
      reverse = true;
    }
    if (t.junction === 'roundabout' || t.junction === 'circular') flags |= LF_ROUNDABOUT;
    if ((t.junction === 'roundabout' || t.highway === 'motorway') && t.oneway !== 'no') flags |= LF_ONEWAY;
    const ms = num(t.maxspeed);
    return { kind: LineKind.Road, cls, flags, layer, lanes: Math.round(num(t.lanes)), maxspeed: ms, widthDm, reverse };
  }
  if (t.railway) {
    const r = t.railway;
    let cls: RailClass | 0 = 0;
    if (r === 'rail' || r === 'narrow_gauge') cls = RailClass.Rail;
    else if (r === 'light_rail' || r === 'monorail') cls = RailClass.Light;
    else if (r === 'subway') cls = RailClass.Subway;
    if (cls) {
      // MRT Line 6 (and other urban metro) is elevated: give it its own kind.
      const metro = cls !== RailClass.Rail;
      if (metro && layer <= 0 && !(flags & LF_TUNNEL)) {
        layer = 2;
        flags |= LF_BRIDGE;
      }
      return { kind: metro ? LineKind.Metro : LineKind.Rail, cls, flags, layer, lanes: 0, maxspeed: 0, widthDm, reverse: false };
    }
    return null;
  }
  if (t.waterway && !closed) {
    const w = t.waterway;
    const cls =
      w === 'river' ? WaterwayClass.River
      : w === 'canal' ? WaterwayClass.Canal
      : w === 'stream' ? WaterwayClass.Stream
      : w === 'ditch' ? WaterwayClass.Ditch
      : w === 'drain' ? WaterwayClass.Drain
      : 0;
    if (!cls || flags & LF_TUNNEL) return null;
    return { kind: LineKind.Waterway, cls, flags, layer, lanes: 0, maxspeed: 0, widthDm, reverse: false };
  }
  if (t.aeroway === 'runway' || t.aeroway === 'taxiway') {
    return {
      kind: LineKind.Runway,
      cls: t.aeroway === 'runway' ? 1 : 2,
      flags,
      layer,
      lanes: 0,
      maxspeed: 0,
      widthDm: widthDm || (t.aeroway === 'runway' ? 450 : 230),
      reverse: false,
    };
  }
  if (t.barrier === 'wall' || t.barrier === 'fence' || t.barrier === 'retaining_wall') {
    return { kind: LineKind.Barrier, cls: 1, flags, layer, lanes: 0, maxspeed: 0, widthDm: 0, reverse: false };
  }
  return null;
}

export interface PointClass {
  kind: PointKind;
  sub: string;
}

const LANDMARK_HINT = /(monument|memorial|castle|fort|palace|manzil|minar|stadium|parliament|museum)/i;

export function pointClass(t: Tags): PointClass | null {
  if (t.highway === 'bus_stop' || (t.public_transport === 'platform' && (t.bus === 'yes' || t.highway === 'bus_stop')))
    return { kind: PointKind.BusStop, sub: 'bus_stop' };
  if (t.public_transport === 'stop_position' && t.bus === 'yes') return { kind: PointKind.BusStop, sub: 'stop_position' };
  if (t.highway === 'traffic_signals') return { kind: PointKind.Signal, sub: 'traffic_signals' };
  if (t.highway === 'crossing' || t.railway === 'level_crossing' || t.railway === 'crossing')
    return { kind: PointKind.Crossing, sub: t.railway ? 'level_crossing' : t.crossing ?? 'crossing' };
  if (t.amenity === 'fuel') return { kind: PointKind.Fuel, sub: 'fuel' };
  if (t.railway === 'station' || t.railway === 'halt' || (t.public_transport === 'station' && t.name))
    return { kind: PointKind.Station, sub: t.station === 'subway' || t.station === 'light_rail' ? 'metro' : t.railway ?? 'station' };
  if (t.natural === 'tree') return { kind: PointKind.Tree, sub: 'tree' };
  if (t.highway === 'street_lamp') return { kind: PointKind.StreetLamp, sub: 'lamp' };
  if (t.place && t.name) return { kind: PointKind.Place, sub: t.place };
  if (t.historic && t.name) return { kind: PointKind.Landmark, sub: 'historic:' + t.historic };
  if (t.tourism && t.name && (t.tourism === 'attraction' || t.tourism === 'museum'))
    return { kind: PointKind.Landmark, sub: 'tourism:' + t.tourism };
  if (t.name && LANDMARK_HINT.test(t.name) && (t.amenity || t.tourism || t.man_made || t.building))
    return { kind: PointKind.Landmark, sub: 'landmark' };
  for (const k of ['amenity', 'shop', 'tourism', 'leisure', 'office', 'healthcare', 'man_made']) {
    if (t[k] && t.name) return { kind: PointKind.Poi, sub: `${k}:${t[k]}` };
  }
  return null;
}

/** Height in metres; deterministic pseudo-random fallback for untagged buildings. */
export function buildingHeight(t: Tags, id: number): number {
  const h = num(t.height);
  if (h > 0) return h;
  const lv = num(t['building:levels']);
  if (lv > 0) return lv * 3.2 + 1;
  const b = t.building;
  if (b === 'hut' || b === 'shed' || b === 'kiosk' || b === 'roof' || b === 'garage' || b === 'tin_shed') return 3;
  if (b === 'mosque' || b === 'temple' || b === 'church') return 12;
  // Dhaka's typical untagged building is 4-8 storeys.
  const r = ((id * 2654435761) % 4294967296) / 4294967296;
  return 9 + Math.floor(r * 16);
}

/**
 * Buildings that stand above the street (MRT stations over roads, skywalks, buildings on
 * stilts): rendered, but not ground obstacles. Note layer=1 alone is NOT enough: Dhaka
 * mappers routinely put layer=1 on ordinary buildings.
 */
export function isElevatedBuilding(t: Tags): boolean {
  const n = (v?: string) => (v ? parseFloat(v) || 0 : 0);
  if (n(t.min_level) >= 1 || n(t['building:min_level']) >= 1 || n(t.min_height) >= 2.5) return true;
  const layer = n(t.layer);
  const transport = t.building === 'train_station' || t.building === 'transportation' || !!t.railway || t.public_transport === 'station';
  return layer >= 3 || (layer >= 2 && transport);
}
