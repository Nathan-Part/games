import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:8123',
    headless: true,
    launchOptions: {
      args: [
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  webServer: {
    command: 'python -m http.server 8123',
    port: 8123,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
