// Persistent career progress (localStorage). Phase 6 extends this with buses and upgrades.
import type { RunResult } from './RouteRun';

export interface CareerState {
  version: 1;
  money: number;
  reputation: number;
  unlocked: string[];
  runs: Array<RunResult & { at: number }>;
  best: Record<string, number>; // route id -> best stars
}

const KEY = 'dbs.career.v1';

export const START_MONEY = 1500;

export function loadCareer(): CareerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as CareerState;
      if (s.version === 1) return s;
    }
  } catch {
    /* storage unavailable: start fresh */
  }
  return { version: 1, money: START_MONEY, reputation: 0, unlocked: [], runs: [], best: {} };
}

export function saveCareer(s: CareerState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Apply a finished run: fares + bonus − fines, reputation, best stars. Returns net earnings. */
export function applyRun(s: CareerState, routeId: string, r: RunResult): number {
  const net = r.fares + r.timeBonus - r.fines;
  s.money = Math.max(0, s.money + net);
  s.reputation += r.reputation;
  s.best[routeId] = Math.max(s.best[routeId] ?? 0, r.stars);
  s.runs.push({ ...r, at: Date.now() });
  if (s.runs.length > 50) s.runs.shift();
  saveCareer(s);
  return net;
}

export function isUnlocked(s: CareerState, routeId: string, price: number) {
  return price === 0 || s.unlocked.includes(routeId);
}
