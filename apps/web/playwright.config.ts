import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});

