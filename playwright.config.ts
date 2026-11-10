import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PW_PORT ?? 3000);
export default defineConfig({
  testDir: './tests/e2e',
  // Production accessibility runs after the isolated build in its own config.
  // Avoid duplicate development scans and their cold-compilation stalls here.
  testIgnore: '**/accessibility.spec.ts',
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  webServer: process.env.PW_NO_SERVER ? undefined : {
    command: `npm run dev -- --webpack --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Browser smoke tests exercise the local sample workspaces without relying
    // on ignored developer configuration or changing any production auth gate.
    env: {
      NODE_ENV: 'development',
      NEXT_PUBLIC_DEV_IDENTITY: '1',
      PROPBREW_REVIEW_MODE: '0',
      PROPBREW_WEBSITE_ONLY: '0',
      DATA_SOURCE: 'memory',
      CLERK_SECRET_KEY: '',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
    },
  },
});
