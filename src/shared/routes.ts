// Bus route data produced by tools/routes.ts (public/data/routes.json).

export interface RouteStop {
  name: string;
  nameBn: string;
  /** stop position (kerb side of the route), world metres */
  x: number;
  y: number;
  /** distance along the route line, metres */
  s: number;
  /** OSM node id of the matched bus stop, if any */
  osm?: number;
  match: 'osm-stop' | 'osm-place' | 'manual';
}

export interface RouteDirection {
  from: string;
  to: string;
  stops: RouteStop[];
  /** route centreline as flat [x0,y0,x1,y1,...], metres */
  line: number[];
  length: number;
}

export interface RouteData {
  id: string;
  name: string;
  nameBn: string;
  via: string;
  color: number;
  unlock: number;
  demand: number;
  dirs: [RouteDirection, RouteDirection];
}

/** Dhaka city bus fare (BRTA, 2022 revision): taka per km, minimum fare; students pay half. */
export const FARE_PER_KM = 2.45;
export const MIN_FARE = 10;
export const STUDENT_MIN_FARE = 5;

export function fareFor(distanceM: number, student: boolean): number {
  const full = Math.max(MIN_FARE, Math.round((distanceM / 1000) * FARE_PER_KM));
  return student ? Math.max(STUDENT_MIN_FARE, Math.round(full / 2)) : full;
}
