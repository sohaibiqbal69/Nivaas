import { defineConfig, devices } from '@playwright/test';

const authPort = '43119';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'npm run e2e:auth-server --workspace=@nivaas/backend',
      url: `http://127.0.0.1:${authPort}/api/health`,
      reuseExistingServer: false,
      env: { NIVAAS_E2E_AUTH_PORT: authPort },
      timeout: 30_000,
    },
    {
      command: 'npm run dev --workspace=@nivaas/frontend -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      env: { PORT: authPort, VITE_API_BASE_URL: '/api' },
      timeout: 60_000,
    },
  ],
});
