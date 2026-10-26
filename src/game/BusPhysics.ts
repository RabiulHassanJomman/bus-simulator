// Arcade-realistic bus model (pure, unit-testable). Units: metres, seconds, kg, radians.
// Kinematic bicycle model posed at the REAR AXLE so the front overhang swings out in
// turns like a real bus; lateral slip decays with tyre grip (less under handbrake).
import type { CollisionWorld, Contact, OBB } from './CollisionWorld';

export interface BusSpec {
  id: string;
  name: string;
  length: number;
  width: number;
  wheelbase: number;
  rearOverhang: number; // rear bumper -> rear axle
  maxSteer: number; // road-wheel angle at full lock
  steerRate: number; // rad/s at the road wheels
  mass: number;
  torque: number; // peak engine torque, N·m
  gears: number[];
  finalDrive: number;
  wheelRadius: number;
  idleRpm: number;
  shiftUpRpm: number;
  shiftDownRpm: number;
  maxRpm: number;
  governor: number; // top speed, m/s
  brakeDecel: number; // m/s² at full service brake
  cdA: number; // drag coefficient × frontal area
}

export const BUSES: Record<string, BusSpec> = {
  local: {
    id: 'local',
    name: 'Local bus (non-AC)',
    length: 11.0,
    width: 2.5,
    wheelbase: 5.5,
    rearOverhang: 3.1,
    maxSteer: 0.66, // ~38°
    steerRate: 0.9,
    mass: 11500,
    torque: 590,
    gears: [6.4, 3.6, 2.2, 1.45, 1.0],
    finalDrive: 4.9,
    wheelRadius: 0.5,
    idleRpm: 650,
    shiftUpRpm: 2300,
    shiftDownRpm: 1100,
    maxRpm: 2700,
    governor: 80 / 3.6,
    brakeDecel: 6.5,
    cdA: 6.0,
  },
  doubleDecker: {
    id: 'doubleDecker',
    name: 'BRTC double-decker',
    length: 10.5,
    width: 2.55,
    wheelbase: 5.6,
    rearOverhang: 2.6,
    maxSteer: 0.63,
    steerRate: 0.8,
    mass: 15500,
    torque: 760,
    gears: [6.2, 3.5, 2.1, 1.4, 1.0],
    finalDrive: 5.1,
    wheelRadius: 0.52,
    idleRpm: 600,
    shiftUpRpm: 2200,
    shiftDownRpm: 1050,
    maxRpm: 2600,
    governor: 70 / 3.6,
    brakeDecel: 6.0,
    cdA: 7.5,
  },
};

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

const G = 9.81;
const RHO = 1.2;
const C_ROLL = 0.009;

export class BusPhysics {
  /** rear axle position (world metres) */
  x = 0;
  y = 0;
  heading = 0; // radians, 0 = +x (east), +π/2 = +y (south)
  vx = 0;
  vy = 0;
  steerAngle = 0;
  gear = 1; // 1..n forward, -1 reverse, 0 neutral
  rpm = 0;
  /** forward speed (signed), m/s */
  speed = 0;
  /** accumulated collision impulses this step: max impact speed (m/s) */
  impact = 0;
  contacts: Contact[] = [];
  private reverseTimer = 0;

  constructor(public spec: BusSpec) {
    this.rpm = spec.idleRpm;
  }

  get fx() {
    return Math.cos(this.heading);
  }
  get fy() {
    return Math.sin(this.heading);
  }

  /** Centre of the body (world metres). */
  get cx() {
    return this.x + this.fx * (this.spec.length / 2 - this.spec.rearOverhang);
  }
  get cy() {
    return this.y + this.fy * (this.spec.length / 2 - this.spec.rearOverhang);
  }

  obb(): OBB {
    return { cx: this.cx, cy: this.cy, hl: this.spec.length / 2, hw: this.spec.width / 2, fx: this.fx, fy: this.fy };
  }

  /** Place the bus so its body centre is at (cx, cy). */
  placeCentre(cx: number, cy: number, heading: number) {
    this.heading = heading;
    const off = this.spec.length / 2 - this.spec.rearOverhang;
    this.x = cx - Math.cos(heading) * off;
    this.y = cy - Math.sin(heading) * off;
    this.vx = this.vy = 0;
    this.speed = 0;
    this.steerAngle = 0;
    this.gear = 1;
  }

  private driveForce(v: number, throttle: number): number {
    const s = this.spec;
    const ratio = this.gear === -1 ? s.gears[0] : s.gears[Math.max(0, this.gear - 1)];
    const wheelRpm = (Math.abs(v) / s.wheelRadius) * (60 / (2 * Math.PI));
    this.rpm = Math.max(s.idleRpm, Math.min(s.maxRpm, wheelRpm * ratio * s.finalDrive));
    // torque curve: builds from idle, peaks mid-range, falls off near the limiter
    const t = (this.rpm - s.idleRpm) / (s.maxRpm - s.idleRpm);
    const curve = 0.72 + 0.5 * t - 0.62 * t * t;
    const limiter = this.rpm >= s.maxRpm - 20 ? 0 : 1;
    const governor = Math.abs(v) >= s.governor ? 0 : 1;
    return ((throttle * s.torque * curve * ratio * s.finalDrive) / s.wheelRadius) * limiter * governor;
  }

