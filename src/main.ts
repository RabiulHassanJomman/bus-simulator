import { Application } from 'pixi.js';
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
import { project, unproject } from './shared/geo';
import type { WorldIndex } from './shared/format';

const PHYS_DT = 1 / 120;

async function boot() {
  // labels need the Bangla/Latin web fonts before the first Text is rasterised
  await Promise.race([
    Promise.all([document.fonts.load("600 12px 'Noto Sans'"), document.fonts.load("600 12px 'Noto Sans Bengali'", 'ঢাকা')]),
    new Promise((r) => setTimeout(r, 3000)),
  ]).catch(() => {});
  const index = (await (await fetch('data/index.json')).json()) as WorldIndex;
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
  const hud = new Hud();
  hud.lang = settings.lang;
  const audio = new AudioEngine();
  const input = new Input();

  // ---- the player's bus
  const bus = new Bus(BUSES.local);
  const sprite = new BusSprite(bus.spec.length, bus.spec.width, LIVERIES.green);
  world.entities.addChild(sprite.root);
  world.top.addChild(sprite.ghost);
  // spawn at Shahbag (or #lat,lon,zoom) and snap onto the nearest road once its chunk loads
  const [lat, lon, z] = (location.hash.slice(1) || '23.7383,90.3958').split(',').map(Number);
  const [sx, sy] = project(lon, lat);
  bus.phys.placeCentre(sx, sy, -Math.PI / 2);
  let pendingSnap: { x: number; y: number } | null = { x: sx, y: sy };
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
    labels.lang = map.lang = hud.lang = settings.lang = labels.lang === 'en' ? 'bn' : 'en';
    saveSettings(settings);
  };
  // on-screen buttons (also handy with a mouse)
  const buttons = document.createElement('div');
  buttons.id = 'touch-buttons';
  buttons.innerHTML = '<button data-a="map">🗺 Map</button><button data-a="lang">বাং / EN</button>';
  buttons.addEventListener('click', (e) => {
    audio.start();
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'map') map.toggle();
    if (a === 'lang') toggleLang();
  });
  document.body.appendChild(buttons);
  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
    audio.start();
    held.add(e.key);
    if (e.key === 'Escape' && map.isOpen) map.toggle(false);
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
  let acc = 0;

  app.ticker.add((t) => {
    const dt = Math.min(0.1, t.deltaMS / 1000);
    input.enabled = !map.isOpen;
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
      if (bus.snapToRoad(collision, pendingSnap.x, pendingSnap.y, 600)) pendingSnap = null;
    }
    if (!pendingSnap) {
      acc += dt;
      while (acc >= PHYS_DT) {
        bus.step(PHYS_DT, input.controls, collision);
        acc -= PHYS_DT;
      }
    }
    for (const ev of bus.events) {
      if (ev.type === 'crash') {
        audio.crash(ev.impact!);
        if (ev.local) sprite.addDent(ev.local[0], ev.local[1], ev.level ?? 0.5);
        hud.toast(`Collision at ${Math.round(ev.impact! * 3.6)} km/h — fine ৳${ev.fine}`, 'bad');
      } else if (ev.type === 'reset') hud.toast(`Back on the road — fine ৳${ev.fine}`, 'bad');
    }
    bus.events.length = 0;

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
    world.update(cam.view(), cam.zoom, { x: p.cx, y: p.cy });
    labels.update(cam);
    map.update();
    hud.update(bus);
    audio.horn(input.horn);
    audio.update(p.rpm, input.controls.throttle, Math.abs(p.speed), input.controls.brake);

    if (firstLoad && world.stats.loaded > 0 && world.loading === 0 && !pendingSnap) {
      firstLoad = false;
      loadingEl.classList.add('done');
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
  Object.assign(window, { __game: { app, world, cam, labels, map, bench, bus, input, collision } });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loading-text')!.textContent = `Failed to start: ${e}. Did you run "npm run data:build"?`;
});
