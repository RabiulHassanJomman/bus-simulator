// Game clock: 1 real second = 1 game minute by default (a day lasts 24 real minutes).
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

export class Clock {
  /** game minutes since Sunday 00:00 */
  minutes: number;
  /** game minutes per real second */
  scale = 1;
  paused = false;

  constructor(startDay = 0, hour = 8, minute = 30) {
    this.minutes = startDay * 1440 + hour * 60 + minute;
  }

  tick(dt: number) {
    if (!this.paused) this.minutes += dt * this.scale;
  }

  get day() {
    return Math.floor(this.minutes / 1440) % 7;
  }
  /** hour of day as a fraction, 0..24 */
  get hour() {
    return (this.minutes % 1440) / 60;
  }
  get label() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  /**
   * Traffic density multiplier for the current time: morning (8–10) and evening (17–20)
   * rush, quiet nights, near-empty Friday mornings (weekend, Jumu'ah).
   */
  density(): number {
    const h = this.hour;
    const bump = (c: number, w: number, a: number) => a * Math.exp(-(((h - c) / w) ** 2));
    let d = 0.55 + bump(9, 1.3, 0.85) + bump(18.5, 1.6, 0.95) + bump(13.5, 2, 0.2);
    if (h < 6 || h > 23) d *= 0.35;
    if (this.day === 5 && h < 13) d *= 0.4; // Friday morning
    return d;
  }

  /** share of trucks: they mostly run at night (daytime truck ban in the city) */
  truckShare(): number {
    const h = this.hour;
    return h >= 22 || h < 6 ? 0.22 : 0.03;
  }
}
