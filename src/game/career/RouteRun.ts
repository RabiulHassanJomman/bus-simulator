// One run along a bus route: passengers, stops, fares, satisfaction. Pure logic (unit-tested).
import { fareFor, type RouteData, type RouteDirection } from '../../shared/routes';

export type PaxKind = 'man' | 'woman' | 'student' | 'elderly';
export type Place = 'seat' | 'ladies' | 'standing' | 'hanging';

export interface Passenger {
  id: number;
  kind: PaxKind;
  from: number; // stop index
  to: number;
  fare: number;
  satisfaction: number; // 0..100
  place: Place | null;
  waitedFor: number; // seconds waiting at the stop
}

export const CAPACITY = { seats: 26, ladies: 9, standing: 20, hanging: 8 };

/** Big interchanges generate more passengers. */
const HUBS = /farmgate|shahbag|gulistan|mohakhali|motijheel|mirpur 10|gabtoli|sayedabad|airport|sadarghat|karwan|kuril|abdullahpur|press club/i;

export interface RunEvent {
  type:
    | 'approach' // ~150 m before the next stop
    | 'arrived'
    | 'doors-needed'
    | 'alight'
    | 'board'
    | 'full'
    | 'depart'
    | 'skipped' // left passengers behind with room on board
    | 'missed' // drove past a stop that needed serving
    | 'finished'
    | 'late'
    | 'off-route'
    | 'on-route';
  stop?: number;
  count?: number;
  amount?: number;
}

export interface BusState {
  x: number;
  y: number;
  speed: number; // m/s (signed)
  /** longitudinal and lateral acceleration felt by passengers, m/s² */
  accel: number;
  lateral: number;
  doorsOpen: boolean;
  /** collision impact this frame (m/s), 0 if none */
  impact: number;
}

export interface RunResult {
  route: string;
  fares: number;
  fines: number;
  passengers: number;
  satisfaction: number;
  missed: number;
  skipped: number;
  onTime: boolean;
  timeBonus: number;
  reputation: number;
  stars: number;
  seconds: number;
}

export class RouteRun {
  readonly d: RouteDirection;
  readonly cum: number[];
  waiting: Passenger[][];
  onboard: Passenger[] = [];
  delivered = 0;
  fares = 0;
  /** progress along the route line, metres */
  s = 0;
  offRoute = 0; // metres from the line
  next = 0; // index of the next stop to serve
  served: boolean[];
  missed = 0;
  skipped = 0;
  time = 0;
  readonly timeLimit: number;
  atStop = -1;
  /** stopping accuracy at the current stop, metres from the marker */
  accuracy = 0;
  private boardTimer = 0;
  private approachAnnounced = -1;
  private wasOff = false;
  finished = false;
  lateAnnounced = false;
  events: RunEvent[] = [];
  /** satisfaction hits not tied to a passenger (doors while moving etc.) */
  private nextId = 1;
  /** last meter value when the bus is empty */
  private emptyMeter = 85;

