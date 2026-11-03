import { defineConfig, devices } from '@playwright/test'

import { E2E_URL, PROJECT_ID } from './e2e/scenario.ts'

const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? 'github' : 'list',
  use: { baseURL: E2E_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: devices['Desktop Chrome'], testIgnore: ['mobile.spec.ts', 'smoke.spec.ts'] },
    { name: 'mobile', use: devices['Pixel 7'], testMatch: 'mobile.spec.ts' },
  ],
  webServer: [
    {
      // The Firestore emulator needs Java.
      command: `npx --yes firebase-tools@15.32.1 emulators:start --config e2e/firebase.json --project ${PROJECT_ID} --only auth,firestore`,
      url: 'http://127.0.0.1:9099/',
      wait: { stdout: /All emulators ready/ },
      // The CLI stops the emulators it started only when interrupted.
      gracefulShutdown: { signal: 'SIGINT', timeout: 10_000 },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: 'vite build && node e2e/server.ts',
      url: `${E2E_URL}/api/health`,
      reuseExistingServer: !CI,
    },
  ],
})
