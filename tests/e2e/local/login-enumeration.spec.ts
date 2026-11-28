import { expect, test } from "@playwright/test";
import {
  APP,
  completeOnboarding,
  loginWithMagicLink,
  resetMock,
  setSignupsOpen,
  uniqueEmail,
} from "./helpers";

// Sesión 88 — con el registro cerrado (beta cerrada), pedir un enlace para un
// email sin cuenta responde lo mismo que para uno registrado: el formulario no
// revela qué emails tienen cuenta. Supabase simulado.

test.afterEach(async () => {
  await resetMock();
});

test("registro cerrado: misma respuesta con y sin cuenta, y sin email para la que no existe", async ({
  page,
  browser,
}) => {
  const existing = uniqueEmail("enum-existe");
  await loginWithMagicLink(page, existing);
  await completeOnboarding(page, "Existe Ya");
  await setSignupsOpen(false);

  const texts: string[] = [];
  for (const email of [existing, uniqueEmail("enum-no-existe")]) {
    const context = await browser.newContext();
    const anon = await context.newPage();
    await anon.goto(`${APP}/login`);
    await anon.getByPlaceholder("tucorreo@ejemplo.com").fill(email);
    await anon.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(anon.getByText("Revisa tu correo")).toBeVisible();
    await expect(anon.locator("main").getByRole("alert")).toHaveCount(0);
    texts.push((await anon.locator("main").innerText()).trim());
    await context.close();
  }
  expect(texts[0]).toBe(texts[1]);
});