  constructor(
    public route: RouteData,
    public dir: 0 | 1,
    /** clock density (rush hour > 1) */
    public density: number,
    private rand: () => number = Math.random,
  ) {
    this.d = route.dirs[dir];
    this.cum = [0];
    const L = this.d.line;
    for (let i = 2; i < L.length; i += 2) this.cum.push(this.cum[this.cum.length - 1] + Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]));
    this.served = this.d.stops.map(() => false);
    this.waiting = this.d.stops.map((_, i) => this.generate(i, i === 0 ? 1.6 : 1));
    // time limit: ~20 km/h average plus 20 s per stop
    this.timeLimit = Math.round(this.d.length / 5.5 + this.d.stops.length * 20);
    this.s = this.d.stops[0].s;
  }

  get stops() {
    return this.d.stops;
  }

  private generate(i: number, mult: number): Passenger[] {
    const stops = this.d.stops;
    if (i >= stops.length - 1) return [];
    const hub = HUBS.test(stops[i].name) ? 1.8 : 1;
    const mean = 4.5 * this.route.demand * hub * mult * Math.max(0.4, this.density);
    const n = Math.max(0, Math.round(mean * (0.5 + this.rand())));
    const out: Passenger[] = [];
    for (let k = 0; k < n; k++) {
      // destinations: further stops, hubs and the terminus are popular
      const weights = stops.map((st, j) => (j <= i ? 0 : (HUBS.test(st.name) ? 2.2 : 1) * (j === stops.length - 1 ? 1.6 : 1)));
      let r = this.rand() * weights.reduce((a, b) => a + b, 0);
      let to = i + 1;
      for (let j = i + 1; j < stops.length; j++) if ((r -= weights[j]) <= 0) {
        to = j;
        break;
      }
      const roll = this.rand();
      const kind: PaxKind = roll < 0.48 ? 'man' : roll < 0.8 ? 'woman' : roll < 0.94 ? 'student' : 'elderly';
      // patience starts when the bus could reasonably be there (~20 km/h from the start)
      const due = mult >= 1 ? -((stops[i].s - stops[0].s) / 5.5) * (0.7 + this.rand() * 0.5) : 0;
      out.push({ id: this.nextId++, kind, from: i, to, fare: fareFor(stops[to].s - stops[i].s, kind === 'student'), satisfaction: 78 + this.rand() * 12, place: null, waitedFor: due });
    }
    return out;
  }

  // ---------------------------------------------------------------- seating
  counts() {
    const c = { seat: 0, ladies: 0, standing: 0, hanging: 0 };
    for (const p of this.onboard) if (p.place) c[p.place]++;
    return c;
  }

  get load() {
    return this.onboard.length;
  }

  get capacity() {
    const rush = this.density > 1.1;
    return CAPACITY.seats + CAPACITY.ladies + CAPACITY.standing + (rush ? CAPACITY.hanging : 0);
  }

  private seat(p: Passenger): Place | null {
    const c = this.counts();
    const lady = p.kind === 'woman' || p.kind === 'elderly';
    if (lady && c.ladies < CAPACITY.ladies) return 'ladies';
    if (c.seat < CAPACITY.seats) return 'seat';
    if (c.standing < CAPACITY.standing) return 'standing';
    // hanging off the door: only at rush hour, and not for the elderly
    if (this.density > 1.1 && p.kind !== 'elderly' && c.hanging < CAPACITY.hanging) return 'hanging';
    return null;
  }

  /** When someone gets off, a standing passenger takes the seat. */
  private reseat() {
    for (const p of this.onboard) {
      if (p.place !== 'standing' && p.place !== 'hanging') continue;
      const c = this.counts();
      const lady = p.kind === 'woman' || p.kind === 'elderly';
      if (lady && c.ladies < CAPACITY.ladies) p.place = 'ladies';
      else if (c.seat < CAPACITY.seats) p.place = 'seat';
      else if (p.place === 'hanging' && c.standing < CAPACITY.standing) p.place = 'standing';
    }
  }

  /** Overall passenger satisfaction 0..100 (meter in the HUD). */
  get satisfaction(): number {
    if (!this.onboard.length) return this.emptyMeter;
    return this.onboard.reduce((a, p) => a + p.satisfaction, 0) / this.onboard.length;
  }

  private hurt(amount: number, who: Passenger[] = this.onboard) {
    for (const p of who) p.satisfaction = Math.max(0, p.satisfaction - amount);
    if (who === this.onboard) this.emptyMeter = Math.max(0, this.emptyMeter - amount * 0.3);
  }

  // ---------------------------------------------------------------- progress along the line
  private project(x: number, y: number): { s: number; d: number } {
    const L = this.d.line;
    let best = Infinity;
    let bs = this.s;
    // search a window around the current progress (the line can pass the same place twice)
    for (let i = 0; i + 3 < L.length; i += 2) {
      const k = i / 2;
      if (this.cum[k + 1] < this.s - 250 || this.cum[k] > this.s + 600) continue;
      const ax = L[i];
      const ay = L[i + 1];
      const dx = L[i + 2] - ax;
      const dy = L[i + 3] - ay;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (d < best) {
        best = d;
        bs = this.cum[k] + Math.sqrt(L2) * t;
      }
    }
    return { s: bs, d: best };
  }

  /** Point and unit tangent on the route line at distance s. */
  pointAt(s: number): [number, number, number, number] {
    const L = this.d.line;
    let k = 0;
    while (k < this.cum.length - 2 && this.cum[k + 1] < s) k++;
    const seg = this.cum[k + 1] - this.cum[k] || 1;
    const t = Math.max(0, Math.min(1, (s - this.cum[k]) / seg));
    const dx = (L[k * 2 + 2] - L[k * 2]) / seg;
    const dy = (L[k * 2 + 3] - L[k * 2 + 1]) / seg;
    return [L[k * 2] + dx * seg * t, L[k * 2 + 1] + dy * seg * t, dx, dy];
  }

  // ---------------------------------------------------------------- per-frame update
  update(dt: number, bus: BusState, frontOffset: number) {
    if (this.finished) return;
    this.events.length = 0;
    this.time += dt;
    const stops = this.d.stops;

    // where are we on the route? (front door ≈ near the front of the bus)
    const pr = this.project(bus.x, bus.y);
    this.offRoute = pr.d;
    if (pr.d < 40) this.s = pr.s;
    const off = pr.d > 45;
    if (off !== this.wasOff) this.events.push({ type: off ? 'off-route' : 'on-route' });
    this.wasOff = off;
    const doorS = this.s + frontOffset;

    // trickle of new passengers at stops ahead
    if (this.rand() < dt / 25) {
      const i = this.next + 1 + Math.floor(this.rand() * Math.max(1, stops.length - this.next - 2));
      if (i < stops.length - 1) this.waiting[i].push(...this.generate(i, 0.25));
    }
    for (const list of this.waiting) for (const p of list) p.waitedFor += dt;

    // ride comfort
    const harsh = Math.max(0, Math.abs(bus.accel) - 2.5) + Math.max(0, Math.abs(bus.lateral) - 2.8);
    if (harsh > 0) this.hurt(harsh * 4 * dt);
    else if (Math.abs(bus.speed) > 1 && Math.abs(bus.accel) < 1.2) for (const p of this.onboard) p.satisfaction = Math.min(100, p.satisfaction + 0.25 * dt);
    if (bus.speed > 70 / 3.6) this.hurt(1.5 * dt);
    if (bus.impact > 1.2) this.hurt(Math.min(30, bus.impact * 3));
    if (bus.doorsOpen && Math.abs(bus.speed) > 2) this.hurt(3 * dt);
    // crowding: standing is tolerated, hanging off the door is not; an overfull bus annoys all
    const overfull = this.load > CAPACITY.seats + CAPACITY.ladies + CAPACITY.standing;
    for (const p of this.onboard) {
      if (p.place === 'standing') p.satisfaction -= 0.05 * dt;
      if (p.place === 'hanging') p.satisfaction -= 0.2 * dt;
      if (overfull) p.satisfaction -= 0.04 * dt;
    }

    this.sampleMeter();

    // time limit
    if (!this.lateAnnounced && this.time > this.timeLimit) {
      this.lateAnnounced = true;
      this.events.push({ type: 'late' });
    }

    if (this.next >= stops.length) return;
    const st = stops[this.next];
    const dist = st.s - doorS;

    if (dist < 160 && dist > 25 && this.approachAnnounced !== this.next) {
      this.approachAnnounced = this.next;
      this.events.push({ type: 'approach', stop: this.next });
    }

    // stopped in the stop zone?
    const inZone = dist > -18 && dist < 25 && pr.d < 14;
    const stopped = Math.abs(bus.speed) < 0.7;
    if (inZone && stopped) {
      if (this.atStop !== this.next) {
        this.atStop = this.next;
        this.accuracy = Math.abs(dist);
        this.boardTimer = 0;
        this.events.push({ type: 'arrived', stop: this.next });
        // accurate stopping pleases everyone; stopping way off annoys them
        if (this.accuracy < 5) for (const p of [...this.onboard, ...this.waiting[this.next]]) p.satisfaction = Math.min(100, p.satisfaction + 4);
        else if (this.accuracy > 14) this.hurt(4, [...this.onboard, ...this.waiting[this.next]]);
      }
      const wantOff = this.onboard.filter((p) => p.to === this.next);
      if (!bus.doorsOpen) {
        if (wantOff.length || this.waiting[this.next].length) this.events.push({ type: 'doors-needed', stop: this.next });
      } else this.processStop(dt, wantOff);
    } else if (this.atStop === this.next && Math.abs(bus.speed) > 1.5) {
      // at the terminus of origin, creeping forward before anyone boarded isn't a departure
      if (this.next === 0 && this.onboard.length === 0 && this.delivered === 0) this.atStop = -1;
      else this.leaveStop();
    }

    // drove past without stopping (or drove off beyond the end of the route at the terminus)
    const pastEnd = this.next === stops.length - 1 && this.s >= this.cum[this.cum.length - 1] - 3 && pr.d > 30;
    if ((dist < -40 || pastEnd) && !this.served[this.next]) {
      const needed = this.onboard.some((p) => p.to === this.next) || this.waiting[this.next].length > 0;
      if (needed) {
        this.missed++;
        this.emptyMeter = Math.max(0, this.emptyMeter - 8);
        const angry = this.onboard.filter((p) => p.to === this.next);
        this.hurt(30, angry);
        for (const p of angry) p.to = Math.min(stops.length - 1, this.next + 1);
        this.events.push({ type: 'missed', stop: this.next, count: angry.length + this.waiting[this.next].length });
      }
      this.served[this.next] = true;
      this.next++;
      if (this.next >= stops.length) this.finish();
    }
  }

  private processStop(dt: number, wantOff: Passenger[]) {
    const i = this.next;
    this.boardTimer -= dt;
    // two doors: roughly one person every 0.55 s
    while (this.boardTimer <= 0) {
      if (wantOff.length) {
        const p = wantOff.shift()!;
        this.onboard.splice(this.onboard.indexOf(p), 1);
        // grumpy passengers argue with the conductor and pay less
        const paid = p.satisfaction < 30 ? Math.round(p.fare * 0.7) : p.fare;
        this.fares += paid;
        this.delivered++;
        this.events.push({ type: 'alight', stop: i, amount: paid });
        this.reseat();
        this.boardTimer += 0.5;
        continue;
      }
      const q = this.waiting[i];
      if (q.length) {
        const p = q[0];
        const place = this.seat(p);
        if (!place) {
          this.events.push({ type: 'full', stop: i, count: q.length });
          break;
        }
        q.shift();
        p.place = place;
        if (p.waitedFor > 120) p.satisfaction -= Math.min(15, (p.waitedFor - 120) / 20);
        this.onboard.push(p);
        this.events.push({ type: 'board', stop: i, count: 1 });
        this.boardTimer += 0.6;
        continue;
      }
      // done: mark served; the final stop ends the run once everyone is off
      if (!this.served[i]) {
        this.served[i] = true;
        if (i === this.d.stops.length - 1) this.finish();
      }
      break;
    }
  }

  private leaveStop() {
    const i = this.atStop;
    const left = this.waiting[i]?.length ?? 0;
    if (left > 0 && this.load < this.capacity) {
      this.skipped += left;
      this.events.push({ type: 'skipped', stop: i, count: left });
    }
    const unserved = this.onboard.filter((p) => p.to === i);
    if (unserved.length) {
      // pulled away before people could get off
      this.hurt(25, unserved);
      for (const p of unserved) p.to = Math.min(this.d.stops.length - 1, i + 1);
    }
    this.served[i] = true;
    this.atStop = -1;
    this.events.push({ type: 'depart', stop: i });
    if (i === this.next) this.next++;
    if (this.next >= this.d.stops.length) this.finish();
  }

  private finish() {
    if (this.finished) return;
    // anyone still aboard at the terminus gets off now
    for (const p of this.onboard) {
      this.fares += p.fare;
      this.delivered++;
    }
    this.onboard = [];
    this.finished = true;
    this.events.push({ type: 'finished' });
  }

  /** Final score; `fines` = fines incurred during the run. */
  result(fines: number): RunResult {
    const satisfaction = Math.round(this.emptyMeter);
    const onTime = this.time <= this.timeLimit;
    const timeBonus = onTime ? Math.round(this.fares * 0.1) : 0;
    const rep = Math.round((satisfaction - 60) / 8 - this.missed * 2 - this.skipped * 0.3 + (onTime ? 2 : -2));
    // only the part of the route actually served counts
    const service = (this.d.stops.length - this.missed) / this.d.stops.length;
    const score = 1 + (satisfaction / 100) * 2 * service + (onTime ? service : 0) + (this.missed === 0 ? 1 : 0) - Math.min(2, fines / 2000);
    return {
      route: this.route.name,
      fares: this.fares,
      fines,
      passengers: this.delivered,
      satisfaction,
      missed: this.missed,
      skipped: this.skipped,
      onTime,
      timeBonus,
      reputation: rep,
      stars: Math.max(1, Math.min(5, Math.round(score))),
      seconds: Math.round(this.time),
    };
  }

  /** Track satisfaction while passengers are aboard so the result reflects the whole run. */
  sampleMeter() {
    if (this.onboard.length) this.emptyMeter = this.emptyMeter * 0.98 + this.satisfaction * 0.02;
  }
}
