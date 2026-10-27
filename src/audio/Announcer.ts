// Conductor / PA announcements via the browser's speech synthesis (no audio assets needed).
// Dhaka conductors shout the next stops from the door: "Farmgate! Karwan Bazar, Shahbag! Uthen, uthen!"

export class Announcer {
  enabled = typeof speechSynthesis !== 'undefined';
  lang: 'en' | 'bn' = 'en';
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (!this.enabled) return;
    const load = () => (this.voices = speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  private voice(bn: boolean): SpeechSynthesisVoice | undefined {
    if (bn) return this.voices.find((v) => v.lang.toLowerCase().startsWith('bn'));
    return this.voices.find((v) => /en-(in|gb|us)/i.test(v.lang)) ?? this.voices.find((v) => v.lang.startsWith('en'));
  }

  private say(text: string, bnText: string, opts: { rate?: number; pitch?: number } = {}) {
    if (!this.enabled) return;
    const wantBn = this.lang === 'bn';
    const bnVoice = wantBn ? this.voice(true) : undefined;
    const u = new SpeechSynthesisUtterance(bnVoice ? bnText : text);
    const v = bnVoice ?? this.voice(false);
    if (v) u.voice = v;
    u.lang = bnVoice ? 'bn-BD' : v?.lang ?? 'en-IN';
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1;
    u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  nextStop(name: string, nameBn: string) {
    this.say(`Next stop, ${name}.`, `পরবর্তী স্টপ, ${nameBn}।`, { rate: 1 });
  }

  /** The conductor shouting the route at the door. */
  conductor(here: string, hereBn: string, onward: Array<[string, string]>) {
    const next = onward.slice(0, 3);
    this.say(
      `${here}! ${here}! ${next.map((n) => n[0]).join(', ')}! Get in, get in!`,
      `${hereBn}! ${hereBn}! ${next.map((n) => n[1]).join(', ')}! উঠেন, উঠেন!`,
      { rate: 1.25, pitch: 1.15 },
    );
  }

  terminus(name: string, nameBn: string) {
    this.say(`${name}. Last stop, everybody off!`, `${nameBn}। শেষ স্টপ, সবাই নামেন!`, { rate: 1.15, pitch: 1.1 });
  }
}
