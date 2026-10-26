// Assemble closed rings from multipolygon member ways (node id sequences).

/**
 * Join way node-id sequences end-to-end into rings. Unclosable chains are
 * force-closed if `forceClose` (their gaps are normally outside the extract).
 */
export function assembleRings(ways: number[][], forceClose = true): number[][] {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings: number[][] = [];
  while (pool.length) {
    let cur = pool.pop()!;
    let progress = true;
    while (cur[0] !== cur[cur.length - 1] && progress) {
      progress = false;
      const head = cur[0];
      const tail = cur[cur.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const a = w[0];
        const b = w[w.length - 1];
        if (a === tail) cur = cur.concat(w.slice(1));
        else if (b === tail) cur = cur.concat(w.slice(0, -1).reverse());
        else if (b === head) cur = w.concat(cur.slice(1));
        else if (a === head) cur = w.slice().reverse().concat(cur.slice(1));
        else continue;
        pool.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (cur[0] === cur[cur.length - 1]) rings.push(cur.slice(0, -1));
    else if (forceClose && cur.length >= 3) rings.push(cur);
  }
  return rings.filter((r) => r.length >= 3);
}
