import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5179', viewport: { width: 1200, height: 1000 }, headless: true },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 5179 --strictPort', url: 'http://127.0.0.1:5179', reuseExistingServer: false }
});
