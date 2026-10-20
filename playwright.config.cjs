const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', headless: true, reducedMotion: 'reduce', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node scripts/e2e-api.cjs', url: 'http://127.0.0.1:4001/api/health', timeout: 120000 },
    { command: 'npm --prefix frontend run dev -- --port 5174 --strictPort', url: 'http://127.0.0.1:5174', env: { VITE_API_URL: 'http://127.0.0.1:4001/api' }, timeout: 120000 }
  ]
});
