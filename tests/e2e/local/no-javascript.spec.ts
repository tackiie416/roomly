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

// Atribución del catálogo de barrios (CC BY 4.0, sesión 69): junto al
// selector de barrios del onboarding y de /preferencias, también sin
// JavaScript, con sus tres enlaces.
test("atribución de los barrios en el onboarding y en /preferencias, sin JavaScript", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("atribucion");
  await loginWithMagicLink(page, email);
  await expect(page).toHaveURL(`${APP}/bienvenida/perfil`);
  await page.locator("#full_name").fill("Atribución E1");
  await page.locator("#date_of_birth").fill("2001-03-15");
  await page.getByLabel("Busco habitación").check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(`${APP}/bienvenida/preferencias`);
  await expect(page.getByTestId("neighborhoods-attribution")).toBeVisible();

  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();
  for (const path of ["/bienvenida/preferencias", "/preferencias"]) {
    await p.goto(`${APP}${path}`);
    const attribution = p.getByTestId("neighborhoods-attribution");
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText(
      "datos procedentes del conjunto “Unidades administrativas de la ciudad de Barcelona”"
    );
    await expect(attribution).toContainText("recurso “BarcelonaCiutat_Barris.json”");
    await expect(
      p
        .getByRole("group", { name: /Barrios que prefieres/ })
        .getByTestId("neighborhoods-attribution")
    ).toBeVisible();
    expect(
      await attribution
        .getByRole("link")
        .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href))
    ).toEqual([
      "https://datos.gob.es/es/catalogo/l01080193-unidades-administrativas-de-la-ciudad-de-barcelona",
      "https://opendata-ajuntament.barcelona.cat/data/dataset/808daafa-d9ce-48c0-925a-fa5afdb1ed41/resource/75197dfe-0306-4c5e-9643-34948af07fb6/download",
      "https://creativecommons.org/licenses/by/4.0/deed.es",
    ]);
  }
  await noJs.close();
});
