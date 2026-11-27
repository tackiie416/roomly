import { expect, test } from "@playwright/test";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "../../../lib/matching/questionnaire";
import {
  APP,
  answerQuestions,
  chatState,
  completeOnboarding,
  interestsState,
  loginWithMagicLink,
  makeAdmin,
  resetMock,
  safetyState,
  seedCandidate,
  seedInterest,
  trySeedInterest,
  uniqueEmail,
  userState,
} from "./helpers";

// Sesión 83 — E1: bloquear desde el chat (cierra el chat, oculta a la persona
// y deshace el match; desbloquear no devuelve nada), reportar desde el perfil
// (sin duplicados, 404 para desconocidos) y la revisión de un admin.
test.describe.configure({ mode: "serial" });

const IDS = getCurrentQuestionnaire().questions.map((q) => q.id);

async function viewerWithTest(page: import("@playwright/test").Page, label: string) {
  const email = uniqueEmail(label);
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, `Viewer ${label}`);
  await answerQuestions(page, IDS, 1);
  await page.getByRole("button", { name: "Guardar respuestas" }).click();
  await expect(page).toHaveURL(`${APP}/explorar?test=completado`);
  return email;
}

test("bloquear desde el chat: lo cierra, oculta a la persona y desbloquear no restaura", async ({
  page,
}) => {
  await resetMock();
  const berta = await seedCandidate({
    name: "Berta Bloqueo",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
  });
  const email = await viewerWithTest(page, "bloqueo");
  const viewerId = (await userState(email)).profile?.id as string;

  // Match mutuo y chat abierto.
  expect(await seedInterest(berta, email)).toBe("sent");
  await page.goto("/explorar");
  await page
    .getByTestId("candidate")
    .filter({ hasText: "Berta Bloqueo" })
    .getByRole("button", { name: /^Hacer match/ })
    .click();
  await expect(page).toHaveURL(`${APP}/explorar?aviso=match`);
  const conversationId = (await chatState()).conversations[0].id;
  await page.goto(`/mensajes/${conversationId}`);

  // Bloquear desde el chat, con confirmación.
  await page.getByTestId("block-user").locator("summary").click();
  await page.getByRole("button", { name: /^Sí, bloquear/ }).click();
  await expect(page).toHaveURL(`${APP}/ajustes/bloqueos?aviso=bloqueado`);
  await expect(page.getByTestId("safety-notice")).toContainText("No se le avisa");
  await expect(page.getByTestId("blocked-person")).toContainText("Berta Bloqueo");

  // El match, los intereses y el chat ya no existen para ninguna de las dos.
  const db = await interestsState();
  expect(db.matches).toEqual([]);
  expect(db.interests).toEqual([]);
  expect((await chatState()).conversations[0].closed_at).not.toBeNull();
  expect((await safetyState()).blocks).toEqual([
    expect.objectContaining({ blocker_id: viewerId, blocked_id: berta }),
  ]);
  expect((await page.request.get(`${APP}/mensajes/${conversationId}`)).status()).toBe(
    404
  );
  expect((await page.request.get(`${APP}/explorar/${berta}`)).status()).toBe(404);
  await page.goto("/explorar");
  await expect(
    page.getByTestId("candidate").filter({ hasText: "Berta Bloqueo" })
  ).toHaveCount(0);

  // Mientras dura el bloqueo, Berta no puede enviar un interés (la base de datos).
  expect(await trySeedInterest(berta, email)).toBe("23514");
  expect((await interestsState()).interests).toEqual([]);

  // Desde Ajustes → Personas bloqueadas, desbloquear.
  await page.goto("/ajustes");
  await page.getByTestId("blocked-link").click();
  await expect(page).toHaveURL(`${APP}/ajustes/bloqueos`);
  await page.getByRole("button", { name: /^Desbloquear/ }).click();
  await expect(page).toHaveURL(`${APP}/ajustes/bloqueos?aviso=desbloqueado`);
  await expect(page.getByTestId("blocked-empty")).toBeVisible();
  // Vuelve a salir en Explorar, pero sin match ni chat.
  await page.goto("/explorar");
  await expect(
    page.getByTestId("candidate").filter({ hasText: "Berta Bloqueo" })
  ).toHaveCount(1);
  expect((await interestsState()).matches).toEqual([]);
  expect((await page.request.get(`${APP}/mensajes/${conversationId}`)).status()).toBe(
    404
  );
});

