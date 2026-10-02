import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** Synthetic fixtures only; real consumption files are never used in tests. */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/synthetic/${name}`, import.meta.url));
}

export const YEAR_FILE = 'synthetic-year-2025.xlsx';

/** Picks a file through the upload screen's native file input. */
export async function upload(page: Page, name: string): Promise<void> {
  await page.getByLabel('Escolher ficheiro').setInputFiles(fixture(name));
}

/** Chooses a catalogue offer as the current tariff and submits the setup form. */
export async function calculateWith(page: Page, offerLabel: RegExp | string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'A sua potência e a sua tarifa' })).toBeVisible();
  await page.getByLabel('Tarifa atual').selectOption({ label: await optionLabel(page, offerLabel) });
  await page.getByRole('button', { name: 'Calcular' }).click();
}

async function optionLabel(page: Page, label: RegExp | string): Promise<string> {
  // The select only exists once the offer list has loaded.
  await expect(page.getByLabel('Tarifa atual')).toBeVisible();
  const labels = await page.getByLabel('Tarifa atual').locator('option').allTextContents();
  const match = labels.map((text) => text.trim()).find((text) =>
    typeof label === 'string' ? text === label : label.test(text),
  );
  if (!match) {
    throw new Error(`No offer matches ${label}; options: ${labels.join(' | ')}`);
  }
  return match;
}

/** Waits for the results screen of a finished calculation. */
export async function expectResults(page: Page): Promise<void> {
  await expect(page.getByTestId('ranking')).toBeVisible({ timeout: 60_000 });
}
