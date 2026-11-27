import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  APP,
  completeOnboarding,
  loginWithMagicLink,
  makeAdmin,
  resetMock,
  roomState,
  safetyState,
  seedRoom,
  uniqueEmail,
  userState,
} from "./helpers";

// Fase 7 — panel de administración en E1 (Supabase simulado). El mock emula
// 20261129120000: las políticas de admin son solo de lectura y toda acción
// pasa por rpc/admin_* (is_admin() y registro en admin_action_logs). Quien no
// es admin no entra en ninguna sección; el admin suspende, reactiva, retira y
// restaura con motivo y confirmación, y cada acción queda registrada.
// No es el E2 real: no hay Supabase de verdad.

test.beforeEach(async () => {
  await resetMock();
});

async function person(browser: Browser, label: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = uniqueEmail(label);
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, name);
  const id = (await userState(email)).profile?.id as string;
  return { context, page, email, id };
}

async function confirmAction(page: Page, form: string, reason: string) {
  await page.locator(`#${form}-reason`).fill(reason);
  await page.locator(`#${form}-confirm`).check();
  await page.getByTestId(`${form}-submit`).click();
}

test("quien no es admin no entra en ninguna sección del panel", async ({ browser }) => {
  const user = await person(browser, "admin-intrusa", "Persona Normal");
  const other = await person(browser, "admin-objetivo", "Otra Persona");
  const room = await seedRoom(other.email, {
    title: "Ajena",
    status: "active",
    complete: true,
  });
  for (const path of [
    "/admin",
    "/admin/usuarios",
    `/admin/usuarios/${other.id}`,
    "/admin/habitaciones",
    `/admin/habitaciones/${room}`,
    "/admin/reportes",
    "/admin/metricas",
  ]) {
    const response = await user.page.goto(path);
    expect(new URL(user.page.url()).pathname, path).not.toMatch(/^\/admin/);
    expect(await response?.text(), path).not.toContain("Otra Persona");
  }
  // Nada cambió: ni la cuenta ni la habitación, y no hay registro.
  expect((await userState(other.email)).profile?.deleted_at).toBeNull();
  expect((await roomState(room)).room?.status).toBe("active");
  expect((await safetyState()).adminLogs).toEqual([]);
  for (const who of [user, other]) await who.context.close();
});

test("un admin busca, suspende y reactiva una cuenta; no puede suspenderse a sí mismo", async ({
  browser,
}) => {
  const admin = await person(browser, "admin-usuarios", "Admin Usuarios");
  await makeAdmin(admin.email);
  const target = await person(browser, "admin-suspendida", "Zoe Suspendida");

  await admin.page.goto("/admin");
  await admin.page.getByTestId("admin-users-link").click();
  await expect(admin.page).toHaveURL(`${APP}/admin/usuarios`);
  const filters = admin.page.getByTestId("admin-users-filters");
  await filters.getByLabel("Nombre").fill("zoe susp");
  await filters.getByRole("button", { name: /Filtrar|Buscar/ }).click();
  const rows = admin.page.getByTestId("admin-user-row");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Zoe Suspendida");
  await expect(rows).toContainText("Activa");
  await expect(admin.page.getByTestId("admin-users-list")).not.toContainText("@");
  await rows.getByRole("link").click();
  await expect(admin.page).toHaveURL(`${APP}/admin/usuarios/${target.id}`);

  // Sin la casilla (quitando `required` en el navegador): el servidor la exige.
  await admin.page.locator("#admin-suspend-form-reason").fill("Spam reiterado");
  await admin.page
    .locator("#admin-suspend-form-confirm")
    .evaluate((input: HTMLInputElement) => input.removeAttribute("required"));
  await admin.page.getByTestId("admin-suspend-form-submit").click();
  await expect(admin.page).toHaveURL(`${APP}/admin/usuarios/${target.id}?aviso=invalido`);
  expect((await userState(target.email)).profile?.deleted_at).toBeNull();

  await confirmAction(admin.page, "admin-suspend-form", "Spam reiterado");
  await expect(admin.page).toHaveURL(
    `${APP}/admin/usuarios/${target.id}?aviso=suspendida`
  );
  await expect(admin.page.getByTestId("admin-notice")).toContainText("Cuenta suspendida");
  await expect(admin.page.getByTestId("admin-history")).toContainText("Spam reiterado");
  expect((await userState(target.email)).profile?.deleted_at).not.toBeNull();

  // La persona suspendida sale de la app.
  await target.page.goto("/perfil");
  await expect(target.page).toHaveURL(/\/cuenta-desactivada/);

  await confirmAction(admin.page, "admin-reactivate-form", "Revisado: era un error");
  await expect(admin.page).toHaveURL(
    `${APP}/admin/usuarios/${target.id}?aviso=reactivada`
  );
  expect((await userState(target.email)).profile?.deleted_at).toBeNull();
  expect((await safetyState()).adminLogs).toEqual([
    expect.objectContaining({
      admin_id: admin.id,
      action: "user_suspended",
      target_id: target.id,
    }),
    expect.objectContaining({
      admin_id: admin.id,
      action: "user_reactivated",
      target_id: target.id,
    }),
  ]);

  // Su propia ficha no ofrece suspenderse.
  await admin.page.goto(`/admin/usuarios/${admin.id}`);
  await expect(admin.page.getByTestId("admin-suspend-form")).toHaveCount(0);

  // Un id inventado o mal formado: 404, sin pistas.
  for (const id of ["d0000000-0000-4000-8000-0000000000ff", "no-es-un-id"]) {
    const response = await admin.page.goto(`/admin/usuarios/${id}`);
    expect(response?.status()).toBe(404);
  }
  for (const who of [admin, target]) await who.context.close();
});

