import { expect, test } from "@playwright/test";
import { APP } from "./helpers";

// Rutas protegidas sin sesión: con y sin JavaScript, y a nivel HTTP (el 307
// no lleva contenido protegido).
const CASES = [
  ["/perfil", "/login?next=%2Fperfil"],
  ["/preferencias", "/login?next=%2Fpreferencias"],
  ["/ajustes", "/login?next=%2Fajustes"],
  ["/admin", "/login?next=%2Fadmin"],
  ["/bienvenida/perfil", "/login"],
  ["/bienvenida/preferencias", "/login"],
  ["/cuenta-desactivada", "/login"],
] as const;

for (const javaScriptEnabled of [true, false]) {
  test.describe(`sin sesión (JavaScript ${javaScriptEnabled ? "activado" : "desactivado"})`, () => {
    test.use({ javaScriptEnabled });
    for (const [path, expected] of CASES) {
      test(`${path} → ${expected}`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(`${APP}${expected}`);
        await expect(
          page.getByRole("heading", { name: "Entrar en Roomly" })
        ).toBeVisible();
      });
    }
  });
}

test("HTTP: 307 a /login sin contenido protegido", async ({ request }) => {
  for (const [path, expected] of CASES) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    const location = new URL(response.headers()["location"] ?? "", APP);
    expect(location.origin, path).toBe(APP);
    expect(`${location.pathname}${location.search}`, path).toBe(expected);
    const body = await response.text();
    expect(body).not.toMatch(/Tu perfil|Ajustes|preferencias de vivienda|Crea tu perfil/);
  }
});
