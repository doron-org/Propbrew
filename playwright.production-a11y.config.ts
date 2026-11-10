import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PW_PORT ?? 3106);

// Run only after an isolated production build. Demo identities are enabled by
// the server-only runtime flag, never by a value inlined into the client bundle.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/accessibility.spec.ts',
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PW_NO_SERVER ? undefined : {
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
      NEXT_PUBLIC_DEV_IDENTITY: '0',
      REEVE_ALLOW_DEMO_IDENTITIES: '1',
      REEVE_ALLOW_IN_MEMORY_DATA: '1',
      DATA_SOURCE: 'memory',
      PROPBREW_AUTH_MODE: 'clerk',
      PROPBREW_REVIEW_MODE: '0',
      PROPBREW_WEBSITE_ONLY: '0',
      CLERK_SECRET_KEY: '',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      BLOB_READ_WRITE_TOKEN: '',
    },
  },
});
