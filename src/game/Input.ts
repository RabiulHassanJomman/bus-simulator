// Driving input from keyboard, gamepad and touch, merged into analogue Controls.
import type { Controls } from './BusPhysics';
import type { SteerMode } from './Settings';

export type Action = 'horn' | 'doors' | 'lights' | 'reset' | 'camera' | 'map' | 'lang' | 'labels';

/** On-screen wheel rotation (rad) for full steering lock. */
const WHEEL_LOCK = Math.PI / 2;
/** Phone tilt (degrees) for full lock, and the dead zone around level. */
const TILT_LOCK = 28;
const TILT_DEAD = 2.5;
const STEER_ICON: Record<SteerMode, string> = { wheel: '🛞', buttons: '⇆', tilt: '📱' };

type OrientationEventCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

const KEY_ACTIONS: Record<string, Action> = {
  e: 'doors',
  l: 'lights',
  r: 'reset',
  c: 'camera',
  m: 'map',
  b: 'lang',
  n: 'labels',
};

export class Input {
  readonly controls: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  horn = false;
  /** actions triggered since last poll */
  private queued: Action[] = [];
  private keys = new Set<string>();
  private touch = { steer: 0, gas: false, brake: false, horn: false, left: false, right: false, active: false };
  private steerMode: SteerMode;
  /** phone roll (degrees, + = right side down) from the orientation sensor, and its level reference */
  private tiltRaw: number | null = null;
  private tiltZero = 0;
  private tiltSmooth = 0;
  private wheelInner: HTMLElement | null = null;
  private padPrev: boolean[] = [];
  enabled = true;
  /** true once the player has given any driving input (camera follow resumes) */
  drivingInput = false;

  constructor(
    steerMode: SteerMode = 'wheel',
    private onSteerMode?: (m: SteerMode) => void,
  ) {
    this.steerMode = steerMode;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
      if (!e.repeat && KEY_ACTIONS[k]) this.queued.push(KEY_ACTIONS[k]);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    if (matchMedia('(pointer: coarse)').matches) this.buildTouchUI();
  }

  trigger(a: Action) {
    this.queued.push(a);
  }

  /** Drain queued one-shot actions. */
  actions(): Action[] {
    const a = this.queued;
    this.queued = [];
    return a;
  }

  private k(...names: string[]) {
    return names.some((n) => this.keys.has(n));
  }

  update(dt: number) {
    const c = this.controls;
    if (!this.enabled) {
      c.throttle = c.brake = c.steer = 0;
      c.handbrake = false;
      this.horn = false;
      return;
    }
    // keyboard: digital keys ramp so steering isn't twitchy
    const up = this.k('w', 'arrowup');
    const down = this.k('s', 'arrowdown');
    const left = this.k('a', 'arrowleft');
    const right = this.k('d', 'arrowright');
    const ramp = (v: number, target: number, rateUp: number, rateDown: number) => {
      const r = Math.abs(target) > Math.abs(v) ? rateUp : rateDown;
      return v + Math.max(-r * dt, Math.min(r * dt, target - v));
    };
    let throttle = ramp(c.throttle, up ? 1 : 0, 2.2, 5);
    let brake = ramp(c.brake, down ? 1 : 0, 3.5, 6);
    let steer = ramp(c.steer, (right ? 1 : 0) - (left ? 1 : 0), 2.2, 3.2);
    let handbrake = this.k(' ');
    let horn = this.k('h');

    // gamepad (standard mapping)
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const sx = dz(pad.axes[0] ?? 0);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (Math.abs(sx) > 0) steer = sx * Math.abs(sx) * 0.6 + sx * 0.4;
      if (rt > 0.02) throttle = rt;
      if (lt > 0.02) brake = lt;
      if (pad.buttons[0]?.pressed) handbrake = true;
      if (pad.buttons[1]?.pressed) horn = true;
      const edge = (i: number, a: Action) => {
        const p = !!pad.buttons[i]?.pressed;
        if (p && !this.padPrev[i]) this.queued.push(a);
        this.padPrev[i] = p;
      };
      edge(2, 'doors');
      edge(3, 'reset');
      edge(4, 'camera');
      edge(5, 'lights');
      edge(8, 'map');
    }

