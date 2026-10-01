import { defineConfig, devices } from "@playwright/test";

/**
 * E2 — E2E REAL contra el proyecto Supabase de validación (Fase 2.8).
 * Solo se ejecuta desde el job manual `e2e-real` de
 * .github/workflows/supabase-validation.yml, nunca en `npm run test:e2e` ni
 * en CI normal. Ver docs/SUPABASE_VALIDATION.md.
 *
 * - Sin webServer: el workflow arranca la app antes, en otro paso, solo con
 *   NEXT_PUBLIC_SUPABASE_URL y la clave anon (este proceso no la levanta, así
 *   que ningún otro secret llega a la app).
 * - Sin trace, vídeo, capturas ni report HTML: podrían contener el magic
 *   link, cookies de sesión o el email de prueba. Solo el reporter `list`.
 * - Sin instantánea de la página en error-context.md (PLAYWRIGHT_NO_COPY_PROMPT):
 *   el árbol de accesibilidad incluiría el email escrito en el formulario.
 *   El error-context.md que queda solo lleva los mensajes de error, que el
 *   spec reescribe sin email ni URLs, y outputDir no se conserva ni se sube.
 * - Sin reintentos: un segundo intento pediría otro email (límites de Auth).
 */
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./tests/e2e/real",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  outputDir: "test-results-real",
  preserveOutput: "never",
  timeout: 180_000,
  use: {
    baseURL: process.env.E2E_APP_URL ?? "http://localhost:3000",
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
