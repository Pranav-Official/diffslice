import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test', testMatch: ['browser.spec.ts', 'rule-browser.spec.ts', 'logical-browser.spec.ts'], workers: 1, timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: '.artifacts/verification/playwright-results.json' }]],
  outputDir: '.artifacts/playwright',
  use: { browserName: 'chromium', channel: 'chromium', headless: true, viewport: { width: 1488, height: 818 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
