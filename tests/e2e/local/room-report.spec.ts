import { expect, test, type Browser } from "@playwright/test";
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

// Fase 7 — reportar un anuncio desde su ficha pública. Hace falta una cuenta
// activa; solo se reporta un anuncio público y ajeno (otro caso: 404); uno
// abierto por persona y anuncio; el admin lo ve en la bandeja y puede
// resolverlo retirando la habitación, con los dos registros.
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

test("reportar un anuncio, sin duplicados, y la retirada desde la bandeja del admin", async ({
  browser,
  page,
}) => {
  const owner = await person(browser, "anuncio-duena", "Dueña Anuncio");
  const room = await seedRoom(owner.email, {
    title: "Ático dudoso",
    status: "active",
    complete: true,
  });
  const draft = await seedRoom(owner.email, { title: "Borrador", complete: true });

  // Sin sesión: el enlace está en la ficha pública y lleva al login.
  await page.goto(`/barcelona/habitaciones/${room}`);
  await page.getByTestId("room-report-link").click();
  await expect(page).toHaveURL(/\/login\?next=%2Freportar%2Fhabitacion%2F/);

  const viewer = await person(browser, "anuncio-reporta", "Quien Reporta");
  await viewer.page.goto(`/barcelona/habitaciones/${room}`);
  await viewer.page.getByTestId("room-report-link").click();
  await expect(viewer.page).toHaveURL(`${APP}/reportar/habitacion/${room}`);
  await expect(viewer.page.getByTestId("room-report-title")).toContainText(
    "Ático dudoso"
  );
  await viewer.page.getByLabel(/Estafa o petición de dinero/).check();
  await viewer.page.getByLabel(/Qué ha pasado/).fill("Pide la fianza por Bizum.");
  await viewer.page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(viewer.page).toHaveURL(
    `${APP}/reportar/habitacion/${room}?aviso=anuncio-reportado`
  );
  await expect(viewer.page.getByTestId("safety-notice")).toContainText("Hemos recibido");

  // Repetirlo no crea otro reporte abierto.
  await viewer.page.getByLabel(/Spam/).check();
  await viewer.page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(viewer.page).toHaveURL(
    `${APP}/reportar/habitacion/${room}?aviso=anuncio-ya-reportado`
  );
  let safety = await safetyState();
  expect(safety.reports).toHaveLength(1);
  expect(safety.reports[0]).toMatchObject({
    reporter_id: viewer.id,
    reported_user_id: null,
    reported_room_id: room,
    reason: "scam",
    description: "Pide la fianza por Bizum.",
    status: "pending",
  });

  // 404 indistinguible: un borrador, un id inventado y el anuncio propio.
  for (const [who, id] of [
    [viewer, draft],
    [viewer, "d0000000-0000-4000-8000-0000000000ff"],
    [owner, room],
  ] as const) {
    const response = await who.page.goto(`/reportar/habitacion/${id}`);
    expect(response?.status()).toBe(404);
  }

  // El admin lo ve en la bandeja y lo resuelve retirando el anuncio.
  const admin = await person(browser, "anuncio-admin", "Admin Anuncios");
  await makeAdmin(admin.email);
  await admin.page.goto("/admin/reportes");
  const item = admin.page.getByTestId("report-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Habitación: Ático dudoso");
  await item.getByLabel("Estado").selectOption("resolved");
  await item.getByLabel(/Medida/).selectOption("remove_room");
  await item.getByLabel(/notas internas/i).fill("Estafa confirmada");
  await item.getByRole("button", { name: "Guardar" }).click();
  await expect(admin.page).toHaveURL(
    `${APP}/admin/reportes?aviso=guardado&vista=cerrados`
  );

  expect((await roomState(room)).room?.status).toBe("removed");
  expect((await page.request.get(`${APP}/barcelona/habitaciones/${room}`)).status()).toBe(
    404
  );
  safety = await safetyState();
  expect(safety.reports[0]).toMatchObject({ status: "resolved", resolved_by: admin.id });
  expect(safety.adminLogs.map((l) => [l.action, l.target_id])).toEqual([
    ["report_resolved", safety.reports[0].id],
    ["room_removed", room],
  ]);

  for (const who of [owner, viewer, admin]) await who.context.close();
});
