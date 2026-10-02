import { defineConfig, devices } from '@playwright/test';

const PORT = 4510;

/**
 * `npm run e2e` runs the `chromium` project (behaviour and privacy tests); `npm run evidence` runs
 * the `evidence` project, which writes the screenshots in docs/evidence/. Both serve the production
 * build without live reload, so the only traffic is the app's own.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'pt-PT',
    timezoneId: 'Europe/Lisbon',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /evidence\//,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'evidence',
      testMatch: /evidence\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], contextOptions: { reducedMotion: 'reduce' } },
    },
  ],
  webServer: {
    command: `npx ng serve --configuration production --port ${PORT} --host 127.0.0.1 --no-live-reload --no-watch`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
