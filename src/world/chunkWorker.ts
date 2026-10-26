// Web Worker: fetch + inflate + tessellate chunks off the main thread.
import { buildChunk, type BuiltChunk } from './buildChunk';

export type WorkerRequest = { id: number; url: string };
export type WorkerResponse = { id: number; chunk?: BuiltChunk; error?: string; ms?: number };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, url } = e.data;
  const t0 = performance.now();
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
    const raw = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const chunk = buildChunk(raw);
    const transfer: ArrayBuffer[] = [];
    for (const m of Object.values(chunk.layers)) {
      if (!m) continue;
      transfer.push(m.pos.buffer as ArrayBuffer, m.idx.buffer as ArrayBuffer);
      if (m.col) transfer.push(m.col.buffer as ArrayBuffer);
      if (m.ext) transfer.push(m.ext.buffer as ArrayBuffer);
    }
    (self as unknown as Worker).postMessage({ id, chunk, ms: performance.now() - t0 } satisfies WorkerResponse, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies WorkerResponse);
  }
};
