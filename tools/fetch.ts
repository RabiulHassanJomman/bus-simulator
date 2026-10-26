// Download the Geofabrik Bangladesh extract (cached in data/raw, gitignored).
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PBF_URL, RAW_PBF } from './config';

export async function fetchPbf(force = false) {
  if (existsSync(RAW_PBF) && !force) {
    console.log(`  using cached ${RAW_PBF} (${(statSync(RAW_PBF).size / 1e6).toFixed(0)} MB)`);
    return;
  }
  mkdirSync(dirname(RAW_PBF), { recursive: true });
  const part = RAW_PBF + '.part';
  const have = existsSync(part) ? statSync(part).size : 0;
  console.log(`  downloading ${PBF_URL}${have ? ` (resuming at ${(have / 1e6).toFixed(0)} MB)` : ''}`);
  const res = await fetch(PBF_URL, { headers: have ? { Range: `bytes=${have}-` } : {} });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const append = have > 0 && res.status === 206;
  const total = Number(res.headers.get('content-length') ?? 0) + (append ? have : 0);
  let got = append ? have : 0;
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (c: Buffer) => {
    got += c.length;
    if (total) process.stdout.write(`\r  ${((got / total) * 100).toFixed(1)}% of ${(total / 1e6).toFixed(0)} MB   `);
  });
  await pipeline(body, createWriteStream(part, { flags: append ? 'a' : 'w' }));
  renameSync(part, RAW_PBF);
  console.log('\n  download complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchPbf(process.argv.includes('--force')).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
