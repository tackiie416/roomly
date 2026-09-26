import { test, expect } from "@playwright/test";

/**
 * Test de humo de Foundation: confirma que la app levanta y la home
 * renderiza. Los 3 flujos E2E completos (estudiante, room provider,
 * admin) que pide docs/TESTING.md llegan cuando existan esas
 * funcionalidades — no antes.
 *
 * No ejecutado en este entorno (sin navegadores de Playwright
 * disponibles) — pendiente de correr en GitHub Actions o en local.
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