    // touch
    if (this.touch.active) {
      const t = this.touch;
      if (this.steerMode === 'buttons') {
        // hold to turn: quick ramp to full lock, quicker return
        t.steer = ramp(t.steer, (t.right ? 1 : 0) - (t.left ? 1 : 0), 3.2, 5);
      } else if (this.steerMode === 'tilt' && this.tiltRaw !== null) {
        let d = this.tiltRaw - this.tiltZero;
        d = Math.sign(d) * Math.max(0, Math.abs(d) - TILT_DEAD);
        const v = Math.sign(d) * Math.min(1, (Math.abs(d) / (TILT_LOCK - TILT_DEAD)) ** 1.15);
        this.tiltSmooth += (v - this.tiltSmooth) * (1 - Math.exp(-dt * 14));
        t.steer = Math.abs(this.tiltSmooth) < 0.01 ? 0 : this.tiltSmooth;
      }
      if (this.steerMode !== 'wheel' && this.wheelInner) this.wheelInner.style.transform = t.steer ? `rotate(${t.steer * WHEEL_LOCK}rad)` : '';
      if (t.steer !== 0) steer = t.steer;
      if (this.touch.gas) throttle = ramp(c.throttle, 1, 2.2, 5);
      if (this.touch.brake) brake = ramp(c.brake, 1, 3.5, 6);
      if (this.touch.horn) horn = true;
    }

