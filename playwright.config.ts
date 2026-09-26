import { defineConfig, devices } from "@playwright/test";

/**
 * No verificado en este entorno: el sandbox de desarrollo no tiene salida
 * de red hacia el CDN de navegadores de Playwright, así que
 * `npx playwright install` no puede completarse aquí (ver
 * docs/TESTING.md). Esta configuración solo se ha comprobado por
 * sintaxis/tipos — ejecutar de verdad en GitHub Actions o en local.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
