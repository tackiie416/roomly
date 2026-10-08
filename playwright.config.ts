import { defineConfig, devices } from "@playwright/test";
import {
  APP_ORIGIN,
  MOCK_ANON_KEY,
  MOCK_SERVICE_ROLE_KEY,
  MOCK_SUPABASE_URL,
} from "./tests/e2e/support/mock-config.mjs";

/**
 * E1 — E2E local (Fase 2.8): la app real (`next build` + `next start`)
 * contra el Supabase simulado de tests/e2e/support/mock-supabase.mjs. Sin
 * red externa ni secrets: las claves anon y service_role son ficticias y solo
 * las acepta el mock. La de service_role (Fase 3) la usa solo el servidor de
 * la app (lectura de candidatos y escritura del test); nunca el navegador ni
 * los specs. El E2 real nunca la recibe (ver docs/ENVIRONMENT.md).
 * El E2E real (E2) tiene su propia configuración: playwright.real.config.ts.
 *
 * Navegador: el que trae la versión instalada de @playwright/test
 * (`npx playwright install chromium`; en CI, ver .github/workflows/ci.yml).
 * Solo si ese navegador no se puede descargar (p. ej. el entorno cloud de
 * Claude Code, que trae otro Chromium preinstalado) se puede apuntar a uno
 * externo con PLAYWRIGHT_CHROMIUM_EXECUTABLE. Esa combinación no la soporta
 * Playwright oficialmente: el resultado de referencia es el de CI.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./tests/e2e/local",
  // Un solo worker: los specs comparten el estado en memoria del mock.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: APP_ORIGIN,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/e2e/support/mock-supabase.mjs",
      url: `${MOCK_SUPABASE_URL}/__test/log`,
      reuseExistingServer: false,
    },
    {
      // Build de producción: el comportamiento sin JavaScript es el real.
      command: "npm run build && npm run start",
      url: APP_ORIGIN,
      // Nunca reutilizar un servidor ya levantado: podría apuntar a otro Supabase.
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: MOCK_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: MOCK_ANON_KEY,
        NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
        // Ficticia (mock-config.mjs): solo el servidor de la app la lee.
        SUPABASE_SERVICE_ROLE_KEY: MOCK_SERVICE_ROLE_KEY,
      },
    },
  ],
});
