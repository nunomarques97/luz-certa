import { expect, test } from '@playwright/test';

test('loads the upload screen in European Portuguese', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Luz Certa');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
  await expect(page.getByRole('link', { name: 'Luz Certa' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Quanto teria pago com outra tarifa de eletricidade?' }),
  ).toBeVisible();
  await expect(page.getByText('O ficheiro não sai do seu dispositivo.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Como obter o ficheiro' })).toBeVisible();
});
