// HUD panel for an active route: next stop, passengers, fares, satisfaction, time; Tab list.
import type { RouteRun } from '../game/career/RouteRun';
import { CAPACITY } from '../game/career/RouteRun';
import type { Lang } from '../render/Labels';

const fmt = (n: number) => `৳${Math.round(n).toLocaleString('en-IN')}`;

export class RunHud {
  private el: HTMLDivElement;
  private list: HTMLDivElement;
  private arrow: HTMLDivElement;
  lang: Lang = 'en';
  prompt = '';
  private promptUntil = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'run-hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="rh-route"><span class="swatch"></span><b class="rname"></b></div>
      <div class="rh-next"><small class="lbl"></small><div class="stop"></div><div class="dist"></div></div>
      <div class="rh-progress"><div></div></div>
      <div class="rh-grid">
        <div><small class="l-pax"></small><b class="pax"></b><span class="pax-detail"></span></div>
        <div><small class="l-fares"></small><b class="fares"></b></div>
        <div><small class="l-time"></small><b class="time"></b></div>
        <div><small class="l-sat"></small><div class="sat"><div></div></div></div>
      </div>
      <div class="rh-prompt"></div>`;
    document.body.appendChild(this.el);
    this.list = document.createElement('div');
    this.list.id = 'run-stops';
    this.list.hidden = true;
    document.body.appendChild(this.list);
    this.arrow = document.createElement('div');
    this.arrow.id = 'route-arrow';
    this.arrow.hidden = true;
    this.arrow.innerHTML = '<span>➤</span><small></small>';
    document.body.appendChild(this.arrow);
  }

  show(on: boolean) {
    this.el.hidden = !on;
    // lets the CSS rearrange the top bar while a route is running
    document.body.classList.toggle('in-run', on);
    if (!on) {
      this.list.hidden = true;
      this.arrow.hidden = true;
    }
  }

  toggleList() {
    this.list.hidden = !this.list.hidden;
  }

  flash(text: string, seconds = 3) {
    this.prompt = text;
    this.promptUntil = performance.now() + seconds * 1000;
  }

  update(run: RouteRun, opts: { avgSpeed: number; bearingToRoute: number | null; screenRot: number }) {
    const bn = this.lang === 'bn';
    const q = <T extends Element = HTMLElement>(s: string) => this.el.querySelector(s) as T;
    q('.swatch').style.background = `#${run.route.color.toString(16).padStart(6, '0')}`;
    q('.rname').textContent = `${bn ? run.route.nameBn : run.route.name} · ${bn ? 'যাচ্ছে' : 'to'} ${bn ? run.stops[run.stops.length - 1].nameBn : run.d.to}`;
    q('.lbl').textContent = bn ? 'পরবর্তী স্টপ' : 'Next stop';
    const st = run.stops[Math.min(run.next, run.stops.length - 1)];
    q('.stop').textContent = run.finished ? (bn ? 'শেষ' : 'Done') : bn ? st.nameBn : st.name;
    const dist = Math.max(0, st.s - run.s);
    const eta = dist / Math.max(3, opts.avgSpeed);
    q('.dist').textContent = run.finished
      ? ''
      : `${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist / 10) * 10 + ' m'} · ${Math.ceil(eta / 60)} min`;
    (q('.rh-progress div') as HTMLElement).style.width = `${Math.min(100, ((run.s - run.stops[0].s) / (run.d.length - run.stops[0].s)) * 100)}%`;
    const c = run.counts();
    q('.l-pax').textContent = bn ? 'যাত্রী' : 'Passengers';
    q('.pax').textContent = `${run.load}/${run.capacity}`;
    q('.pax-detail').textContent = `${bn ? 'বসা' : 'seated'} ${c.seat + c.ladies} · ${bn ? 'দাঁড়ানো' : 'standing'} ${c.standing}${c.hanging ? ` · ${bn ? 'ঝুলন্ত' : 'hanging'} ${c.hanging}` : ''}`;
    q('.l-fares').textContent = bn ? 'ভাড়া' : 'Fares';
    q('.fares').textContent = fmt(run.fares);
    q('.l-time').textContent = bn ? 'সময় বাকি' : 'Time left';
    const left = run.timeLimit - run.time;
    const tEl = q('.time');
    tEl.textContent = `${left < 0 ? '−' : ''}${Math.floor(Math.abs(left) / 60)}:${String(Math.floor(Math.abs(left) % 60)).padStart(2, '0')}`;
    tEl.classList.toggle('late', left < 0);
    q('.l-sat').textContent = bn ? 'সন্তুষ্টি' : 'Satisfaction';
    const sat = run.satisfaction;
    const satBar = q('.sat div');
    satBar.style.width = `${sat}%`;
    satBar.style.background = sat > 70 ? '#43a047' : sat > 45 ? '#f9a825' : '#e53935';
    const prompt = performance.now() < this.promptUntil ? this.prompt : '';
    const pEl = q('.rh-prompt');
    pEl.textContent = prompt;
    pEl.hidden = !prompt;

    // arrow back to the route when lost
    if (opts.bearingToRoute !== null) {
      this.arrow.hidden = false;
      (this.arrow.firstElementChild as HTMLElement).style.transform = `rotate(${opts.bearingToRoute - opts.screenRot}rad)`;
      (this.arrow.lastElementChild as HTMLElement).textContent = bn ? 'রুটে ফিরুন' : 'Back to route';
    } else this.arrow.hidden = true;

    if (!this.list.hidden) this.renderList(run);
  }

  private renderList(run: RouteRun) {
    const bn = this.lang === 'bn';
    const rows = run.stops
      .map((st, i) => {
        const state = i < run.next ? 'done' : i === run.next ? 'next' : '';
        const off = run.onboard.filter((p) => p.to === i).length;
        const wait = run.waiting[i].length;
        return `<li class="${state}"><span class="dot"></span><b>${bn ? st.nameBn : st.name}</b><span>${(st.s / 1000).toFixed(1)} km</span><span title="waiting">🧍 ${wait}</span><span title="getting off">⬇ ${off}</span></li>`;
      })
      .join('');
    this.list.innerHTML = `<h3>${bn ? run.route.nameBn : run.route.name}</h3><ol>${rows}</ol><p>${CAPACITY.seats} ${bn ? 'আসন' : 'seats'} + ${CAPACITY.ladies} ${bn ? 'মহিলা আসন' : "ladies' seats"} · ${CAPACITY.standing} ${bn ? 'দাঁড়ানো' : 'standing'}</p>`;
  }
}
