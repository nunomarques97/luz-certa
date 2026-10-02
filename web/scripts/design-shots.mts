/**
 * Captures the static design prototypes in docs/ui/directions/ into docs/ui/<direction>-<screen>-<width>.png.
 * Full-page screenshots at 1440 px (1x) and 390 px (2x). Fails on a script error, a request that is
 * not a local file, or content wider than the viewport.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIRECTIONS_DIR = resolve(ROOT, 'docs/ui/directions');
const OUT_DIR = resolve(ROOT, 'docs/ui');

const DIRECTIONS = ['ranked-report', 'load-curve', 'bill-ledger'];

interface Shot {
  direction: string;
  screen: string;
  page: string;
}

const SHOTS: Shot[] = [
  ...DIRECTIONS.flatMap((direction) => [
    { direction, screen: 'upload', page: 'upload.html' },
    { direction, screen: 'results', page: 'results.html' },
  ]),
  { direction: 'ranked-report', screen: 'upload-error', page: 'upload.html?estado=erro' },
];

/** Optional direction names as arguments limit the run, e.g. `node scripts/design-shots.mts load-curve`. */
const ONLY = process.argv.slice(2);

const VIEWPORTS = [
  { width: 1440, height: 900, deviceScaleFactor: 1 },
  { width: 390, height: 844, deviceScaleFactor: 2 },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const problems: string[] = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        locale: 'pt-PT',
        reducedMotion: 'reduce',
      });
      await context.route('**/*', (route) =>
        route.request().url().startsWith('file:') ? route.continue() : route.abort(),
      );
      for (const shot of SHOTS.filter((s) => ONLY.length === 0 || ONLY.includes(s.direction))) {
        const label = `${shot.direction}-${shot.screen}-${viewport.width}`;
        const page = await context.newPage();
        page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`));
        page.on('requestfailed', (request) =>
          problems.push(`${label}: request outside the prototype folder ${request.url()}`),
        );
        const [file, query = ''] = shot.page.split('?');
        const url = pathToFileURL(resolve(DIRECTIONS_DIR, shot.direction, file)).href;
        await page.goto(query ? `${url}?${query}` : url, { waitUntil: 'load' });
        // A string expression: this script is type-checked without DOM types.
        const overflow = Number(
          await page.evaluate(
            'document.documentElement.scrollWidth - document.documentElement.clientWidth',
          ),
        );
        if (overflow > 0) problems.push(`${label}: content is ${overflow} px wider than the viewport`);
        const path = resolve(OUT_DIR, `${label}.png`);
        await page.screenshot({ path, fullPage: true });
        console.log(`wrote docs/ui/${label}.png`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
}

await main();
