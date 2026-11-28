import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests de un despliegue (sesión 87): staging antes de abrirlo y después
 * de cada deploy o rollback (docs/STAGING.md). Solo lecturas anónimas: no
 * inicia sesión, no envía formularios, no crea usuarios ni escribe nada.
 *
 *   SMOKE_BASE_URL=https://staging.ejemplo npx playwright test -c playwright.smoke.config.ts
 *
 * Sin webServer: el despliegue ya existe. No forma parte de `npm run test:e2e`
 * ni de la CI. Sin trace, vídeo ni capturas.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) throw new Error("SMOKE_BASE_URL es obligatoria (la URL del despliegue).");

export default defineConfig({
  testDir: "./tests/e2e/smoke",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  outputDir: "test-results-smoke",
  preserveOutput: "never",
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
