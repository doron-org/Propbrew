import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PW_COMPANY_BASE_URL;
if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Run company browser tests through scripts/test-company-auth-e2e.mjs against its disposable local app.');
}

export default defineConfig({
  testDir: './tests/e2e-company-auth',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: 'line',
  outputDir: '.propbrew-local/company-auth-e2e-results',
  // CI serves the production bundle behind a self-signed loopback TLS proxy.
  use: { baseURL, ...devices['Desktop Chrome'], screenshot: 'only-on-failure', trace: 'off', ignoreHTTPSErrors: true },
});
