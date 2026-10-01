import { test, expect } from "@playwright/test";

/**
 * Test de humo de Foundation: confirma que la app levanta y la home
 * renderiza. Los 3 flujos E2E completos (estudiante, room provider,
 * admin) que pide docs/TESTING.md llegan cuando existan esas
 * funcionalidades — no antes.
 *
 * Desde la Fase 2.8 forma parte de E1 (tests/e2e/local, contra el Supabase
 * simulado): los flujos de estudiante están en los demás specs de esta
 * carpeta. Ejecutado en local con el Chromium preinstalado del entorno
 * cloud (PLAYWRIGHT_CHROMIUM_EXECUTABLE); en CI, job `e2e-local`.
 */
test("la home carga y muestra el nombre del producto", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Roomly" })).toBeVisible();
});

test("login pide email y ofrece Google como alternativa", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar en Roomly" })).toBeVisible();
  await expect(page.getByPlaceholder("tucorreo@ejemplo.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
});
