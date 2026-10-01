import { expect, test } from "@playwright/test";
import {
  APP,
  appNav,
  completeOnboarding,
  lastMagicLink,
  loginWithMagicLink,
  pathOf,
  requestMagicLink,
  uniqueEmail,
} from "./helpers";

// /callback con PKCE real: el código solo se canjea con el code_verifier que
// guardó el navegador que pidió el enlace, y una sola vez.

test("el enlace abierto en otro navegador (sin code_verifier) no inicia sesión", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("otro-navegador");
  const link = await requestMagicLink(page, email);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(link);
  await otherPage.waitForURL((url) => url.pathname === "/login");
  expect(new URL(otherPage.url()).searchParams.get("error")).toBeTruthy();
  expect((await other.cookies()).some((c) => /^sb-.*-auth-token$/.test(c.name))).toBe(
    false
  );
  await otherPage.goto("/perfil");
  expect(pathOf(otherPage)).toBe("/login?next=%2Fperfil");
  await other.close();
});

test("un enlace ya usado no vuelve a servir", async ({ page, browser }) => {
  const email = uniqueEmail("reutilizado");
  await loginWithMagicLink(page, email);
  await expect(page).toHaveURL(`${APP}/bienvenida/perfil`);
  const link = await lastMagicLink(email);

  const again = await browser.newContext();
  const againPage = await again.newPage();
  await againPage.goto(link);
  await againPage.waitForURL((url) => url.pathname === "/login");
  expect(new URL(againPage.url()).searchParams.get("error")).toBeTruthy();
  await again.close();
});

test("/callback con código inventado o sin código → /login con error propio", async ({
  page,
}) => {
  for (const path of [
    "/callback?code=inventado",
    "/callback",
    "/callback?error=access_denied&error_code=otp_expired&error_description=%3Cscript%3E",
  ]) {
    await page.goto(path);
    expect(new URL(page.url()).pathname).toBe("/login");
    const error = new URL(page.url()).searchParams.get("error");
    expect(error).toMatch(/^[a-z_]+$/);
    await expect(page.locator("body")).not.toContainText("<script>");
  }
});

test("next: tras el login, un perfil completo vuelve a la ruta pedida", async ({
  page,
}) => {
  const email = uniqueEmail("next");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Next E1");
  await page.goto("/ajustes");
  await appNav(page).getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(`${APP}/login`);

  await page.goto("/preferencias");
  expect(pathOf(page)).toBe("/login?next=%2Fpreferencias");
  const link = await requestMagicLink(page, email, "/login?next=%2Fpreferencias");
  await page.goto(link);
  await expect(page).toHaveURL(`${APP}/preferencias`);
});
