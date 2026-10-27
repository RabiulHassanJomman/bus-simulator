import type { Container } from 'pixi.js';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 2D camera: (x, y) world centre in metres, zoom in pixels per metre, rotation in radians. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1.5;
  rotation = 0;
  minZoom = 0.04;
  maxZoom = 12;
  width = 1;
  height = 1;

  apply(world: Container) {
    world.pivot.set(this.x, this.y);
    world.position.set(this.width / 2, this.height / 2);
    world.scale.set(this.zoom);
    world.rotation = -this.rotation;
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const dx = (sx - this.width / 2) / this.zoom;
    const dy = (sy - this.height / 2) / this.zoom;
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    return [this.x + dx * c - dy * s, this.y + dx * s + dy * c];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    const dx = (wx - this.x) * this.zoom;
    const dy = (wy - this.y) * this.zoom;
    const c = Math.cos(-this.rotation);
    const s = Math.sin(-this.rotation);
    return [this.width / 2 + dx * c - dy * s, this.height / 2 + dx * s + dy * c];
  }

  /** Axis-aligned world rect covering the (possibly rotated) screen. */
  view(pad = 0): Rect {
    const hw = this.width / 2 / this.zoom;
    const hh = this.height / 2 / this.zoom;
    const c = Math.abs(Math.cos(this.rotation));
    const s = Math.abs(Math.sin(this.rotation));
    const ex = hw * c + hh * s + pad;
    const ey = hw * s + hh * c + pad;
    return { x0: this.x - ex, y0: this.y - ey, x1: this.x + ex, y1: this.y + ey };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.x += wx - nx;
    this.y += wy - ny;
  }
}