    c.throttle = throttle;
    c.brake = brake;
    c.steer = Math.max(-1, Math.min(1, steer));
    c.handbrake = handbrake;
    this.horn = horn;
    if (throttle > 0.05 || brake > 0.05 || Math.abs(steer) > 0.05) this.drivingInput = true;
  }

  // ---- on-screen controls for phones/tablets
  private buildTouchUI() {
    const ui = document.createElement('div');
    ui.id = 'touch-drive';
    ui.innerHTML = `
      <div class="wheel" data-c="wheel"><div class="wheel-inner"><span></span></div></div>
      <div class="steer-buttons">
        <button class="steer-btn" data-c="left">◀</button>
        <button class="steer-btn" data-c="right">▶</button>
      </div>
      <div class="pedals">
        <button class="pedal brake" data-c="brake">BRAKE</button>
        <button class="pedal gas" data-c="gas">GAS</button>
      </div>
      <div class="small-buttons">
        <button data-c="horn">📯</button>
        <button data-a="doors">🚪</button>
        <button data-a="reset">↺</button>
        <button data-a="camera">🧭</button>
        <button class="steer-mode" title="Steering: wheel / buttons / tilt"></button>
      </div>
      <div class="tilt-hint"></div>`;
    document.body.appendChild(ui);
    this.touch.active = true;
    const wheel = ui.querySelector<HTMLDivElement>('.wheel')!;
    const inner = (this.wheelInner = ui.querySelector<HTMLDivElement>('.wheel-inner')!);
    const modeBtn = ui.querySelector<HTMLButtonElement>('.steer-mode')!;
    const hint = ui.querySelector<HTMLDivElement>('.tilt-hint')!;

    // Wheel: follow the finger's rotation incrementally (no jump when it crosses ±180°, any
    // amount of turning accumulates), so a hard turn is a quarter turn of the thumb.
    let wheelPointer = -1;
    let lastAngle = 0;
    let wheelAngle = 0;
    const polar = (e: PointerEvent) => {
      const r = wheel.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      return { a: Math.atan2(dy, dx), r: Math.hypot(dx, dy), size: r.width };
    };
    wheel.addEventListener('pointerdown', (e) => {
      if (this.steerMode === 'tilt') {
        // tap the wheel in tilt mode: current phone angle becomes "straight"
        this.recalibrateTilt();
        return;
      }
      if (this.steerMode !== 'wheel') return;
      wheelPointer = e.pointerId;
      lastAngle = polar(e).a;
      wheelAngle = this.touch.steer * WHEEL_LOCK;
      wheel.setPointerCapture(e.pointerId);
    });
    wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== wheelPointer) return;
      const p = polar(e);
      let da = p.a - lastAngle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      lastAngle = p.a;
      // near the hub the angle is noise
      if (p.r < p.size * 0.12) return;
      wheelAngle = Math.max(-WHEEL_LOCK, Math.min(WHEEL_LOCK, wheelAngle + da));
      this.touch.steer = wheelAngle / WHEEL_LOCK;
      inner.style.transform = `rotate(${wheelAngle}rad)`;
    });
    const releaseWheel = (e: PointerEvent) => {
      if (e.pointerId !== wheelPointer) return;
      wheelPointer = -1;
      this.touch.steer = 0;
      wheelAngle = 0;
      inner.style.transform = '';
    };
    wheel.addEventListener('pointerup', releaseWheel);
    wheel.addEventListener('pointercancel', releaseWheel);

    for (const el of ui.querySelectorAll<HTMLElement>('[data-c]')) {
      const c = el.dataset.c as 'gas' | 'brake' | 'horn' | 'left' | 'right' | 'wheel';
      if (c === 'wheel') continue;
      const set = (v: boolean) => {
        this.touch[c] = v;
        el.classList.toggle('down', v);
      };
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        set(true);
      });
      el.addEventListener('pointerup', () => set(false));
      el.addEventListener('pointercancel', () => set(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    for (const el of ui.querySelectorAll<HTMLElement>('[data-a]')) {
      el.addEventListener('click', () => this.queued.push(el.dataset.a as Action));
    }

    const showHint = (text: string) => {
      hint.textContent = text;
      hint.classList.add('show');
      clearTimeout((hint as unknown as { _t?: number })._t);
      (hint as unknown as { _t?: number })._t = window.setTimeout(() => hint.classList.remove('show'), 2600);
    };
    const apply = (m: SteerMode) => {
      this.steerMode = m;
      this.touch.steer = 0;
      this.touch.left = this.touch.right = false;
      ui.dataset.steer = m;
      modeBtn.textContent = STEER_ICON[m];
      inner.style.transform = '';
    };
    modeBtn.addEventListener('click', async () => {
      const order: SteerMode[] = ['wheel', 'buttons', 'tilt'];
      let next = order[(order.indexOf(this.steerMode) + 1) % order.length];
      if (next === 'tilt' && !(await this.enableTilt())) {
        showHint('Tilt steering needs motion sensor access (HTTPS)');
        next = 'wheel';
      }
      apply(next);
      this.onSteerMode?.(next);
      if (next === 'tilt') {
        this.recalibrateTilt();
        showHint('Tilt the phone to steer · tap the wheel to re-centre');
      } else showHint(next === 'wheel' ? 'Steering wheel' : 'Steering buttons');
    });

    apply(this.steerMode);
    if (this.steerMode === 'tilt') {
      // Android grants motion access straight away; iOS needs a user gesture first
      this.enableTilt().then((ok) => {
        if (ok) return;
        const retry = () => {
          this.enableTilt().then((ok2) => ok2 && this.recalibrateTilt(true));
        };
        window.addEventListener('pointerdown', retry, { once: true });
      });
    }
  }

  private tiltListening = false;
  /** Start listening to the orientation sensor; resolves false if unavailable/denied. */
  private async enableTilt(): Promise<boolean> {
    if (this.tiltListening) return true;
    const Ctor = (window as unknown as { DeviceOrientationEvent?: OrientationEventCtor }).DeviceOrientationEvent;
    if (!Ctor || !window.isSecureContext) return false;
    if (typeof Ctor.requestPermission === 'function') {
      try {
        if ((await Ctor.requestPermission()) !== 'granted') return false;
      } catch {
        return false; // not called from a user gesture
      }
    }
    this.tiltListening = true;
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta === null || e.gamma === null) return;
      this.tiltRaw = screenRoll(e.beta, e.gamma);
    });
    return true;
  }

  /** Treat the phone's current angle as straight ahead (only small offsets, so a bad tap can't lock steering). */
  private recalibrateTilt(onlyIfUnset = false) {
    if (onlyIfUnset && this.tiltZero !== 0) return;
    const set = () => {
      if (this.tiltRaw === null) return false;
      this.tiltZero = Math.abs(this.tiltRaw) < 20 ? this.tiltRaw : 0;
      this.tiltSmooth = 0;
      return true;
    };
    // first sensor reading may not have arrived yet
    if (!set()) setTimeout(set, 300);
  }
}

/**
 * Roll of the screen in degrees (+ = right edge of the screen, as the player sees it, tilted
 * down), from W3C device orientation angles. Works in portrait and landscape, phone held
 * flat or upright: it is the angle of gravity along the screen's horizontal axis.
 */
export function screenRoll(betaDeg: number, gammaDeg: number, screenAngleDeg = currentScreenAngle()): number {
  const r = Math.PI / 180;
  const b = betaDeg * r;
  const g = gammaDeg * r;
  // gravity ("down") in device coordinates for ZXY Euler angles
  const dx = Math.sin(g) * Math.cos(b);
  const dy = -Math.sin(b);
  const t = screenAngleDeg * r;
  // the screen's rightward axis in device coordinates is (cos t, -sin t)
  const sx = dx * Math.cos(t) - dy * Math.sin(t);
  return Math.asin(Math.max(-1, Math.min(1, sx))) / r;
}

function currentScreenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}