test("un admin retira y restaura una habitación, con su registro, y ve las métricas", async ({
  browser,
}) => {
  const admin = await person(browser, "admin-habitaciones", "Admin Habitaciones");
  await makeAdmin(admin.email);
  const owner = await person(browser, "admin-duena", "Dueña Retirada");
  const room = await seedRoom(owner.email, {
    title: "Habitación dudosa",
    status: "active",
    complete: true,
  });
  expect(
    (await admin.page.request.get(`${APP}/barcelona/habitaciones/${room}`)).status()
  ).toBe(200);

  await admin.page.goto("/admin/habitaciones?estado=active");
  const row = admin.page
    .getByTestId("admin-room-row")
    .filter({ hasText: "Habitación dudosa" });
  await expect(row).toHaveCount(1);
  await row.getByRole("link").first().click();
  await expect(admin.page).toHaveURL(`${APP}/admin/habitaciones/${room}`);

  await confirmAction(admin.page, "admin-remove-form", "Anuncio engañoso");
  await expect(admin.page).toHaveURL(`${APP}/admin/habitaciones/${room}?aviso=retirada`);
  await expect(admin.page.getByTestId("admin-room-status")).toContainText(/Retirada/i);
  expect((await roomState(room)).room?.status).toBe("removed");
  expect(
    (await admin.page.request.get(`${APP}/barcelona/habitaciones/${room}`)).status()
  ).toBe(404);

  // La propietaria no puede volver a publicarla por su cuenta.
  await owner.page.goto(`/habitaciones/${room}/editar`);
  await expect(owner.page.getByRole("button", { name: "Publicar" })).toHaveCount(0);

  await confirmAction(admin.page, "admin-restore-form", "Corregido por la dueña");
  await expect(admin.page).toHaveURL(
    `${APP}/admin/habitaciones/${room}?aviso=restaurada`
  );
  expect((await roomState(room)).room?.status).toBe("paused");
  const logs = (await safetyState()).adminLogs.filter((l) => l.target_id === room);
  expect(logs.map((l) => l.action)).toEqual(["room_removed", "room_restored"]);

  await admin.page.goto("/admin/metricas");
  for (const id of [
    "metrics-users",
    "metrics-rooms",
    "metrics-activity",
    "metrics-safety",
  ])
    await expect(admin.page.getByTestId(id)).toBeVisible();
  await expect(admin.page.locator("main")).not.toContainText("@");

  for (const who of [admin, owner]) await who.context.close();
});
