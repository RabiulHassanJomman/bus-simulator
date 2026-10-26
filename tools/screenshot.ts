// Headless browser check: load the game at given views and save screenshots.
// Usage: tsx tools/screenshot.ts <baseUrl> <outDir> [lat,lon,zoom ...]
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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warn') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  const list = views.length ? views : ['23.7383,90.3958,1.2'];
  for (const [i, v] of list.entries()) {
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
    const stats = await page.evaluate(() => {
      const g = (window as any).__game;
      return { ...g.world.stats, fps: g.app.ticker.FPS };
    });
    const file = join(outDir, `view-${i}.png`);
    await page.screenshot({ path: file });
    console.log(`${file}  ${v}  ${JSON.stringify(stats)}`);
  }
  if (errors.length) console.log('Console:\n' + errors.slice(0, 30).join('\n'));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
