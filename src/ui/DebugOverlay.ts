/** F3 debug overlay: fps, chunks, entities, coordinates. */
export class DebugOverlay {
  private el = document.getElementById('debug')!;
  private frames = 0;
  private last = performance.now();
  fps = 0;
  visible = !matchMedia("(pointer: coarse)").matches;

  constructor() {
    this.el.hidden = !this.visible;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        this.visible = !this.visible;
        this.el.hidden = !this.visible;
      }
    });
  }

  tick(lines: () => string[]) {
    this.frames++;
    const now = performance.now();
    if (now - this.last >= 500) {
      this.fps = (this.frames * 1000) / (now - this.last);
      this.frames = 0;
      this.last = now;
      if (this.visible) this.el.textContent = [`FPS ${this.fps.toFixed(0)}`, ...lines()].join('\n');
    }
  }
}
