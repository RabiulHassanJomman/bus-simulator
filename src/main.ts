import { Application } from 'pixi.js';
import { Camera } from './game/Camera';
import { World } from './world/World';
import { DebugOverlay } from './ui/DebugOverlay';
import { MapView } from './ui/MapView';
import { Labels } from './render/Labels';
import { loadSettings, PRESETS, saveSettings } from './game/Settings';
import { BACKGROUND } from './render/palette';
import { project, unproject } from './shared/geo';
import type { WorldIndex } from './shared/format';

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
  const labels = new Labels();
  labels.maxLabels = preset.maxLabels;
  labels.lang = settings.lang;
  app.stage.addChild(labels.container);
  world.onChunkReady = (e) => labels.addChunk(e);
  world.onChunkRemoved = (e) => labels.removeChunk(e);
  const map = new MapView(app, world, cam);
  map.lang = settings.lang;
  app.stage.addChild(map.mini, map.full);

  // start at Shahbag, or at #lat,lon,zoom from the URL
  const [lat, lon, z] = (location.hash.slice(1) || '23.7383,90.3958,1.2').split(',').map(Number);
  [cam.x, cam.y] = project(lon, lat);
  cam.zoom = z || 1.2;

  // ---- input: drag to pan, wheel to zoom, keyboard pan/zoom/rotate
  const canvas = app.canvas;
  // one pointer pans; two pointers (touch) pinch-zoom and pan around their midpoint
  const pointers = new Map<number, { x: number; y: number }>();
  let mouse = { x: 0, y: 0 };
  const gesture = () => {
    const p = [...pointers.values()];
    if (p.length === 1) return { x: p[0].x, y: p[0].y, d: 0 };
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
  };
  canvas.addEventListener('pointerdown', (e) => {
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
    if (before.d > 0 && after.d > 0) cam.zoomAt(before.x, before.y, after.d / before.d);
    const [ax, ay] = cam.screenToWorld(before.x, before.y);
    const [bx, by] = cam.screenToWorld(after.x, after.y);
    cam.x += ax - bx;
    cam.y += ay - by;
  });
  const release = (e: PointerEvent) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (map.isOpen) return;
      cam.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  const keys = new Set<string>();
  const toggleLang = () => {
    labels.lang = map.lang = settings.lang = labels.lang === 'en' ? 'bn' : 'en';
    saveSettings(settings);
  };
  // on-screen buttons for touch devices (no keyboard)
  const buttons = document.createElement('div');
  buttons.id = 'touch-buttons';
  buttons.innerHTML = '<button data-a="map">🗺 Map</button><button data-a="lang">বাং / EN</button>';
  buttons.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'map') map.toggle();
    if (a === 'lang') toggleLang();
  });
  document.body.appendChild(buttons);
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'm') map.toggle();
    if (k === 'escape' && map.isOpen) map.toggle(false);
    if (k === 'b') toggleLang();
    if (k === 'n') labels.enabled = !labels.enabled;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const debug = new DebugOverlay();
  const loadingEl = document.getElementById('loading')!;
  let firstLoad = true;

  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    if (map.isOpen) keys.clear();
    const pan = (600 / cam.zoom) * dt;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= pan;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += pan;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
    if (keys.has('d') || keys.has('arrowright')) cam.x += pan;
    if (keys.has('+') || keys.has('=')) cam.zoomAt(cam.width / 2, cam.height / 2, Math.exp(dt * 1.5));
    if (keys.has('-')) cam.zoomAt(cam.width / 2, cam.height / 2, Math.exp(-dt * 1.5));
    if (keys.has('q')) cam.rotation -= dt;
    if (keys.has('e')) cam.rotation += dt;
    cam.width = app.screen.width;
    cam.height = app.screen.height;
    cam.apply(world.root);
    world.update(cam.view(), cam.zoom);
    labels.update(cam);
    map.update();

    if (firstLoad && world.stats.loaded > 0 && world.loading === 0) {
      firstLoad = false;
      loadingEl.classList.add('done');
    }
    debug.tick(() => {
      const [clon, clat] = unproject(cam.x, cam.y);
      const [wx, wy] = cam.screenToWorld(mouse.x, mouse.y);
      const [mlon, mlat] = unproject(wx, wy);
      return [
        `quality ${settings.quality}  LOD ${world.lod}  chunks ${world.stats.visible} visible / ${world.stats.loaded} loaded / ${world.loading} loading`,
        `vertices ${(world.stats.vertices / 1e6).toFixed(2)}M`,
        `zoom ${cam.zoom.toFixed(2)} px/m`,
        `centre ${clat.toFixed(5)}, ${clon.toFixed(5)}`,
        `cursor ${mlat.toFixed(5)}, ${mlon.toFixed(5)}`,
      ];
    });
  });

  window.addEventListener('hashchange', () => {
    const [la, lo, zz] = location.hash.slice(1).split(',').map(Number);
    if (Number.isFinite(la) && Number.isFinite(lo)) [cam.x, cam.y] = project(lo, la);
    if (zz) cam.zoom = zz;
  });
  /** Dev benchmark: per-stage cost of a frame, GPU-synchronised. */
  const bench = (frames = 30) => {
    const gl = (app.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
    const px = new Uint8Array(4);
    const t = { update: 0, labels: 0, render: 0 };
    for (let i = 0; i < frames; i++) {
      let t0 = performance.now();
      world.update(cam.view(), cam.zoom);
      t.update += performance.now() - t0;
      t0 = performance.now();
      labels.update(cam);
      map.update();
      t.labels += performance.now() - t0;
      t0 = performance.now();
      app.renderer.render(app.stage);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      t.render += performance.now() - t0;
    }
    return { update: t.update / frames, labels: t.labels / frames, render: t.render / frames };
  };
  Object.assign(window, { __game: { app, world, cam, labels, map, bench } });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loading-text')!.textContent = `Failed to start: ${e}. Did you run "npm run data:build"?`;
});
