// Persistent user settings (localStorage) with URL overrides (?quality=low).
export type Quality = 'low' | 'med' | 'high';

export interface QualityPreset {
  antialias: boolean;
  maxResolution: number;
  shadows: boolean;
  maxLabels: number;
  /** traffic density multiplier (used from Phase 4) */
  traffic: number;
}

export const PRESETS: Record<Quality, QualityPreset> = {
  low: { antialias: false, maxResolution: 1, shadows: false, maxLabels: 90, traffic: 0.5 },
  med: { antialias: false, maxResolution: 1.5, shadows: true, maxLabels: 160, traffic: 0.8 },
  high: { antialias: true, maxResolution: 2, shadows: true, maxLabels: 220, traffic: 1 },
};

const KEY = 'dbs.settings.v1';

/** Touch steering: on-screen wheel, left/right buttons, or phone tilt (accelerometer). */
export type SteerMode = 'wheel' | 'buttons' | 'tilt';
const STEER_MODES: SteerMode[] = ['wheel', 'buttons', 'tilt'];

export interface Settings {
  quality: Quality;
  lang: 'en' | 'bn';
  steer: SteerMode;
}

export function loadSettings(): Settings {
  let s: Partial<Settings> = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    /* storage unavailable */
  }
  const q = new URLSearchParams(location.search).get('quality');
  const quality = (q && q in PRESETS ? q : s.quality && s.quality in PRESETS ? s.quality : 'med') as Quality;
  const steer = STEER_MODES.includes(s.steer as SteerMode) ? (s.steer as SteerMode) : 'wheel';
  return { quality, lang: s.lang === 'bn' ? 'bn' : 'en', steer };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
