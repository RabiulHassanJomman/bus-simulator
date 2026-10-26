import { Application } from 'pixi.js';
import { Camera } from './game/Camera';
import { World } from './world/World';
import { DebugOverlay } from './ui/DebugOverlay';
import { BACKGROUND } from './render/palette';
import { project, unproject } from './shared/geo';
import type { WorldIndex } from './shared/format';

async function boot() {
  const index = (await (await fetch('data/index.json')).json()) as WorldIndex;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: BACKGROUND,
    antialias: true,
    preference: 'webgl',
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById('app')!.appendChild(app.canvas);

  const world = new World(index);
  app.stage.addChild(world.root);
  const cam = new Camera();

  // start at Shahbag, or at #lat,lon,zoom from the URL
  const [lat, lon, z] = (location.hash.slice(1) || '23.7383,90.3958,1.2').split(',').map(Number);
  [cam.x, cam.y] = project(lon, lat);
  cam.zoom = z || 1.2;

  // ---- input: drag to pan, wheel to zoom, keyboard pan/zoom/rotate
  const canvas = app.canvas;
  let drag: { x: number; y: number } | null = null;
  let mouse = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    if (!drag) return;
    const [ax, ay] = cam.screenToWorld(drag.x, drag.y);
    const [bx, by] = cam.screenToWorld(e.clientX, e.clientY);
    cam.x += ax - bx;
    cam.y += ay - by;
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const debug = new DebugOverlay();
  const loadingEl = document.getElementById('loading')!;
  let firstLoad = true;

  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
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
    world.update(cam.view());

    if (firstLoad && world.stats.loaded > 0 && world.loading === 0) {
      firstLoad = false;
      loadingEl.classList.add('done');
    }
    debug.tick(() => {
      const [clon, clat] = unproject(cam.x, cam.y);
      const [wx, wy] = cam.screenToWorld(mouse.x, mouse.y);
      const [mlon, mlat] = unproject(wx, wy);
      return [
        `chunks ${world.stats.visible} visible / ${world.stats.loaded} loaded / ${world.loading} loading`,
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
  Object.assign(window, { __game: { app, world, cam } });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loading-text')!.textContent = `Failed to start: ${e}. Did you run "npm run data:build"?`;
});
