import type { BuiltChunk } from './buildChunk';
import type { WorkerRequest, WorkerResponse } from './chunkWorker';

/** Small pool of chunk workers with a promise-based request API. */
export class WorkerPool {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private nextId = 1;
  private pending = new Map<number, { resolve: (c: BuiltChunk) => void; reject: (e: Error) => void; w: number }>();

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        this.busy[p.w]--;
        if (e.data.chunk) p.resolve(e.data.chunk);
        else p.reject(new Error(e.data.error ?? 'worker error'));
      };
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get inFlight() {
    return this.pending.size;
  }

  load(url: string): Promise<BuiltChunk> {
    let w = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.busy[i] < this.busy[w]) w = i;
    const id = this.nextId++;
    this.busy[w]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, w });
      this.workers[w].postMessage({ id, url: new URL(url, location.href).href } satisfies WorkerRequest);
    });
  }
}
