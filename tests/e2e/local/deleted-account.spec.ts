import { expect, test } from "@playwright/test";
import {
  APP,
  completeOnboarding,
  deactivateAccount,
  loginWithMagicLink,
  uniqueEmail,
  userState,
} from "./helpers";

// Cuenta eliminada (deleted_at puesto por el servidor): ninguna ruta de la
// app la deja entrar ni escribir, y un nuevo magic link no la reactiva.
test("cuenta eliminada: rutas, formulario abierto y nuevo login", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("eliminada");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Eliminada E1");

  // Formulario abierto antes del borrado.
  await page.goto("/ajustes");
  const toggle = page.locator('input[name="email_notifications_enabled"]');
  await expect(toggle).toBeChecked();

  await deactivateAccount(email);
  const before = await userState(email);

  await toggle.uncheck();
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page).toHaveURL(`${APP}/cuenta-desactivada`);
  const after = await userState(email);
  expect(after.profile?.email_notifications_enabled).toBe(true);
  expect(after).toEqual(before);

  for (const path of [
    "/perfil",
    "/preferencias",
    "/ajustes",
    "/bienvenida/perfil",
    "/",
  ]) {
    await page.goto(path);
    if (path === "/") continue; // la home es pública
    await expect(page, path).toHaveURL(`${APP}/cuenta-desactivada`);
    await expect(
      page.getByRole("heading", { name: "Tu cuenta está desactivada" })
    ).toBeVisible();
  }

  // Un nuevo magic link (otro navegador) lleva a la misma pantalla.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await loginWithMagicLink(freshPage, email);
  await expect(freshPage).toHaveURL(`${APP}/cuenta-desactivada`);
  expect((await userState(email)).profile?.deleted_at).not.toBeNull();
  await fresh.close();
});