test("reportar desde el perfil, sin duplicados, y la revisión de un admin", async ({
  page,
  browser,
}) => {
  await resetMock();
  const carla = await seedCandidate({
    name: "Carla Reporte",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
  });
  const email = await viewerWithTest(page, "reporta");
  const viewerId = (await userState(email)).profile?.id as string;

  // A alguien que no conoces por la app no se le puede reportar: 404.
  const stranger = await page.request.get(
    `${APP}/reportar/d0000000-0000-4000-8000-0000000000ff`
  );
  expect(stranger.status()).toBe(404);

  // Desde «Ver perfil».
  await page.goto(`/explorar/${carla}`);
  await page.getByTestId("report-link").click();
  await expect(page).toHaveURL(`${APP}/reportar/${carla}`);
  await expect(page.getByTestId("report-title")).toContainText("Carla Reporte");
  await page.getByLabel("Acoso, amenazas o insultos").check();
  await page.getByLabel(/Qué ha pasado/).fill("Mensajes ofensivos.");
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(page).toHaveURL(`${APP}/reportar/${carla}?aviso=reportado`);

  // Repetirlo no crea otro reporte abierto.
  await page.getByLabel("Spam o publicidad").check();
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(page).toHaveURL(`${APP}/reportar/${carla}?aviso=ya-reportado`);
  let safety = await safetyState();
  expect(safety.reports).toHaveLength(1);
  expect(safety.reports[0]).toMatchObject({
    reporter_id: viewerId,
    reported_user_id: carla,
    reason: "harassment",
    description: "Mensajes ofensivos.",
    status: "pending",
  });

  // Quien no es admin no entra en la revisión.
  await page.goto("/admin/reportes");
  await expect(page).not.toHaveURL(/\/admin\/reportes/);

  // Un admin lo ve y lo resuelve; queda en el registro de admin.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const adminEmail = uniqueEmail("admin-reportes");
  await loginWithMagicLink(admin, adminEmail);
  await completeOnboarding(admin, "Admin Reportes");
  await makeAdmin(adminEmail);
  const adminId = (await userState(adminEmail)).profile?.id as string;
  await admin.goto("/admin");
  await admin.getByTestId("admin-reports-link").click();
  await expect(admin).toHaveURL(`${APP}/admin/reportes`);
  const item = admin.getByTestId("report-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Mensajes ofensivos.");
  await expect(item.getByTestId("report-reported")).toContainText("Carla Reporte");
  await item.getByLabel("Estado").selectOption("resolved");
  await item.getByLabel(/Notas internas/).fill("Revisado");
  await item.getByRole("button", { name: "Guardar" }).click();
  await expect(admin).toHaveURL(`${APP}/admin/reportes?aviso=guardado&vista=cerrados`);
  await expect(admin.getByTestId("report-item")).toHaveCount(1);
  safety = await safetyState();
  expect(safety.reports[0]).toMatchObject({ status: "resolved", resolved_by: adminId });
  expect(safety.adminLogs).toEqual([
    expect.objectContaining({
      admin_id: adminId,
      action: "report_resolved",
      target_id: safety.reports[0].id,
    }),
  ]);
  await adminContext.close();

  // Con el anterior resuelto, reportar y bloquear a la vez.
  await page.goto(`/reportar/${carla}`);
  await page.getByLabel("Perfil falso o suplantación").check();
  await page.getByLabel(/Bloquear también/).check();
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(page).toHaveURL(`${APP}/ajustes/bloqueos?aviso=bloqueado-reportado`);
  safety = await safetyState();
  expect(safety.reports).toHaveLength(2);
  expect(safety.blocks).toEqual([
    expect.objectContaining({ blocker_id: viewerId, blocked_id: carla }),
  ]);
});
