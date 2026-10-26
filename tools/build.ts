// `npm run data:build` — reproducible pipeline: fetch -> extract -> chunk.
// DHAKA_BBOX=core|mid|full (default core). Pass --force to re-extract.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPbf } from './fetch';
import { extract } from './extract';
import { buildChunks } from './chunk';
import { RAW_PBF, selectedBBox, workDir } from './config';

async function main() {
  const { name, bbox } = selectedBBox();
  const force = process.argv.includes('--force');
  console.log(`Dhaka data build — bbox "${name}" ${JSON.stringify(bbox)}`);
  console.log('[1/3] source');
  await fetchPbf();
  console.log('[2/3] extract');
  const feats = join(workDir(name), 'features.ndjson');
  const statsFile = join(workDir(name), 'extract-stats.json');
  const fresh =
    !force && existsSync(feats) && existsSync(statsFile) && statSync(statsFile).mtimeMs > statSync(RAW_PBF).mtimeMs &&
    (name !== 'custom');
  if (fresh) console.log('  extract cache is fresh (use --force to redo)');
  else extract(name, bbox);
  console.log('[3/3] chunk');
  const index = await buildChunks(name, bbox);
  console.log('Counts:');
  for (const [k, v] of Object.entries(index.counts).sort()) console.log(`  ${k.padEnd(28)} ${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
