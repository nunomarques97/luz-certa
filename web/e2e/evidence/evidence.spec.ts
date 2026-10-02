import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { YEAR_FILE, calculateWith, expectResults, upload } from '../helpers';

/**
 * Writes viewport screenshots of every screen and state into docs/evidence/ as
 * <screen>-<state>-<width>.png, at 1440 px (1x) and 390 px (2x). Each capture also checks that
 * nothing is wider than the viewport.
 */
const OUT_DIR = fileURLToPath(new URL('../../../docs/evidence/', import.meta.url));
const VIEWPORTS = [
  { width: 1440, height: 900, deviceScaleFactor: 1 },
  { width: 390, height: 844, deviceScaleFactor: 2 },
];
const CURRENT = 'EDP Comercial Eletricidade';

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

async function shoot(page: Page, name: string, width: number): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} at ${width} px is wider than the viewport`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT_DIR}${name}-${width}.png` });
}

/** Scrolls so the section heading sits at the top of the viewport. */
async function scrollToHeading(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('heading', { level: 2, name }).evaluate((el) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16);
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width} px`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
    });

    test('upload, setup and processing', async ({ page }) => {
      const held: Route[] = [];
      await page.route('**/data/omie/2025.json', (route) => void held.push(route));

      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shoot(page, 'upload-default', viewport.width);

      await upload(page, YEAR_FILE);
      await expect(page.getByLabel('Tarifa atual')).toBeVisible();
      await page.getByLabel('Tarifa atual').selectOption({ index: 3 });
      await shoot(page, 'setup-default', viewport.width);

      await page.getByRole('button', { name: 'Calcular' }).click();
      await expect(page.getByTestId('processing')).toBeVisible();
      // Captured with reduced motion: the progress bar is static.
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      await shoot(page, 'processing-default', viewport.width);
      for (const route of held) {
        await route.abort();
      }
    });

    test('upload error', async ({ page }) => {
      await page.goto('/');
      await upload(page, 'malformed-missing-column.xlsx');
      await calculateWith(page, CURRENT);
      await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await shoot(page, 'upload-error', viewport.width);
    });

    test('results', async ({ page }) => {
      await page.goto('/');
      await upload(page, YEAR_FILE);
      await calculateWith(page, CURRENT);
      await expectResults(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shoot(page, 'results-top', viewport.width);

      await scrollToHeading(page, /da mais barata à mais cara/);
      await shoot(page, 'results-ranking', viewport.width);

      await scrollToHeading(page, 'Mês a mês');
      await shoot(page, 'results-monthly', viewport.width);

      await scrollToHeading(page, 'Pressupostos e fontes');
      await shoot(page, 'results-assumptions', viewport.width);
    });

    test('sources', async ({ page }) => {
      await page.goto('/fontes');
      await expect(page.getByTestId('sources-offers')).toBeVisible();
      await shoot(page, 'sources-default', viewport.width);
      await scrollToHeading(page, 'As ofertas da lista');
      await shoot(page, 'sources-offers', viewport.width);
    });
  });
}
