import { Application, isWebGLSupported } from 'pixi.js';
import { Camera } from './game/Camera';
import { World } from './world/World';
import { DebugOverlay } from './ui/DebugOverlay';
import { MapView } from './ui/MapView';
import { Hud } from './ui/Hud';
import { Labels } from './render/Labels';
import { BusSprite, LIVERIES } from './render/BusSprite';
import { loadSettings, PRESETS, saveSettings } from './game/Settings';
import { CollisionWorld } from './game/CollisionWorld';
import { Bus } from './game/Bus';
import { BUSES } from './game/BusPhysics';
import { Input } from './game/Input';
import { AudioEngine, HORN_STYLES } from './audio/AudioEngine';
import { BACKGROUND } from './render/palette';
import { Clock, WEEKDAYS, WEEKDAYS_BN } from './game/Clock';
import { decodeGraph } from './shared/graph';
import { Router } from './game/Router';
import { Signals } from './game/traffic/Signals';
import { Traffic, type Obstacle } from './game/traffic/Traffic';
import { Pedestrians } from './game/traffic/Pedestrians';
import { buildAtlas } from './render/TrafficArt';
import { TrafficView } from './render/TrafficView';
import { Rules } from './game/Rules';
import { obbCorners, satPolygons } from './game/CollisionWorld';
import { RouteRun } from './game/career/RouteRun';
import { applyRun, loadCareer } from './game/career/Career';
import { Menu } from './ui/Menu';
import { RunHud } from './ui/RunHud';
import { RouteView } from './render/RouteView';
import { Announcer } from './audio/Announcer';
import type { RouteData } from './shared/routes';
import type { TrafficAtlas } from './render/TrafficArt';
import { project, unproject } from './shared/geo';
import type { WorldIndex } from './shared/format';

const PHYS_DT = 1 / 120;

class StartupError extends Error {}

/** Replace the loading screen text with a (bilingual) explanation. */
function showStartupError(en: string, bn: string) {
  const el = document.getElementById('loading-text')!;
  el.innerHTML = '';
  for (const t of [en, bn]) {
    const p = document.createElement('p');
    p.textContent = t;
    el.appendChild(p);
  }
  el.classList.add('error');
}

