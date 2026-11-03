import { defineConfig, devices } from '@playwright/test'

// The production server with the keys in `.env`, so these tests use the real providers.
const PORT = 8101
const URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'smoke.spec.ts',
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 90_000 },
  use: { ...devices['Desktop Chrome'], baseURL: URL, trace: 'retain-on-failure' },
  webServer: {
    command: 'vite build && node src/server/server.ts',
    env: { PORT: String(PORT) },
    url: `${URL}/api/health`,
    reuseExistingServer: false,
  },
})
