import { expect, test, type Page, type Route } from '@playwright/test';

import { YEAR_FILE, calculateWith, expectResults, fixture, upload } from './helpers';

const EDP_FIXED = 'EDP Comercial Eletricidade';
const MEO_FIXED = 'MEO Energia FIXA DD FE';

const status = (page: Page) => page.getByTestId('status');
const currentRow = (page: Page) => page.locator('.row.is-current');

test.describe('analysis flow', () => {
  test('happy path: the year file gives a full result', async ({ page }) => {
    await page.goto('/');
    await upload(page, YEAR_FILE);
    await expect(page.getByTestId('file-name')).toHaveText(YEAR_FILE);
    await calculateWith(page, EDP_FIXED);
    await expectResults(page);

    await expect(status(page)).toContainText('Resultados prontos');
    await expect(page.getByTestId('context')).toContainText('1 de janeiro a 31 de dezembro de 2025');
    await expect(page.getByTestId('answer')).toContainText('a tarifa mais barata teria custado');
    await expect(page.getByTestId('best-delta')).toContainText('menos do que a sua tarifa atual');
    await expect(page.getByTestId('current-card')).toContainText('Posição entre 10 tarifas');

    const rows = page.getByTestId('ranking').locator('li');
    await expect(rows).toHaveCount(10);
    await expect(currentRow(page)).toHaveCount(1);
    await expect(currentRow(page)).toContainText('EDP Comercial Eletricidade');
    await expect(currentRow(page).getByTestId('delta')).toHaveText('a sua tarifa');
    // A whole year: no annualised label.
    await expect(page.getByText(/por ano:/)).toHaveCount(0);

    const table = page.getByTestId('monthly-table');
    await expect(table.locator('tbody tr')).toHaveCount(12);
    await expect(table.locator('tfoot')).toContainText('Total');

    await expect(page.getByTestId('notices')).toContainText('estimadas');
    await expect(page.getByTestId('assumptions').locator('li').first()).toBeVisible();
    const sources = page.getByTestId('sources');
    await expect(sources.locator('tbody tr')).toHaveCount(10);
    await expect(sources.locator('a[href^="https://"]').first()).toBeVisible();
    await expect(sources).toContainText('2 out. 2026');
    await expect(page.getByTestId('not-sponsored')).toContainText('paga ou patrocinada');

    const text = await page.locator('body').innerText();
    expect(text).not.toContain(String.fromCharCode(0x2014));
    expect(text).not.toMatch(/patrocinad[ao] por|afiliad/i);
  });

  test('a malformed file shows the error, then another file succeeds', async ({ page }) => {
    await page.goto('/');
    await upload(page, 'malformed-missing-column.xlsx');
    await calculateWith(page, EDP_FIXED);

    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText('Não conseguimos ler este ficheiro');
    await expect(banner).toContainText('Faltam as colunas Data, Hora ou consumo');
    await expect(page.getByTestId('ranking')).toHaveCount(0);
    await expect(status(page)).toContainText('Erro');
    // The upload zone stays under the banner so the user can retry at once.
    await expect(page.getByTestId('upload-zone')).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await banner.getByRole('button', { name: 'Escolher outro ficheiro' }).click();
    await (await chooser).setFiles(fixture(YEAR_FILE));
    // The settings the user already entered are kept.
    await expect(page.getByLabel('Tarifa atual')).toHaveValue('edp-eletricidade-simple');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expectResults(page);
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
  });

  test('retry after a failed data load reuses the last file and settings', async ({ page }) => {
    let failures = 0;
    await page.route('**/data/omie/2025.json', (route) => {
      if (failures === 0) {
        failures++;
        return route.abort('failed');
      }
      return route.continue();
    });
    await page.goto('/');
    await upload(page, YEAR_FILE);
    await calculateWith(page, MEO_FIXED);

    const banner = page.getByTestId('error-banner');
    await expect(banner).toContainText('Não foi possível carregar os preços', { timeout: 30_000 });
    await expect(page.getByTestId('ranking')).toHaveCount(0);

    await banner.getByRole('button', { name: 'Tentar de novo' }).click();
    await expectResults(page);
    expect(failures).toBe(1);
    await expect(page.getByTestId('context')).toContainText(YEAR_FILE);
    await expect(currentRow(page)).toContainText('MEO Energia FIXA DD FE');
  });

  test('switching the current tariff updates the deltas', async ({ page }) => {
    await page.goto('/');
    await upload(page, YEAR_FILE);
    await calculateWith(page, EDP_FIXED);
    await expectResults(page);
    const edpRow = page.locator('[data-offer="edp-eletricidade-simple"]');
    const meoRow = page.locator('[data-offer="meo-energia-fixa-dd-fe-simple"]');
    await expect(edpRow.getByTestId('delta')).toHaveText('a sua tarifa');
    const meoDeltaBefore = (await meoRow.getByTestId('delta').innerText()).trim();
    const currentTotalBefore = await page.getByTestId('current-card').locator('dd').first().innerText();

    await page.getByRole('button', { name: 'Alterar potência ou tarifa' }).click();
    await calculateWith(page, MEO_FIXED);
    await expectResults(page);

    await expect(meoRow.getByTestId('delta')).toHaveText('a sua tarifa');
    await expect(meoRow).toHaveClass(/is-current/);
    await expect(edpRow.getByTestId('delta')).not.toHaveText('a sua tarifa');
    expect((await meoRow.getByTestId('delta').innerText()).trim()).not.toBe(meoDeltaBefore);
    await expect(page.getByTestId('current-card').locator('dd').first()).not.toHaveText(
      currentTotalBefore,
    );
    // EDP is about 0,14 € dearer than MEO over the year: the badge says "mais" with the same amount.
    await expect(edpRow.getByTestId('delta')).toContainText(meoDeltaBefore.replace(/^\W*/, '').replace('menos', 'mais'));
  });

  test('a new upload while computing discards the obsolete result', async ({ page }) => {
    const held: Route[] = [];
    let hold = true;
    await page.route('**/data/omie/2025.json', (route) =>
      hold ? void held.push(route) : route.continue(),
    );
    await page.goto('/');
    await upload(page, YEAR_FILE);
    await calculateWith(page, EDP_FIXED);
    await expect(page.getByTestId('processing')).toBeVisible();
    await expect(status(page)).toContainText('A calcular');
    await expect.poll(() => held.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Escolher outro ficheiro' }).click();
    await expect(status(page)).toContainText('Cálculo cancelado');
    await upload(page, 'synthetic-partial-2025-q1.xlsx');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expect(page.getByTestId('processing')).toBeVisible();
    await expect(page.getByTestId('ranking')).toHaveCount(0);

    hold = false;
    for (const route of held) {
      await route.continue();
    }
    await expectResults(page);
    await expect(page.getByTestId('context')).toContainText('1 de janeiro a 31 de março de 2025');
    await expect(page.getByTestId('context')).toContainText('synthetic-partial-2025-q1.xlsx');
    await expect(page.getByTestId('context')).not.toContainText(YEAR_FILE);
    // A partial year shows the annualised value next to each period cost.
    await expect(page.getByTestId('ranking').getByText(/por ano:/).first()).toBeVisible();
    await expect(page.getByTestId('monthly-table').locator('tbody tr')).toHaveCount(3);
  });

  test('manual prices are validated, then priced as the current tariff', async ({ page }) => {
    await page.goto('/');
    await upload(page, YEAR_FILE);
    await page.getByLabel('Indicar os preços da minha fatura').check();
    await page.getByLabel('Energia', { exact: true }).fill('abc');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expect(page.getByText('Indique um número maior que 0')).toBeVisible();
    await expect(page.getByLabel('Energia', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Energia', { exact: true })).toBeFocused();

    await page.getByLabel('Energia', { exact: true }).fill('0,1658');
    await page.getByLabel('Potência', { exact: true }).fill('0,4520');
    await page.getByRole('button', { name: 'Calcular' }).click();
    await expectResults(page);
    await expect(page.getByTestId('ranking').locator('li')).toHaveCount(11);
    await expect(currentRow(page)).toContainText('A sua tarifa atual');
    await expect(currentRow(page)).toContainText('Preços que indicou, simples, 0,1658 €/kWh e 0,452 €/dia sem IVA');
  });

  test('the setup form works with the keyboard alone and focus stays visible', async ({ page }) => {
    await page.goto('/');
    await upload(page, YEAR_FILE);
    await page.getByLabel('Tarifa atual').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('Tarifa atual')).not.toHaveValue('');
    const outline = await page.getByLabel('Tarifa atual').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('solid');
    // Tab past the family checkbox to the submit button and press Enter.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Calcular' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expectResults(page);
  });

  test('the sources page lists every offer with its source and verified-on date', async ({ page }) => {
    await page.goto('/fontes');
    await expect(page.getByRole('heading', { level: 1, name: 'Fontes e pressupostos' })).toBeVisible();
    const offers = page.getByTestId('sources-offers');
    await expect(offers.locator('tbody tr')).toHaveCount(10);
    await expect(offers).toContainText('2 out. 2026');
    await expect(page.getByText('A energia de cada quarto de hora é esse valor a dividir por 4.')).toBeVisible();
    await expect(page.getByText('Nenhuma posição da lista é paga ou patrocinada.').first()).toBeVisible();
  });
});
