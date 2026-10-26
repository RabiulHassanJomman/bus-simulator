// Dhaka vehicle mix and per-type driving behaviour.
import type { Profile } from '../Router';
import { PROFILES } from '../Router';

export type VType = 'rickshaw' | 'cng' | 'car' | 'taxi' | 'motorcycle' | 'bus' | 'leguna' | 'truck' | 'pickup' | 'ambulance' | 'police';

export interface VSpec {
  type: VType;
  length: number;
  width: number;
  /** desired top speed, m/s */
  vmax: number;
  accel: number; // IDM a, m/s²
  decel: number; // IDM comfortable b, m/s²
  headway: number; // IDM T, s
  minGap: number; // IDM s0, m
  /** 1 = hugs the kerb (left), 0 = keeps to the centre */
  kerb: number;
  /** how readily it changes lateral position to squeeze past (0..1) */
  weave: number;
  /** spawn weight (daytime) */
  weight: number;
  profile: Profile;
  mass: number; // kg, for shoves from the player's bus
}

const kmh = (v: number) => v / 3.6;

export const VSPECS: Record<VType, VSpec> = {
  rickshaw: { type: 'rickshaw', length: 2.1, width: 1.05, vmax: kmh(13), accel: 0.6, decel: 1.5, headway: 0.8, minGap: 0.6, kerb: 0.95, weave: 0.45, weight: 26, profile: PROFILES.rickshaw, mass: 180 },
  cng: { type: 'cng', length: 2.7, width: 1.4, vmax: kmh(42), accel: 1.6, decel: 3, headway: 0.7, minGap: 0.7, kerb: 0.55, weave: 0.9, weight: 17, profile: PROFILES.car, mass: 450 },
  car: { type: 'car', length: 4.4, width: 1.8, vmax: kmh(50), accel: 1.8, decel: 3, headway: 1.0, minGap: 1.2, kerb: 0.4, weave: 0.35, weight: 18, profile: PROFILES.car, mass: 1300 },
  taxi: { type: 'taxi', length: 4.3, width: 1.75, vmax: kmh(48), accel: 1.8, decel: 3, headway: 0.9, minGap: 1.0, kerb: 0.5, weave: 0.45, weight: 2, profile: PROFILES.car, mass: 1250 },
  motorcycle: { type: 'motorcycle', length: 2.0, width: 0.8, vmax: kmh(50), accel: 2.6, decel: 4, headway: 0.6, minGap: 0.5, kerb: 0.3, weave: 1, weight: 14, profile: PROFILES.car, mass: 250 },
  bus: { type: 'bus', length: 10.5, width: 2.5, vmax: kmh(40), accel: 1.0, decel: 2.5, headway: 1.2, minGap: 1.5, kerb: 0.65, weave: 0.25, weight: 9, profile: PROFILES.bus, mass: 11000 },
  leguna: { type: 'leguna', length: 4.0, width: 1.65, vmax: kmh(38), accel: 1.4, decel: 2.8, headway: 0.9, minGap: 1.0, kerb: 0.7, weave: 0.5, weight: 3, profile: PROFILES.car, mass: 1500 },
  truck: { type: 'truck', length: 8.0, width: 2.4, vmax: kmh(40), accel: 0.8, decel: 2.2, headway: 1.5, minGap: 2.0, kerb: 0.7, weave: 0.1, weight: 3, profile: PROFILES.bus, mass: 12000 },
  pickup: { type: 'pickup', length: 5.0, width: 1.85, vmax: kmh(45), accel: 1.6, decel: 3, headway: 1.0, minGap: 1.2, kerb: 0.55, weave: 0.3, weight: 4, profile: PROFILES.car, mass: 2000 },
  ambulance: { type: 'ambulance', length: 5.3, width: 2.0, vmax: kmh(55), accel: 2.0, decel: 3.2, headway: 0.8, minGap: 1.0, kerb: 0.3, weave: 0.6, weight: 0.6, profile: PROFILES.car, mass: 2600 },
  police: { type: 'police', length: 5.0, width: 1.9, vmax: kmh(50), accel: 2.0, decel: 3.2, headway: 1.0, minGap: 1.2, kerb: 0.45, weave: 0.4, weight: 0.8, profile: PROFILES.car, mass: 2200 },
};

export const VTYPES = Object.keys(VSPECS) as VType[];
