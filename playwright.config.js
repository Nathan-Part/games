import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  // NB: pas de parallélisme — SwiftShader (rendu 3D logiciel, pas de GPU en headless) sature le CPU dès 2-3 navigateurs
  // simultanés → timeouts massifs. La suite tourne en séquentiel (~17 min). Cibler avec `-g "motif"` pour itérer.
  workers: 1,
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
