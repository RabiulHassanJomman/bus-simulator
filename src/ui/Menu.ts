// DOM overlays: start screen, route picker, results, pause.
import type { RouteData } from '../shared/routes';
import { fareFor } from '../shared/routes';
import type { CareerState } from '../game/career/Career';
import { isUnlocked, saveCareer } from '../game/career/Career';
import type { RunResult } from '../game/career/RouteRun';
import type { Lang } from '../render/Labels';

const fmt = (n: number) => `৳${Math.round(n).toLocaleString('en-IN')}`;
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export interface MenuHandlers {
  career(): void;
  freeRoam(): void;
  startRoute(route: RouteData, dir: 0 | 1): void;
  resume(): void;
  quitToMenu(): void;
}

export class Menu {
  private el: HTMLDivElement;
  lang: Lang = 'en';
  open: 'start' | 'routes' | 'results' | 'pause' | null = null;

  constructor(
    private career: CareerState,
    private routes: () => RouteData[],
    private h: MenuHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  private t(en: string, bn: string) {
    return this.lang === 'bn' ? bn : en;
  }

  close() {
    this.open = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  private show(kind: Menu['open'], html: string) {
    this.open = kind;
    this.el.hidden = false;
    this.el.innerHTML = `<div class="panel ${kind}">${html}</div>`;
  }

  private wallet() {
    return `<div class="wallet"><span>${this.t('Money', 'টাকা')} <b>${fmt(this.career.money)}</b></span><span>${this.t('Reputation', 'সুনাম')} <b>${this.career.reputation}</b></span></div>`;
  }

  startScreen() {
    this.show(
      'start',
      `<h1>Dhaka Bus Simulator</h1><h2>ঢাকা বাস সিমুলেটর</h2>
      <p class="tag">${this.t('Drive a local bus through the real streets of Dhaka.', 'ঢাকার আসল রাস্তায় লোকাল বাস চালান।')}</p>
      ${this.wallet()}
      <div class="buttons">
        <button class="primary" data-a="career">🚌 ${this.t('Career — pick a route', 'ক্যারিয়ার — রুট বাছুন')}</button>
        <button data-a="free">🗺 ${this.t('Free roam', 'মুক্তভাবে ঘুরুন')}</button>
      </div>
      <p class="hint">${this.t('Map data © OpenStreetMap contributors', 'মানচিত্র © OpenStreetMap অবদানকারীরা')}</p>`,
    );
    this.el.querySelector('[data-a=career]')!.addEventListener('click', () => this.h.career());
    this.el.querySelector('[data-a=free]')!.addEventListener('click', () => this.h.freeRoam());
  }

  routePicker() {
    const routes = this.routes();
    const dirs = new Map<string, 0 | 1>();
    const cards = routes
      .map((r) => {
        const unlocked = isUnlocked(this.career, r.id, r.unlock);
        const d = r.dirs[0];
        const best = this.career.best[r.id] ?? 0;
        const color = `#${r.color.toString(16).padStart(6, '0')}`;
        const fullFare = fareFor(d.length, false);
        return `<div class="route-card ${unlocked ? '' : 'locked'}" data-id="${r.id}" style="--c:${color}">
          <div class="rc-head"><b>${this.lang === 'bn' ? r.nameBn : r.name}</b><span class="stars">${best ? stars(best) : ''}</span></div>
          <div class="rc-via">${this.t('via', 'হয়ে')} ${r.via}</div>
          <div class="rc-stats"><span>${(d.length / 1000).toFixed(1)} km</span><span>${d.stops.length} ${this.t('stops', 'স্টপ')}</span><span>${this.t('end-to-end fare', 'পুরো ভাড়া')} ${fmt(fullFare)}</span></div>
          ${
            unlocked
              ? `<div class="rc-dir"><button data-dir="0" class="on">${d.from} → ${d.to}</button><button data-dir="1">${r.dirs[1].from} → ${r.dirs[1].to}</button></div>
                 <button class="primary go">${this.t('Start route', 'শুরু করুন')}</button>`
              : `<button class="buy" ${this.career.money >= r.unlock ? '' : 'disabled'}>🔒 ${this.t('Buy route permit', 'রুট পারমিট কিনুন')} ${fmt(r.unlock)}</button>`
          }
        </div>`;
      })
      .join('');
    this.show(
      'routes',
      `<h1>${this.t('Choose a route', 'রুট বাছুন')}</h1>${this.wallet()}<div class="route-list">${cards}</div>
       <div class="buttons"><button data-a="back">← ${this.t('Back', 'পিছনে')}</button></div>`,
    );
    this.el.querySelector('[data-a=back]')!.addEventListener('click', () => this.startScreen());
    for (const card of this.el.querySelectorAll<HTMLElement>('.route-card')) {
      const id = card.dataset.id!;
      const route = routes.find((r) => r.id === id)!;
      for (const b of card.querySelectorAll<HTMLButtonElement>('[data-dir]'))
        b.addEventListener('click', () => {
          dirs.set(id, Number(b.dataset.dir) as 0 | 1);
          for (const o of card.querySelectorAll('[data-dir]')) o.classList.toggle('on', o === b);
        });
      card.querySelector('.go')?.addEventListener('click', () => this.h.startRoute(route, dirs.get(id) ?? 0));
      card.querySelector('.buy')?.addEventListener('click', () => {
        if (this.career.money < route.unlock) return;
        this.career.money -= route.unlock;
        this.career.unlocked.push(route.id);
        saveCareer(this.career);
        this.routePicker();
      });
    }
  }

  results(r: RunResult, net: number) {
    const row = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${v}</td></tr>`;
    this.show(
      'results',
      `<h1>${this.t('Route complete!', 'রুট শেষ!')}</h1>
      <div class="big-stars">${stars(r.stars)}</div>
      <table>
        ${row(this.t('Passengers carried', 'যাত্রী পরিবহন'), String(r.passengers))}
        ${row(this.t('Fares collected', 'ভাড়া আদায়'), fmt(r.fares))}
        ${row(this.t('On-time bonus', 'সময়মতো বোনাস'), r.onTime ? fmt(r.timeBonus) : this.t('late', 'দেরি'), r.onTime ? 'good' : 'bad')}
        ${row(this.t('Fines', 'জরিমানা'), r.fines ? `−${fmt(r.fines)}` : fmt(0), r.fines ? 'bad' : '')}
        ${row(this.t('Net earnings', 'নিট আয়'), fmt(net), net >= 0 ? 'good total' : 'bad total')}
        ${row(this.t('Satisfaction', 'সন্তুষ্টি'), `${r.satisfaction}%`)}
        ${row(this.t('Missed stops', 'বাদ পড়া স্টপ'), String(r.missed), r.missed ? 'bad' : '')}
        ${row(this.t('Passengers left behind', 'রেখে আসা যাত্রী'), String(r.skipped), r.skipped ? 'bad' : '')}
        ${row(this.t('Time', 'সময়'), `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}`)}
        ${row(this.t('Reputation', 'সুনাম'), `${r.reputation >= 0 ? '+' : ''}${r.reputation}`, r.reputation >= 0 ? 'good' : 'bad')}
      </table>
      ${this.wallet()}
      <div class="buttons"><button class="primary" data-a="routes">${this.t('Next route', 'পরের রুট')}</button><button data-a="free">${this.t('Free roam', 'মুক্তভাবে ঘুরুন')}</button></div>`,
    );
    this.el.querySelector('[data-a=routes]')!.addEventListener('click', () => this.h.career());
    this.el.querySelector('[data-a=free]')!.addEventListener('click', () => this.h.freeRoam());
  }

  pause(inRun: boolean) {
    this.show(
      'pause',
      `<h1>${this.t('Paused', 'বিরতি')}</h1>${this.wallet()}
      <div class="buttons"><button class="primary" data-a="resume">${this.t('Resume', 'চালিয়ে যান')}</button>
      <button data-a="quit">${inRun ? this.t('Abandon route', 'রুট ছেড়ে দিন') : this.t('Main menu', 'মূল মেনু')}</button></div>`,
    );
    this.el.querySelector('[data-a=resume]')!.addEventListener('click', () => this.h.resume());
    this.el.querySelector('[data-a=quit]')!.addEventListener('click', () => this.h.quitToMenu());
  }
}
