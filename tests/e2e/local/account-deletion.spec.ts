import { expect, test } from "@playwright/test";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "../../../lib/matching/questionnaire";
import {
  APP,
  accountDeletionState,
  completeOnboarding,
  deactivateAccount,
  loginWithMagicLink,
  resetMock,
  roomState,
  seedCandidate,
  seedChat,
  seedRoom,
  uniqueEmail,
  userState,
} from "./helpers";

// Sesión 87 — exportación con los mensajes propios (también de chats
// cerrados) y eliminación de la cuenta desde /ajustes, contra el Supabase
// simulado. No es el E2 real: el mock emula las funciones de
// 20261201120000, la API de administración de Auth y Storage.
test.describe.configure({ mode: "serial" });

const IDS = getCurrentQuestionnaire().questions.map((q) => q.id);
const candidate = (name: string) =>
  seedCandidate({ name, version: CURRENT_QUESTIONNAIRE_VERSION, questionIds: IDS });

test.beforeEach(async () => {
  await resetMock();
});

test("exportar: mis mensajes de chats abiertos y cerrados, sin los de la otra persona", async ({
  page,
}) => {
  const berta = await candidate("Berta Export");
  const carla = await candidate("Carla Export");
  const email = uniqueEmail("export-chats");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Nora Mensajes");
  const me = (await userState(email)).profile?.id as string;
  await seedChat(me, berta, { fromA: "Mío abierto", fromB: "Suyo abierto" });
  await seedChat(me, carla, {
    fromA: "Mío cerrado",
    fromB: "Suyo cerrado",
    closed: true,
  });

  const response = await page.request.get(`${APP}/ajustes/mis-datos`);
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.version).toBe(2);
  expect(data.messagesSent).toEqual([
    expect.objectContaining({
      conversationNumber: 1,
      conversationClosed: false,
      content: "Mío abierto",
    }),
    expect.objectContaining({
      conversationNumber: 2,
      conversationClosed: true,
      content: "Mío cerrado",
    }),
  ]);
  const text = JSON.stringify(data);
  expect(text).not.toContain("Suyo");
  expect(text).not.toContain(berta);
  expect(text).not.toContain(carla);
  expect(text).not.toMatch(/access_token|refresh_token|resolution_notes|storage_path/);
});

test("eliminar la cuenta: confirmación, Storage, datos, Auth y sesión", async ({
  page,
  browser,
}) => {
  const berta = await candidate("Berta Queda");
  const email = uniqueEmail("eliminar");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Olga Se Va");
  const me = (await userState(email)).profile?.id as string;
  const roomId = await seedRoom(email, { title: "Habitación que se va", photos: 2 });
  expect((await roomState(roomId)).objects).toHaveLength(2);
  await seedChat(me, berta, { fromA: "Me voy", fromB: "Yo me quedo" });

  // Sin sesión, la página lleva al login.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${APP}/ajustes/eliminar-cuenta`);
  await expect(anonPage).toHaveURL(/\/login/);
  await anon.close();

  await page.goto("/ajustes");
  await page.getByTestId("account-deletion-link").click();
  await expect(page).toHaveURL(`${APP}/ajustes/eliminar-cuenta`);
  await expect(page.getByRole("heading", { name: "Eliminar tu cuenta" })).toBeVisible();

  // La confirmación la exige el servidor (sin required del navegador).
  await page.evaluate(() =>
    document
      .querySelectorAll("[data-testid=account-deletion-form] [required]")
      .forEach((el) => el.removeAttribute("required"))
  );
  await page.getByLabel(/Escribe ELIMINAR/).fill("borrar");
  await page.getByTestId("account-deletion-submit").click();
  await expect(page).toHaveURL(`${APP}/ajustes/eliminar-cuenta?aviso=confirmacion`);
  await expect(page.getByTestId("account-deletion-notice")).toContainText("ELIMINAR");
  let state = await accountDeletionState(me);
  expect(state.userExists).toBe(true);
  expect(state.request).toBeNull();
  expect(state.profile?.deleted_at).toBeNull();

  // Confirmado: se elimina todo y la sesión deja de valer.
  await page.getByLabel(/Escribe ELIMINAR/).fill("eliminar");
  await page.getByLabel("Entiendo que la eliminación es definitiva.").check();
  await page.getByTestId("account-deletion-submit").click();
  await expect(page).toHaveURL(`${APP}/cuenta-eliminada`);
  await expect(
    page.getByRole("heading", { name: "Tu cuenta se ha eliminado" })
  ).toBeVisible();

  state = await accountDeletionState(me);
  expect(state.userExists).toBe(false);
  expect(state.profile).toBeNull();
  expect(state.activeSessions).toBe(0);
  expect(state.request?.completed_at).toBeTruthy();
  expect(state.rooms).toBe(0);
  expect(state.objects.filter((path) => path.startsWith(`${roomId}/`))).toEqual([]);
  // Sus mensajes se borran; los de la otra persona quedan en un chat cerrado.
  expect(state.messages).toEqual([{ sender_id: berta, content: "Yo me quedo" }]);
  expect(state.conversations).toEqual([expect.objectContaining({ closed: true })]);

  // Ya no puede entrar en zonas privadas.
  await page.goto("/ajustes");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/ajustes/mis-datos");
  await expect(page).toHaveURL(/\/login/);
});

test("una cuenta desactivada también puede eliminarse", async ({ page }) => {
  const email = uniqueEmail("eliminar-desactivada");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Pau Desactivada");
  const me = (await userState(email)).profile?.id as string;
  await deactivateAccount(email);
  await page.goto("/cuenta-desactivada");
  await page.getByTestId("account-deletion-link").click();
  await expect(page).toHaveURL(`${APP}/ajustes/eliminar-cuenta`);
  await page.getByLabel(/Escribe ELIMINAR/).fill("ELIMINAR");
  await page.getByLabel("Entiendo que la eliminación es definitiva.").check();
  await page.getByTestId("account-deletion-submit").click();
  await expect(page).toHaveURL(`${APP}/cuenta-eliminada`);
  expect((await accountDeletionState(me)).userExists).toBe(false);
});
