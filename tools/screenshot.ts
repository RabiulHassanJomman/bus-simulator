// Headless browser check: load the game at given views and save screenshots.
// Usage: tsx tools/screenshot.ts <baseUrl> <outDir> [lat,lon,zoom[|action...] ...]
// Actions: "key:m" presses a key, "type:text" types text, "wait:ms" waits, "eval:js" runs JS.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

async function main() {
  const [base = 'http://localhost:5173/', outDir = 'shots', ...views] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: (process.env.CHROME_ARGS ?? '--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist')
      .split(' ')
      .concat('--window-size=1280,800'),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warn') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  const list = views.length ? views : ['23.7383,90.3958,1.2'];
  for (const [i, spec] of list.entries()) {
    const [v, ...actions] = spec.split('|');
    await page.goto(`${base}#${v}`, { waitUntil: 'load' });
    if (i > 0) await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => {
        const g = (window as any).__game;
        return g && g.world.stats.loaded > 0 && g.world.loading === 0;
      },
      { timeout: 120000 },
    );
    await new Promise((r) => setTimeout(r, 1500));
    for (const a of actions) {
      const [kind, arg] = [a.slice(0, a.indexOf(':')), a.slice(a.indexOf(':') + 1)];
      if (kind === 'key') await page.keyboard.press(arg as never);
      else if (kind === 'type') await page.keyboard.type(arg, { delay: 30 });
      else if (kind === 'wait') await new Promise((r) => setTimeout(r, Number(arg)));
      else if (kind === 'eval') await page.evaluate(arg);
      await new Promise((r) => setTimeout(r, 600));
    }
    await page.waitForFunction(() => (window as any).__game.world.loading === 0, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 800));
    // string form: tsx/esbuild would inject a __name helper into function sources
    const stats = await page.evaluate(`(() => {
      const g = window.__game;
      const b = g.bench(20);
      const r = (v) => Math.round(v * 10) / 10;
      return { ...g.world.stats, lod: g.world.lod, fps: Math.round(g.app.ticker.FPS), ms: { update: r(b.update), labels: r(b.labels), render: r(b.render) } };
    })()`);
    const file = join(outDir, `view-${i}.png`);
    await page.screenshot({ path: file });
    console.log(`${file}  ${spec}  ${JSON.stringify(stats)}`);
  }
  if (errors.length) console.log('Console:\n' + errors.slice(0, 30).join('\n'));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