async function boot() {
  // the map is drawn with custom WebGL shaders: there is no canvas-only fallback
  if (!isWebGLSupported()) {
    showStartupError(
      "Your browser or device doesn't support WebGL, which this game needs. Try turning on hardware acceleration in your browser settings, or use an up-to-date Chrome or Firefox.",
      'আপনার ব্রাউজার বা ডিভাইস WebGL সমর্থন করে না, যা এই গেমের জন্য প্রয়োজন। ব্রাউজারের সেটিংসে হার্ডওয়্যার অ্যাক্সিলারেশন চালু করুন, অথবা Chrome বা Firefox-এর নতুন সংস্করণ ব্যবহার করুন।',
    );
    return;
  }
  // labels need the Bangla/Latin web fonts before the first Text is rasterised
  await Promise.race([
    Promise.all([document.fonts.load("600 12px 'Noto Sans'"), document.fonts.load("600 12px 'Noto Sans Bengali'", 'ঢাকা')]),
    new Promise((r) => setTimeout(r, 3000)),
  ]).catch(() => {});
  const index = (await fetch('data/index.json')
    .then((r) => r.json())
    .catch(() => {
      throw new StartupError('map data missing');
    })) as WorldIndex;
  const settings = loadSettings();
  const preset = PRESETS[settings.quality];
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: BACKGROUND,
    antialias: preset.antialias,
    preference: 'webgl',
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, preset.maxResolution),
  });
  document.getElementById('app')!.appendChild(app.canvas);

  const world = new World(index);
  world.shadows = preset.shadows;
  app.stage.addChild(world.root);
  const cam = new Camera();
  cam.zoom = 4.5;
  const labels = new Labels();
  labels.maxLabels = preset.maxLabels;
  labels.lang = settings.lang;
  app.stage.addChild(labels.container);
  const collision = new CollisionWorld();
  world.onChunkReady = (e) => {
    labels.addChunk(e);
    if (e.lod === 0 && e.built?.collision) collision.add(e.key, e.cx, e.cy, e.size, e.built.collision);
  };
  world.onChunkRemoved = (e) => {
    labels.removeChunk(e);
    if (e.lod === 0) collision.remove(e.key);
  };
  const map = new MapView(app, world, cam);
  map.lang = settings.lang;
  app.stage.addChild(map.mini, map.full);
  const clock = new Clock(0, 8, 30); // Sunday 8:30 — the morning rush
  const rules = new Rules();
  // ---- traffic: road graph loads in the background; the city fills up once it arrives
  interface Sim {
    traffic: Traffic;
    peds: Pedestrians;
    signals: Signals;
    router: Router;
    view: TrafficView;
  }
  let sim: Sim | null = null;
  let atlas: TrafficAtlas | null = null;
  const routeView = new RouteView(world, map, null);
  let routes: RouteData[] = [];
  fetch('data/routes.json')
    .then((r) => r.json())
    .then((r: RouteData[]) => (routes = r))
    .catch((e) => console.error('routes missing', e));
  const career = loadCareer();
  const announcer = new Announcer();
  announcer.lang = settings.lang;
  const runHud = new RunHud();
  runHud.lang = settings.lang;
  let mode: 'menu' | 'free' | 'run' = 'menu';
  let run: RouteRun | null = null;
  let paused = false;
  let runFinesStart = 0;
  let resultsTimer = -1;
  let conductorStop = -1;
  let prevSpeed = 0;
  let prevHeading = 0;
  let feltAccel = 0;
  let feltLateral = 0;
  // Dhaka's notorious jam hotspots: denser traffic that builds and clears over time
  const HOTSPOTS = [
    [23.7577, 90.3897],
    [23.778, 90.4005],
    [23.7239, 90.4126],
    [23.7105, 90.4345],
    [23.7383, 90.3958],
  ].map(([la, lo]) => project(lo, la));
  (async () => {
    const res = await fetch('data/graph.dgz');
    if (!res.ok || !res.body) throw new Error('graph.dgz missing');
    const raw = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const g = decodeGraph(raw);
    const signals = new Signals(g);
    const traffic = new Traffic(g, signals);
    traffic.hotspot = (x, y) => {
      let w = 0;
      HOTSPOTS.forEach(([hx, hy], i) => {
        const d = Math.hypot(x - hx, y - hy);
        if (d < 1500) w += Math.exp(-((d / 700) ** 2)) * (0.6 + 0.4 * Math.sin(traffic.time / 240 + i * 1.7));
      });
      return Math.min(1.5, w * 1.2);
    };
    const peds = new Pedestrians(g, traffic);
    atlas = buildAtlas(app.renderer);
    routeView.setAtlas(atlas);
    const view = new TrafficView(world, atlas);
    sim = { traffic, peds, signals, router: new Router(g), view };
    Object.assign((window as unknown as { __game: object }).__game, { sim });
  })().catch((e) => console.error('traffic disabled:', e));
  const hitCooldown = new Map<number, number>();
  const hud = new Hud();
  hud.lang = settings.lang;
  const obstacles: Obstacle[] = [];
  const audio = new AudioEngine();
  const input = new Input(settings.steer, (m) => {
    settings.steer = m;
    saveSettings(settings);
  });

  // ---- the player's bus
  const bus = new Bus(BUSES.local);
  const sprite = new BusSprite(bus.spec.length, bus.spec.width, LIVERIES.green);
  world.entities.addChild(sprite.root);
  world.top.addChild(sprite.ghost);
  // spawn at Shahbag (or #lat,lon,zoom) and snap onto the nearest road once its chunk loads
  const [lat, lon, z] = (location.hash.slice(1) || '23.7383,90.3958').split(',').map(Number);
  const [sx, sy] = project(lon, lat);
  bus.phys.placeCentre(sx, sy, -Math.PI / 2);
  let pendingSnap: { x: number; y: number; h?: number } | null = { x: sx, y: sy };
  cam.x = sx;
  cam.y = sy;
  if (z) cam.zoom = z;
  map.onJump = (x, y) => {
    bus.phys.placeCentre(x, y, bus.phys.heading);
    pendingSnap = { x, y };
    cam.x = x;
    cam.y = y;
    follow = true;
  };

  // ---- camera: follow with look-ahead; dragging detaches it until the player drives again
  let follow = true;
  let rotateMode = false;
  const canvas = app.canvas;
  const pointers = new Map<number, { x: number; y: number }>();
  let mouse = { x: 0, y: 0 };
  const gesture = () => {
    const p = [...pointers.values()];
    if (p.length === 1) return { x: p[0].x, y: p[0].y, d: 0 };
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    audio.start();
    if (map.isOpen) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    if (!pointers.has(e.pointerId) || map.isOpen) return;
    const before = gesture();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = gesture();
    if (before.d > 0 && after.d > 0) cam.zoomAt(cam.width / 2, cam.height / 2, after.d / before.d);
    else {
      const [ax, ay] = cam.screenToWorld(before.x, before.y);
      const [bx, by] = cam.screenToWorld(after.x, after.y);
      if (Math.hypot(after.x - before.x, after.y - before.y) > 0.5) {
        follow = false;
        input.drivingInput = false;
      }
      cam.x += ax - bx;
      cam.y += ay - by;
    }
  });
  const release = (e: PointerEvent) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (map.isOpen) return;
      // zoom around the screen centre while following, around the cursor in free camera
      const [zx, zy] = follow ? [cam.width / 2, cam.height / 2] : [e.clientX, e.clientY];
      cam.zoomAt(zx, zy, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  const toggleLang = () => {
    labels.lang = map.lang = hud.lang = runHud.lang = menu.lang = announcer.lang = settings.lang = labels.lang === 'en' ? 'bn' : 'en';
    saveSettings(settings);
    // re-render an open menu in the new language
    if (menu.open === 'start') menu.startScreen();
    else if (menu.open === 'routes') menu.routePicker();
  };

  // ---- game modes: menu / free roam / route run
  const endRun = () => {
    run = null;
    routeView.setRun(null);
    runHud.show(false);
  };
  const menu = new Menu(career, () => routes, {
    career: () => menu.routePicker(),
    freeRoam: () => {
      menu.close();
      endRun();
      mode = 'free';
      paused = false;
    },
    startRoute: (route, dir) => {
      menu.close();
      paused = false;
      mode = 'run';
      run = new RouteRun(route, dir, clock.density());
      routeView.setRun(run);
      runHud.show(true);
      // park just before the first stop, facing along the route; snap to the left lane on load
      const [x, y, tx, ty] = run.pointAt(Math.max(0, run.stops[0].s - 30));
      bus.phys.placeCentre(x, y, Math.atan2(ty, tx));
      pendingSnap = { x, y, h: Math.atan2(ty, tx) };
      cam.x = x;
      cam.y = y;
      follow = true;
      bus.doorsOpen = false;
      sprite.setDoors(false);
      runFinesStart = bus.fines;
      conductorStop = -1;
      resultsTimer = -1;
      const first = run.stops[0];
      runHud.flash(settings.lang === 'bn' ? `${first.nameBn} স্টপে যাত্রী তুলুন — দরজা খুলুন` : `Pick up passengers at ${first.name} — open the doors`, 8);
    },
    resume: () => {
      menu.close();
      paused = false;
    },
    quitToMenu: () => {
      endRun();
      paused = false;
      mode = 'menu';
      menu.startScreen();
    },
  });
  menu.lang = settings.lang;
  const togglePause = () => {
    if (mode === 'menu') return;
    if (menu.open === 'pause') {
      menu.close();
      paused = false;
    } else if (!menu.open) {
      paused = true;
      menu.pause(mode === 'run');
    }
  };
  // on-screen buttons (also handy with a mouse)
  const buttons = document.createElement('div');
  buttons.id = 'touch-buttons';
  buttons.innerHTML = '<button data-a="map">🗺 Map</button><button data-a="lang">বাং / EN</button>';
  // phones: fullscreen hides the browser bars (most of a landscape screen's height)
  if (matchMedia('(pointer: coarse)').matches && document.fullscreenEnabled)
    buttons.insertAdjacentHTML('beforeend', '<button data-a="fullscreen" title="Fullscreen">⤢</button>');
  buttons.addEventListener('click', (e) => {
    audio.start();
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'map') map.toggle();
    if (a === 'lang') toggleLang();
    if (a === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else
        document.documentElement
          .requestFullscreen({ navigationUI: 'hide' })
          .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
          .catch(() => {});
    }
  });
  document.body.appendChild(buttons);
  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
    audio.start();
    held.add(e.key);
    if (e.key === 'Escape') {
      if (map.isOpen) map.toggle(false);
      else togglePause();
    }
    if (e.key === 'p' || e.key === 'P') togglePause();
    if (e.key === 'Tab') {
      e.preventDefault();
      if (run) runHud.toggleList();
    }
    // Shift+H cycles horn style (garage upgrade later)
    if (e.key === 'H') {
      audio.hornStyle = HORN_STYLES[(HORN_STYLES.indexOf(audio.hornStyle) + 1) % HORN_STYLES.length];
      hud.toast(`Horn: ${audio.hornStyle}`);
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.key));
  window.addEventListener('blur', () => held.clear());

  const debug = new DebugOverlay();
  const loadingEl = document.getElementById('loading')!;
  let firstLoad = true;
  /** 0..1: how see-through overhead structures around the bus are */
  let xray = 0;
  let acc = 0;

  app.ticker.add((t) => {
    const dt = Math.min(0.1, t.deltaMS / 1000);
    input.enabled = !map.isOpen && !paused && !menu.open;
    input.update(dt);
    for (const a of input.actions()) {
      if (a === 'map') map.toggle();
      else if (a === 'lang') toggleLang();
      else if (a === 'labels') labels.enabled = !labels.enabled;
      else if (a === 'camera') {
        rotateMode = !rotateMode;
        map.rotateWithCamera = true;
        hud.toast(rotateMode ? 'Camera: rotate with bus' : 'Camera: north up');
      } else if (a === 'lights') {
        bus.headlights = !bus.headlights;
        audio.click();
      } else if (a === 'doors') {
        bus.doorsOpen = !bus.doorsOpen;
        sprite.setDoors(bus.doorsOpen);
        audio.doors();
        if (bus.doorsOpen && bus.phys.kmh > 3) hud.toast('Doors opened while moving!', 'bad');
      } else if (a === 'reset') {
        if (bus.resetToRoad(collision)) {
          follow = true;
          sprite.update(bus.phys.cx, bus.phys.cy, bus.phys.heading);
        } else hud.toast('No road nearby yet');
      }
    }
    if (held.has('+') || held.has('=')) cam.zoomAt(cam.width / 2, cam.height / 2, Math.exp(dt * 1.5));
    if (held.has('-')) cam.zoomAt(cam.width / 2, cam.height / 2, Math.exp(-dt * 1.5));

    // ---- physics at a fixed step (waits for the spawn road to load)
    if (pendingSnap && collision.has(pendingSnap.x, pendingSnap.y)) {
      if (bus.snapToRoad(collision, pendingSnap.x, pendingSnap.y, 600, pendingSnap.h)) pendingSnap = null;
    }
    if (!pendingSnap && !paused) {
      acc += dt;
      while (acc >= PHYS_DT) {
        bus.step(PHYS_DT, input.controls, collision);
        acc -= PHYS_DT;
      }
    }
    // ---- traffic, pedestrians, rules
    if (!paused) clock.tick(dt);
    let frameImpact = 0;
    if (sim && !pendingSnap && !paused) {
      const p0 = bus.phys;
      const density = clock.density() * preset.traffic;
      obstacles.length = 0;
      obstacles.push({ x: p0.cx, y: p0.cy, h: p0.heading, hl: p0.spec.length / 2, hw: p0.spec.width / 2, vx: p0.vx, vy: p0.vy });
      sim.peds.obstacles(obstacles);
      const vr = Math.hypot(cam.width, cam.height) / 2 / cam.zoom;
      sim.traffic.update(dt, { x: p0.cx, y: p0.cy }, obstacles, density, clock.truckShare(), vr);
      sim.peds.update(dt, { x: p0.cx, y: p0.cy, vx: p0.vx, vy: p0.vy, heading: p0.heading, hl: p0.spec.length / 2, hw: p0.spec.width / 2 }, density);
      // bus vs road users: SAT boxes, momentum shared by mass
      const corners = obbCorners(p0.obb());
      for (const v of sim.traffic.query(p0.cx, p0.cy, 16)) {
        if (v.level !== bus.level) continue;
        const vc = obbCorners({ cx: v.x, cy: v.y, hl: v.spec.length / 2, hw: v.spec.width / 2, fx: Math.cos(v.heading), fy: Math.sin(v.heading) });
        const c = satPolygons(corners, vc);
        if (!c) continue;
        const M = p0.spec.mass;
        const busShare = v.spec.mass / (v.spec.mass + M);
        const rel = (p0.vx - Math.cos(v.heading) * v.v) * c.nx + (p0.vy - Math.sin(v.heading) * v.v) * c.ny;
        p0.x += c.nx * c.depth * busShare;
        p0.y += c.ny * c.depth * busShare;
        if (rel < 0) {
          p0.vx -= 1.1 * rel * busShare * c.nx;
          p0.vy -= 1.1 * rel * busShare * c.ny;
        }
        sim.traffic.shove(v, -c.nx, -c.ny, c.depth * (1 - busShare) + 0.05);
        const impact = -rel;
        // only the bus driver's fault (and fine) if the bus was actually moving
        if (impact > 1 && Math.abs(p0.speed) > 1 && sim.traffic.time - (hitCooldown.get(v.id) ?? -9) > 2) {
          hitCooldown.set(v.id, sim.traffic.time);
          const lf = -c.nx * p0.fx - c.ny * p0.fy;
          const lr = -c.nx * -p0.fy - c.ny * p0.fx;
          const t = Math.min((p0.spec.length / 2) / Math.max(1e-3, Math.abs(lf)), (p0.spec.width / 2) / Math.max(1e-3, Math.abs(lr)));
          bus.hitRoadUser(impact, v.spec.mass, v.spec.type, [lf * t, lr * t]);
        }
      }
      for (const ped of sim.peds.hits) {
        bus.fines += 5000;
        hud.toast(settings.lang === 'bn' ? 'পথচারীকে ধাক্কা! জরিমানা ৳5,000' : 'You hit a pedestrian! Fine ৳5,000', 'bad');
        audio.crash(3);
        void ped;
      }
      for (const vio of rules.update(dt, bus, collision, sim.signals, sim.traffic.time)) {
        bus.fines += vio.fine;
        const msg =
          vio.kind === 'red-light'
            ? settings.lang === 'bn' ? `লাল বাতি অমান্য — জরিমানা ৳${vio.fine}` : `Ran a red light — fine ৳${vio.fine}`
            : settings.lang === 'bn' ? `উল্টো পথে — জরিমানা ৳${vio.fine}` : `Wrong way on a one-way street — fine ৳${vio.fine}`;
        hud.toast(msg, 'bad');
      }
      for (const h of sim.traffic.events.honks) audio.ambientHorn(Math.hypot(h.x - cam.x, h.y - cam.y), h.type);
    }
    hud.setClock(clock.label, (settings.lang === 'bn' ? WEEKDAYS_BN : WEEKDAYS)[clock.day], rules.wrongWay);

    for (const ev of bus.events) {
      if (ev.type === 'crash') {
        frameImpact = Math.max(frameImpact, ev.impact!);
        audio.crash(ev.impact!);
        if (ev.local) sprite.addDent(ev.local[0], ev.local[1], ev.level ?? 0.5);
        const what = ev.what ? ` with a ${ev.what === 'cng' ? 'CNG' : ev.what}` : '';
        hud.toast(`Collision${what} at ${Math.round(ev.impact! * 3.6)} km/h — fine ৳${ev.fine}`, 'bad');
      } else if (ev.type === 'reset') hud.toast(`Back on the road — fine ৳${ev.fine}`, 'bad');
    }
    bus.events.length = 0;

    // ---- the route run: passengers feel the bus's acceleration
    {
      const pp = bus.phys;
      if (dt > 0 && !paused) {
        let dh = pp.heading - prevHeading;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        const k = 1 - Math.exp(-dt * 6);
        feltAccel += ((pp.speed - prevSpeed) / dt - feltAccel) * k;
        feltLateral += ((pp.speed * dh) / dt - feltLateral) * k;
      }
      prevSpeed = pp.speed;
      prevHeading = pp.heading;
    }
    if (run && !paused && !pendingSnap) {
      const pp = bus.phys;
      run.update(dt, { x: pp.cx, y: pp.cy, speed: pp.speed, accel: feltAccel, lateral: feltLateral, doorsOpen: bus.doorsOpen, impact: frameImpact }, pp.spec.length / 2 - 1.6);
      const bn = settings.lang === 'bn';
      for (const ev of run.events) {
        const st = ev.stop !== undefined ? run.stops[ev.stop] : null;
        const nm = st ? (bn ? st.nameBn : st.name) : '';
        if (ev.type === 'approach') {
          announcer.nextStop(st!.name, st!.nameBn);
          runHud.flash(bn ? `সামনে ${nm} — হলুদ বক্সে থামুন` : `${nm} ahead — stop in the yellow box`, 5);
        } else if (ev.type === 'arrived') {
          const acc = Math.round(run.accuracy);
          runHud.flash(acc < 5 ? (bn ? `চমৎকার থামানো! (${acc} মি)` : `Perfect stop! (${acc} m)`) : bn ? `থেমেছেন — ${acc} মি দূরে` : `Stopped ${acc} m from the stop`, 3);
        } else if (ev.type === 'doors-needed') {
          const touch = matchMedia('(pointer: coarse)').matches;
          runHud.flash(bn ? `দরজা খুলুন — ${touch ? '🚪 চাপুন' : 'E চাপুন'}` : `Open the doors — ${touch ? 'tap 🚪' : 'press E'}`, 0.3);
        }
        else if ((ev.type === 'board' || ev.type === 'alight') && conductorStop !== ev.stop) {
          conductorStop = ev.stop!;
          const onward = run.stops.slice(ev.stop! + 1).map((s2) => [s2.name, s2.nameBn] as [string, string]);
          if (ev.stop === run.stops.length - 1) announcer.terminus(st!.name, st!.nameBn);
          else announcer.conductor(st!.name, st!.nameBn, onward);
        } else if (ev.type === 'full') runHud.flash(bn ? 'বাস ভর্তি!' : 'Bus is full!', 1);
        else if (ev.type === 'skipped') hud.toast(bn ? `${ev.count} জন যাত্রীকে ফেলে গেলেন` : `Left ${ev.count} passengers behind`, 'bad');
        else if (ev.type === 'missed') hud.toast(bn ? `${nm} স্টপ বাদ পড়ল!` : `Missed the ${nm} stop!`, 'bad');
        else if (ev.type === 'late') hud.toast(bn ? 'দেরি হয়ে যাচ্ছে!' : 'Running late!', 'bad');
        else if (ev.type === 'off-route') runHud.flash(bn ? 'আপনি রুটের বাইরে' : 'You left the route', 3);
        else if (ev.type === 'finished') resultsTimer = 2.5;
      }
      if (resultsTimer > 0) {
        resultsTimer -= dt;
        if (resultsTimer <= 0) {
          const res = run.result(bus.fines - runFinesStart);
          const net = applyRun(career, run.route.id, res);
          endRun();
          mode = 'menu';
          menu.results(res, net);
        }
      }
    }
    if (run) {
      let bearing: number | null = null;
      if (run.offRoute > 45) {
        const [rx, ry] = run.pointAt(run.s);
        bearing = Math.atan2(ry - bus.phys.cy, rx - bus.phys.cx);
      }
      runHud.update(run, { avgSpeed: Math.max(4, Math.abs(bus.phys.speed)), bearingToRoute: bearing, screenRot: cam.rotation });
      routeView.update(performance.now() / 1000);
    }

    // sprite on the ground or above the flyover deck
    const parent = bus.level > 0 ? world.entitiesElevated : world.entities;
    if (sprite.root.parent !== parent) parent.addChild(sprite.root);
    sprite.ghost.visible = collision.covered(bus.phys.cx, bus.phys.cy, bus.level);
    if (sprite.ghost.visible && sprite.ghost.parent !== world.top) world.top.addChild(sprite.ghost);
    const p = bus.phys;
    sprite.update(p.cx, p.cy, p.heading, 0.42, 0.55, bus.level > 0 ? 3.2 + bus.level * 4.5 : 3.2);
    sprite.setLights(bus.headlights, input.controls.brake > 0.1 && p.gear !== -1, p.gear === -1);

    // camera
    if (input.drivingInput) follow = true;
    if (follow) {
      const look = Math.min(1.2, 30 / Math.max(1, Math.hypot(p.vx, p.vy)));
      const tx = p.cx + p.vx * look;
      const ty = p.cy + p.vy * look;
      const k = 1 - Math.exp(-dt * 4);
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
    }
    const targetRot = rotateMode ? p.heading + Math.PI / 2 : 0;
    let dr = targetRot - cam.rotation;
    while (dr > Math.PI) dr -= 2 * Math.PI;
    while (dr < -Math.PI) dr += 2 * Math.PI;
    cam.rotation += dr * (1 - Math.exp(-dt * 3));
    cam.width = app.screen.width;
    cam.height = app.screen.height;
    cam.apply(world.root);
    // under/near a flyover or the metro viaduct: see through it around the bus. Probe around
    // and ahead of the bus so traffic waiting under the deck shows up before we get there.
    let near = false;
    if (bus.level === 0 && world.lod === 0) {
      const fx = Math.cos(p.heading);
      const fy = Math.sin(p.heading);
      for (const [f, s2] of [[0, 0], [18, 0], [34, 0], [-14, 0], [8, 12], [8, -12]]) {
        if (collision.covered(p.cx + fx * f - fy * s2, p.cy + fy * f + fx * s2, 0)) {
          near = true;
          break;
        }
      }
    }
    xray += ((near ? 1 : 0) - xray) * (1 - Math.exp(-dt * 5));
    if (xray < 0.01 && !near) xray = 0;
    const [bsx, bsy] = cam.worldToScreen(p.cx, p.cy);
    world.setXray(bsx, bsy, Math.max(110, 34 * cam.zoom), xray);
    world.update(cam.view(), cam.zoom, { x: p.cx, y: p.cy });
    if (sim) sim.view.sync(sim.traffic, sim.peds, sim.signals, cam.view(10), cam.zoom);
    labels.update(cam);
    map.update();
    hud.update(bus);
    audio.horn(input.horn);
    audio.update(p.rpm, input.controls.throttle, Math.abs(p.speed), input.controls.brake);

    if (firstLoad && world.stats.loaded > 0 && world.loading === 0 && !pendingSnap) {
      firstLoad = false;
      loadingEl.classList.add('done');
      if (new URLSearchParams(location.search).has('free')) mode = 'free';
      else menu.startScreen();
    }
    debug.tick(() => {
      const [blon, blat] = unproject(p.cx, p.cy);
      const [wx, wy] = cam.screenToWorld(mouse.x, mouse.y);
      const [mlon, mlat] = unproject(wx, wy);
      return [
        `quality ${settings.quality}  LOD ${world.lod}  chunks ${world.stats.visible} visible / ${world.stats.loaded} loaded / ${world.loading} loading`,
        `vertices ${(world.stats.vertices / 1e6).toFixed(2)}M  collision chunks ${collision.count}`,
        `zoom ${cam.zoom.toFixed(2)} px/m  ${follow ? 'follow' : 'free'}${rotateMode ? ' rotate' : ''}`,
        `bus ${blat.toFixed(5)}, ${blon.toFixed(5)}  level ${bus.level}  ${bus.onRoad ? 'on road' : 'off road'}`,
        `speed ${p.kmh.toFixed(1)} km/h  gear ${p.gear}  rpm ${Math.round(p.rpm)}  steer ${(p.steerAngle * 57.3).toFixed(0)}°`,
        `traffic ${sim ? sim.traffic.vehicles.length : '…'} vehicles, ${sim ? sim.peds.peds.length : 0} pedestrians  density ${clock.density().toFixed(2)}`,
        `cursor ${mlat.toFixed(5)}, ${mlon.toFixed(5)}`,
      ];
    });
  });

  window.addEventListener('hashchange', () => {
    const [la, lo, zz] = location.hash.slice(1).split(',').map(Number);
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      const [x, y] = project(lo, la);
      map.onJump(x, y);
    }
    if (zz) cam.zoom = zz;
  });
  /** Dev benchmark: per-stage cost of a frame, GPU-synchronised. */
  const bench = (frames = 30) => {
    const gl = (app.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
    const px = new Uint8Array(4);
    const tm = { update: 0, labels: 0, render: 0 };
    for (let i = 0; i < frames; i++) {
      let t0 = performance.now();
      world.update(cam.view(), cam.zoom, { x: bus.phys.cx, y: bus.phys.cy });
      tm.update += performance.now() - t0;
      t0 = performance.now();
      labels.update(cam);
      map.update();
      tm.labels += performance.now() - t0;
      t0 = performance.now();
      app.renderer.render(app.stage);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      tm.render += performance.now() - t0;
    }
    return { update: tm.update / frames, labels: tm.labels / frames, render: tm.render / frames };
  };
  Object.assign(window, {
    __game: { app, world, cam, labels, map, bench, bus, input, collision, clock, sim, menu, career, get run() { return run; }, get routes() { return routes; } },
  });
}

boot().catch((e) => {
  console.error(e);
  if (e instanceof StartupError) {
    showStartupError(`Failed to load the map data. Did you run "npm run data:build"?`, 'মানচিত্রের ডেটা লোড করা যায়নি।');
  } else showStartupError(`Failed to start: ${e}`, 'গেমটি চালু করা যায়নি। পেজটি আবার লোড করে দেখুন।');
});
