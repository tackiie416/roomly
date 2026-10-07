import { expect, test } from "@playwright/test";
import {
  APP,
  appNav,
  completeOnboarding,
  loginWithMagicLink,
  pathOf,
  requestLog,
  uniqueEmail,
  userState,
} from "./helpers";

// Flujo principal del estudiante nuevo, en orden: magic link → /callback con
// PKCE → onboarding → /perfil → /preferencias → /ajustes → logout.
test.describe.configure({ mode: "serial" });

test("estudiante nuevo: alta por magic link, onboarding, app y logout", async ({
  page,
  context,
}) => {
  const email = uniqueEmail("estudiante");
  // El registro del mock es común a todos los specs: solo cuenta lo de este test.
  const logStart = (await requestLog()).length;

  // 1–3. Alta: el mock crea el usuario (signup), el enlace pasa por
  // /auth/v1/verify y vuelve a /callback?code=; el callback canjea el código
  // con el code_verifier de la cookie. Sin perfil → paso 1 del onboarding.
  await loginWithMagicLink(page, email);
  await expect(page).toHaveURL(`${APP}/bienvenida/perfil`);
  const cookies = await context.cookies();
  expect(
    cookies.some(
      (c) => /^sb-.*-auth-token/.test(c.name) && !c.name.endsWith("code-verifier")
    )
  ).toBe(true);

  // 4. Onboarding completo → /test (Fase 3, D5).
  await completeOnboarding(page, "Estudiante E1");
  let state = await userState(email);
  expect(state.profile?.onboarding_completed_at).not.toBeNull();
  expect(state.preferences?.city_id).toBe("11111111-1111-4111-8111-111111111111");

  // Shell (2.7, Fase 3.5): los enlaces de la cuenta y el logout.
  await page.goto("/perfil");
  const nav = appNav(page);
  await expect(nav.getByRole("link")).toHaveText([
    "Explorar",
    "Test",
    "Perfil",
    "Preferencias",
    "Ajustes",
  ]);
  await expect(nav.getByRole("link", { name: "Perfil" })).toHaveAttribute(
    "aria-current",
    "page"
  );

  // 5. /perfil (2.4): editar y persistir.
  await expect(page.getByRole("heading", { name: "Tu perfil" })).toBeVisible();
  await expect(page.locator("#full_name")).toHaveValue("Estudiante E1");
  await page.locator("#bio").fill("Hola desde E1");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await page.reload();
  await expect(page.locator("#bio")).toHaveValue("Hola desde E1");

  // 6. /preferencias (2.5): editar y persistir; la ciudad sigue obligatoria.
  await nav.getByRole("link", { name: "Preferencias" }).click();
  await expect(page).toHaveURL(`${APP}/preferencias`);
  await expect(page.locator("#city_id")).toHaveJSProperty("required", true);
  await page.locator("#budget_max").fill("720");
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.getByText("Preferencias guardadas.")).toBeVisible();
  await page.reload();
  await expect(page.locator("#budget_max")).toHaveValue("720");

  // 7. /ajustes (2.6): desactivar el aviso, persistir y verlo en /perfil.
  await nav.getByRole("link", { name: "Ajustes" }).click();
  const toggle = page.locator('input[name="email_notifications_enabled"]');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Ajustes guardados.")).toBeVisible();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await page.goto("/perfil");
  await expect(
    page.locator('input[name="email_notifications_enabled"]')
  ).not.toBeChecked();

  state = await userState(email);
  expect(state.profile).toMatchObject({
    full_name: "Estudiante E1",
    bio: "Hola desde E1",
    email_notifications_enabled: false,
    role: "user",
    deleted_at: null,
  });
  expect(state.preferences?.budget_max).toBe(720);

  // 8. Logout desde el nav: vuelve a /login y la sesión anterior no sirve.
  const sessionCookies = (await context.cookies()).filter((c) =>
    c.name.startsWith("sb-")
  );
  await nav.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(`${APP}/login`);
  await page.goto("/perfil");
  expect(pathOf(page)).toBe("/login?next=%2Fperfil");

  const replay = await page.context().browser()!.newContext();
  await replay.addCookies(sessionCookies);
  const replayPage = await replay.newPage();
  await replayPage.goto(`${APP}/perfil`);
  expect(pathOf(replayPage)).toBe("/login?next=%2Fperfil");
  await replay.close();

  // Nada de lo anterior usó otra clave que la anon ni un JWT de service_role:
  // este flujo no guarda el test ni lee candidatos (lo cubre compatibility-flow).
  const log = (await requestLog()).slice(logStart);
  expect(log.length).toBeGreaterThan(0);
  expect(log.every((entry) => entry.bearerRole !== "service_role")).toBe(true);
  expect(
    log
      .filter((entry) => entry.path !== "/auth/v1/verify")
      .every((entry) => entry.apikeyIsAnon)
  ).toBe(true);
});