  step(dt: number, c: Controls, world?: CollisionWorld) {
    const s = this.spec;
    let fx = this.fx;
    let fy = this.fy;
    let vf = this.vx * fx + this.vy * fy;
    let vl = this.vx * -fy + this.vy * fx;

    // ---- gearbox: automatic, reverse engaged by holding brake at a standstill
    let throttle = c.throttle;
    let brake = c.brake;
    if (this.gear === -1) {
      // in reverse the pedals swap: "brake" drives backwards, "throttle" brakes
      [throttle, brake] = [c.brake, c.throttle];
      if (c.throttle > 0.1 && Math.abs(vf) < 0.3) this.gear = 1;
    } else {
      if (c.brake > 0.1 && c.throttle < 0.05 && Math.abs(vf) < 0.25) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.45) {
          this.gear = -1;
          this.reverseTimer = 0;
        }
      } else this.reverseTimer = 0;
      if (this.gear > 0) {
        // shift using the rpm the engine would have in the current gear
        const wheelRpm = (Math.abs(vf) / s.wheelRadius) * (60 / (2 * Math.PI));
        const rpmIn = (g: number) => wheelRpm * s.gears[g - 1] * s.finalDrive;
        if (this.gear < s.gears.length && rpmIn(this.gear) > s.shiftUpRpm) this.gear++;
        else if (this.gear > 1 && rpmIn(this.gear) < s.shiftDownRpm) this.gear--;
      }
    }
    const dir = this.gear === -1 ? -1 : 1;

    // ---- longitudinal
    const drive = this.driveForce(vf, throttle) * dir;
    const roll = C_ROLL * s.mass * G;
    const drag = 0.5 * RHO * s.cdA * vf * vf;
    let a = drive / s.mass;
    // resistances and brakes oppose motion and never reverse it
    const resist = (roll + drag) / s.mass + brake * s.brakeDecel + (c.handbrake ? 3.2 : 0);
    if (Math.abs(vf) > 1e-3) {
      const sign = Math.sign(vf);
      const dv = resist * dt;
      vf = Math.abs(vf) <= dv && Math.sign(a) !== sign ? 0 : vf - sign * Math.min(dv, Math.abs(vf));
    }
    vf += a * dt;
    if (Math.abs(vf) < 0.02 && throttle < 0.01) vf = 0;
    if (this.gear === -1 && vf > 0 && drive < 0) vf = Math.max(vf, 0);
    vf = Math.max(-4, Math.min(vf, s.governor + 0.5)); // reverse limited to ~15 km/h

    // ---- steering: speed-sensitive lock, rate-limited wheel
    const speedFactor = 1 / (1 + (Math.abs(vf) / 13) ** 2);
    const target = c.steer * s.maxSteer * (0.35 + 0.65 * speedFactor);
    const maxStep = s.steerRate * dt;
    this.steerAngle += Math.max(-maxStep, Math.min(maxStep, target - this.steerAngle));

    // ---- yaw from the bicycle model (rear-axle reference)
    let yawRate = (vf / s.wheelbase) * Math.tan(this.steerAngle);
    if (c.handbrake && Math.abs(vf) > 3) yawRate *= 1.35;
    this.heading += yawRate * dt;
    fx = this.fx;
    fy = this.fy;

    // ---- lateral grip: slip decays quickly; handbrake lets the rear slide
    const grip = c.handbrake && Math.abs(vf) > 3 ? 1.8 : 14;
    vl *= Math.exp(-grip * dt);
    this.vx = fx * vf - fy * vl;
    this.vy = fy * vf + fx * vl;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.speed = vf;
    if (this.gear > 0 || this.gear === -1) this.driveForce(vf, throttle); // refresh rpm

    // ---- collisions (ground obstacles)
    this.impact = 0;
    if (world) this.resolve(world);
  }

  /** Push the body out of obstacles and remove velocity into them. */
  resolve(world: CollisionWorld, iterations = 3) {
    for (let it = 0; it < iterations; it++) {
      const contacts = world.collideOBB(this.obb(), this.contacts);
      if (!contacts.length) return;
      // deepest contact first
      let c = contacts[0];
      for (const k of contacts) if (k.depth > c.depth) c = k;
      this.applyContact(c);
    }
  }

  applyContact(c: Contact, restitution = 0.15, friction = 0.25) {
    const d = Math.min(c.depth, 1.5) + 0.002;
    this.x += c.nx * d;
    this.y += c.ny * d;
    const vn = this.vx * c.nx + this.vy * c.ny;
    if (vn < 0) {
      this.impact = Math.max(this.impact, -vn);
      // remove normal velocity (with a small bounce), scrub tangential speed
      this.vx -= (1 + restitution) * vn * c.nx;
      this.vy -= (1 + restitution) * vn * c.ny;
      const tx = -c.ny;
      const ty = c.nx;
      const vt = this.vx * tx + this.vy * ty;
      this.vx -= vt * friction * tx;
      this.vy -= vt * friction * ty;
      this.speed = this.vx * this.fx + this.vy * this.fy;
    }
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }
}
