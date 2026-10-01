import { expect, test } from "@playwright/test";
import {
  APP,
  completeOnboarding,
  loginWithMagicLink,
  pathOf,
  uniqueEmail,
  userState,
} from "./helpers";

// Formularios de 2.4–2.7 sin JavaScript. El login necesita JavaScript (el
// formulario llama a signInWithOtp en el navegador), así que la sesión se
// crea con él y se pasa a un contexto sin JavaScript.
test("perfil, preferencias, ajustes y logout sin JavaScript", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("sin-js");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Sin JS E1");

  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();

  await p.goto(`${APP}/perfil`);
  await p.locator("#bio").fill("Guardado sin JavaScript");
  await p.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(p.getByText("Cambios guardados.")).toBeVisible();

  await p.goto(`${APP}/preferencias`);
  await p.locator("#budget_max").fill("555");
  await p.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(p.getByText("Preferencias guardadas.")).toBeVisible();

  await p.goto(`${APP}/ajustes`);
  await p.locator('input[name="email_notifications_enabled"]').uncheck();
  await p.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(p.getByText("Ajustes guardados.")).toBeVisible();

  const state = await userState(email);
  expect(state.profile).toMatchObject({
    bio: "Guardado sin JavaScript",
    email_notifications_enabled: false,
  });
  expect(state.preferences?.budget_max).toBe(555);

  await p
    .getByRole("navigation", { name: "Tu cuenta" })
    .getByRole("button", { name: "Cerrar sesión" })
    .click();
  await expect(p).toHaveURL(`${APP}/login`);
  await p.goto(`${APP}/ajustes`);
  expect(pathOf(p)).toBe("/login?next=%2Fajustes");
  await noJs.close();
});
