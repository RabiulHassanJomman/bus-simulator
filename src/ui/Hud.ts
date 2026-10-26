// DOM heads-up display: speedometer, gear, damage, fines, road name, toasts.
import type { Bus } from '../game/Bus';
import type { Lang } from '../render/Labels';

export class Hud {
  private el: HTMLDivElement;
  private speed: HTMLElement;
  private gear: HTMLElement;
  private rpmArc: SVGPathElement;
  private damage: HTMLElement;
  private damageBar: HTMLElement;
  private fines: HTMLElement;
  private road: HTMLElement;
  private level: HTMLElement;
  private toasts: HTMLElement;
  private help: HTMLElement;
  lang: Lang = 'en';

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="hud-road"><span class="road-name"></span><span class="road-level"></span></div>
      <div class="hud-speedo">
        <svg viewBox="0 0 120 120"><path class="arc-bg" d="M 22 92 A 48 48 0 1 1 98 92" />
        <path class="arc" d="M 22 92 A 48 48 0 1 1 98 92" /></svg>
        <div class="speed">0</div><div class="unit">km/h</div><div class="gear">N</div>
      </div>
      <div class="hud-stats">
        <div><label>Damage</label><div class="bar"><div class="fill"></div></div><span class="damage">0%</span></div>
        <div><label>Fines</label><span class="fines">৳0</span></div>
      </div>
      <div class="hud-toasts"></div>
      <div class="hud-help">
        <b>W/S</b> or <b>↑/↓</b> drive / brake · <b>A/D</b> steer · <b>Space</b> handbrake · <b>H</b> horn ·
        <b>E</b> doors · <b>L</b> lights · <b>R</b> reset to road · <b>C</b> camera · <b>M</b> map · <b>B</b> বাংলা
      </div>`;
    document.body.appendChild(this.el);
    const q = <T extends Element = HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.speed = q('.speed');
    this.gear = q('.gear');
    this.rpmArc = q<SVGPathElement>('.arc');
    this.damage = q('.damage');
    this.damageBar = q('.bar .fill');
    this.fines = q('.fines');
    this.road = q('.road-name');
    this.level = q('.road-level');
    this.toasts = q('.hud-toasts');
    this.help = q('.hud-help');
    const len = this.rpmArc.getTotalLength();
    this.rpmArc.style.strokeDasharray = `${len}`;
    this.rpmArc.dataset.len = String(len);
    setTimeout(() => this.help.classList.add('fade'), 25000);
  }

  update(bus: Bus) {
    const p = bus.phys;
    this.speed.textContent = String(Math.round(p.kmh));
    this.gear.textContent = p.gear === -1 ? 'R' : p.speed === 0 && p.gear === 1 ? 'N' : String(p.gear);
    const len = Number(this.rpmArc.dataset.len);
    const f = (p.rpm - p.spec.idleRpm) / (p.spec.maxRpm - p.spec.idleRpm);
    this.rpmArc.style.strokeDashoffset = String(len * (1 - Math.max(0.02, Math.min(1, f))));
    this.rpmArc.classList.toggle('red', f > 0.85);
    const dmg = Math.round(bus.damage);
    this.damage.textContent = `${dmg}%`;
    this.damageBar.style.width = `${dmg}%`;
    this.damageBar.style.background = dmg > 60 ? '#e53935' : dmg > 30 ? '#f9a825' : '#43a047';
    this.fines.textContent = `৳${bus.fines.toLocaleString('en-IN')}`;
    const name = this.lang === 'bn' ? bus.roadNameBn || bus.roadName : bus.roadName || bus.roadNameBn;
    this.road.textContent = name || (bus.onRoad ? '' : this.lang === 'bn' ? 'রাস্তার বাইরে' : 'Off road');
    this.level.textContent = bus.level > 0 ? (this.lang === 'bn' ? ' · ফ্লাইওভার' : ' · Flyover') : '';
    this.el.querySelector('.hud-road')!.classList.toggle('empty', !this.road.textContent);
  }

  toast(text: string, kind: 'bad' | 'info' = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild!.remove();
  }
}
