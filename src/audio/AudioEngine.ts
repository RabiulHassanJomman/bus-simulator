// Synthesised audio (WebAudio). Real recorded samples replace these in the Phase 7 asset pass.

export type HornStyle = 'pressure' | 'dual' | 'air' | 'beep';
export const HORN_STYLES: HornStyle[] = ['pressure', 'dual', 'air', 'beep'];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engOsc: OscillatorNode[] = [];
  private squealGain!: GainNode;
  private squealOsc!: OscillatorNode;
  private hornNodes: { stop: () => void } | null = null;
  private noise!: AudioBuffer;
  hornStyle: HornStyle = 'pressure';
  volume = 0.7;
  muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // white noise buffer shared by hiss/crash effects
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // diesel engine: firing-frequency saw + sub square + rough noise through a low-pass
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    const mk = (type: OscillatorType, mult: number, g: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.engineFilter);
      o.start();
      (o as OscillatorNode & { mult: number }).mult = mult;
      this.engOsc.push(o);
    };
    mk('sawtooth', 1, 0.5);
    mk('square', 0.5, 0.35);
    mk('sawtooth', 2.01, 0.18);
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.value = 0.25;
    rumble.connect(rf).connect(rg).connect(this.engineFilter);
    rumble.start();

    // brake squeal
    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = 'sine';
    this.squealOsc.frequency.value = 2650;
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vibG = ctx.createGain();
    vibG.gain.value = 40;
    vib.connect(vibG).connect(this.squealOsc.frequency);
    vib.start();
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealOsc.connect(this.squealGain).connect(this.master);
    this.squealOsc.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /** Per-frame engine/brake update. */
  update(rpm: number, throttle: number, speed: number, brake: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = (rpm / 60) * 3; // six-cylinder four-stroke firing frequency
    for (const o of this.engOsc) o.frequency.setTargetAtTime(f * (o as OscillatorNode & { mult: number }).mult, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(220 + rpm * 0.35 + throttle * 600, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.1 + throttle * 0.12 + Math.min(0.06, rpm / 40000), t, 0.08);
    const squeal = brake > 0.4 && speed > 0.6 && speed < 7 ? (brake - 0.4) * 0.05 : 0;
    this.squealGain.gain.setTargetAtTime(squeal, t, 0.06);
  }

  /** Horn on/off (holding H keeps it sounding; tapping spams). */
  horn(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.hornNodes) this.hornNodes = this.makeHorn(this.hornStyle);
    else if (!on && this.hornNodes) {
      this.hornNodes.stop();
      this.hornNodes = null;
    }
  }

  private makeHorn(style: HornStyle) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.32, t + 0.02);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = style === 'beep' ? 1400 : 900;
    bp.Q.value = 0.7;
    shaper.connect(bp).connect(out).connect(this.master);
    const oscs: OscillatorNode[] = [];
    const osc = (freq: number, type: OscillatorType = 'sawtooth') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.connect(shaper);
      o.start(t);
      oscs.push(o);
      return o;
    };
    if (style === 'dual') {
      osc(415);
      osc(523);
    } else if (style === 'air') {
      const a = osc(233);
      const b = osc(293);
      a.frequency.linearRampToValueAtTime(220, t + 0.25);
      b.frequency.linearRampToValueAtTime(277, t + 0.25);
    } else if (style === 'beep') {
      osc(620, 'square');
      osc(780, 'square');
    } else {
      // "pressure horn": the melodic multi-trumpet horn common on Dhaka buses
      const o = osc(523);
      const o2 = osc(659);
      const notes = [523, 659, 784, 659, 523, 784];
      notes.forEach((n, i) => {
        o.frequency.setValueAtTime(n, t + i * 0.13);
        o2.frequency.setValueAtTime(n * 1.26, t + i * 0.13);
      });
    }
    return {
      stop: () => {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0, now, 0.03);
        for (const o of oscs) o.stop(now + 0.2);
      },
    };
  }

  private burst(dur: number, filterType: BiquadFilterType, freq: number, gain: number, q = 0.8) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private ambientBudget = 0;
  private lastAmbient = 0;

  /**
   * A short horn from another road user `dist` metres away. Rate-limited (a few per second
   * at most) and attenuated with distance so the city sounds busy but not unbearable.
   */
  ambientHorn(dist: number, kind: string) {
    const ctx = this.ctx;
    if (!ctx || dist > 140) return;
    const now = ctx.currentTime;
    this.ambientBudget = Math.min(3, this.ambientBudget + (now - this.lastAmbient) * 2.5);
    this.lastAmbient = now;
    if (this.ambientBudget < 1) return;
    this.ambientBudget -= 1;
    const vol = 0.11 * Math.max(0, 1 - dist / 140) ** 1.5;
    const freqs: Record<string, [number, number, OscillatorType]> = {
      motorcycle: [880, 1110, 'square'],
      cng: [700, 0, 'square'],
      rickshaw: [2200, 0, 'triangle'], // bicycle bell
      bus: [440, 554, 'sawtooth'],
      truck: [196, 247, 'sawtooth'],
    };
    const [f1, f2, type] = freqs[kind] ?? [520, 655, 'sawtooth'];
    const dur = kind === 'rickshaw' ? 0.35 : 0.12 + Math.random() * 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.01);
    g.gain.setValueAtTime(vol, now + dur);
    g.gain.exponentialRampToValueAtTime(0.0005, now + dur + (kind === 'rickshaw' ? 0.6 : 0.05));
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2500 - dist * 10;
    g.connect(f).connect(this.master);
    for (const fr of [f1, f2]) {
      if (!fr) continue;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr * (0.97 + Math.random() * 0.06);
      o.connect(g);
      o.start(now);
      o.stop(now + dur + 0.7);
      // rickshaw bell rings twice
      if (kind === 'rickshaw') {
        g.gain.setValueAtTime(vol, now + 0.18);
      }
    }
  }

  crash(impact: number) {
    const s = Math.min(1, impact / 8);
    this.burst(0.25 + s * 0.4, 'lowpass', 500 + s * 900, 0.4 + s * 0.6);
    this.burst(0.15 + s * 0.2, 'bandpass', 2500, 0.15 + s * 0.25, 2); // rattling metal
  }

  /** Pneumatic door hiss. */
  doors() {
    this.burst(0.7, 'highpass', 3500, 0.22);
  }

  click() {
    this.burst(0.05, 'bandpass', 1800, 0.1, 4);
  }
}
