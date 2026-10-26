// Driving input from keyboard, gamepad and touch, merged into analogue Controls.
import type { Controls } from './BusPhysics';

export type Action = 'horn' | 'doors' | 'lights' | 'reset' | 'camera' | 'map' | 'lang' | 'labels';

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
  private touch = { steer: 0, gas: false, brake: false, horn: false, active: false };
  private padPrev: boolean[] = [];
  enabled = true;
  /** true once the player has given any driving input (camera follow resumes) */
  drivingInput = false;

  constructor() {
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
      if (this.touch.steer !== 0) steer = this.touch.steer;
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
      <div class="pedals">
        <button class="pedal brake" data-c="brake">BRAKE</button>
        <button class="pedal gas" data-c="gas">GAS</button>
      </div>
      <div class="small-buttons">
        <button data-c="horn">📯</button>
        <button data-a="doors">🚪</button>
        <button data-a="reset">↺</button>
        <button data-a="camera">🧭</button>
      </div>`;
    document.body.appendChild(ui);
    this.touch.active = true;
    const wheel = ui.querySelector<HTMLDivElement>('.wheel')!;
    const inner = ui.querySelector<HTMLDivElement>('.wheel-inner')!;
    let wheelPointer = -1;
    let startAngle = 0;
    const angleOf = (e: PointerEvent) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    wheel.addEventListener('pointerdown', (e) => {
      wheelPointer = e.pointerId;
      startAngle = angleOf(e) - this.touch.steer * 2.2;
      wheel.setPointerCapture(e.pointerId);
    });
    wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== wheelPointer) return;
      let a = angleOf(e) - startAngle;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      this.touch.steer = Math.max(-1, Math.min(1, a / 2.2));
      inner.style.transform = `rotate(${this.touch.steer * 2.2}rad)`;
    });
    const releaseWheel = (e: PointerEvent) => {
      if (e.pointerId !== wheelPointer) return;
      wheelPointer = -1;
      this.touch.steer = 0;
      inner.style.transform = '';
    };
    wheel.addEventListener('pointerup', releaseWheel);
    wheel.addEventListener('pointercancel', releaseWheel);
    for (const el of ui.querySelectorAll<HTMLElement>('[data-c]')) {
      const c = el.dataset.c as 'gas' | 'brake' | 'horn' | 'wheel';
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
  }
}
