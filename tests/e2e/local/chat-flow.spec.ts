import { expect, test } from "@playwright/test";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "../../../lib/matching/questionnaire";
import {
  APP,
  answerQuestions,
  appNav,
  chatState,
  completeOnboarding,
  interestsState,
  loginWithMagicLink,
  requestLog,
  resetMock,
  seedCandidate,
  seedInterest,
  seedMessage,
  seedRoom,
  uniqueEmail,
  userState,
} from "./helpers";

// Fase 6 — E1: chat entre matches (abrir desde /matches, enviar sin
// duplicar, mensajes de la otra persona, 404 para terceros, deshacer el match
// cierra el chat) e interés por habitación (la identidad solo en /matches).
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

test("match → chat, enviar, recibir, terceros fuera y deshacer el match", async ({
  page,
  browser,
}) => {
  await resetMock();
  const logStart = (await requestLog()).length;
  const berta = await seedCandidate({
    name: "Berta Chat",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
  });
  const email = await viewerWithTest(page, "chat");
  const viewerId = (await userState(email)).profile?.id as string;

  // Sin match todavía: /mensajes vacía.
  await appNav(page).getByRole("link", { name: "Mensajes" }).click();
  await expect(page).toHaveURL(`${APP}/mensajes`);
  await expect(page.getByTestId("conversations-empty")).toBeVisible();

  // Match mutuo: la base de datos abre la conversación.
  expect(await seedInterest(berta, email)).toBe("sent");
  await page.goto("/explorar");
  await page
    .getByTestId("candidate")
    .filter({ hasText: "Berta Chat" })
    .getByRole("button", { name: /^Hacer match/ })
    .click();
  await expect(page).toHaveURL(`${APP}/explorar?aviso=match`);
  let chat = await chatState();
  expect(chat.conversations).toHaveLength(1);
  const conversationId = chat.conversations[0].id;
  expect(chat.participants.map((p) => p.user_id).sort()).toEqual(
    [viewerId, berta].sort()
  );

  // /matches → «Abrir chat».
  await page.goto("/matches");
  await page.getByTestId("open-chat").click();
  await expect(page).toHaveURL(`${APP}/mensajes/${conversationId}`);
  await expect(page.getByTestId("chat-title")).toContainText("Berta Chat");
  await expect(page.getByTestId("chat-empty")).toBeVisible();

  // Enviar: aparece como propio; el HTML se escapa.
  await page.getByLabel(/Mensaje para/).fill("Hola <b>Berta</b>, ¿quedamos?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page).toHaveURL(`${APP}/mensajes/${conversationId}#ultimo`);
  await expect(page.getByTestId("message-mine")).toHaveCount(1);
  await expect(page.getByTestId("message-mine")).toContainText(
    "Hola <b>Berta</b>, ¿quedamos?"
  );
  await expect(page.getByLabel(/Mensaje para/)).toHaveValue("");

  // Un solo mensaje guardado, y el formulario trae un clientToken nuevo (la
  // deduplicación de un reenvío la prueban tests/db/27 y services-chat).
  const token = await page.locator('input[name="clientToken"]').inputValue();
  chat = await chatState();
  expect(chat.messages).toHaveLength(1);
  expect(chat.messages[0]).toMatchObject({
    sender_id: viewerId,
    conversation_id: conversationId,
  });
  expect(token).toMatch(/^[0-9a-f-]{36}$/);

  // Un mensaje de Berta: aparece al pulsar «Actualizar».
  expect(await seedMessage(berta, conversationId, "¡Claro! El sábado.")).toBe(200);
  await page.getByTestId("chat-refresh").click();
  await expect(page.getByTestId("message-theirs")).toContainText("¡Claro! El sábado.");
  const order = await page.getByTestId("chat-messages").locator("li").allInnerTexts();
  expect(order.join("\n").indexOf("quedamos")).toBeLessThan(
    order.join("\n").indexOf("El sábado")
  );

  // Vacío o demasiado largo: aviso, sin mensaje nuevo (lo valida el servidor).
  const long = await page.request.get(`${APP}/mensajes/${conversationId}?aviso=largo`);
  expect(await long.text()).toContain("2000");

  // Una tercera persona con su sesión: 404, sin el contenido.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await viewerWithTest(otherPage, "tercera");
  const intruder = await otherPage.request.get(`${APP}/mensajes/${conversationId}`);
  expect(intruder.status()).toBe(404);
  expect(await intruder.text()).not.toContain("quedamos");
  await otherPage.goto("/mensajes");
  await expect(otherPage.getByTestId("conversations-empty")).toBeVisible();
  await other.close();

  // Deshacer el match desde el chat: se cierra para las dos personas.
  await page.getByTestId("undo-match").locator("summary").click();
  await page.getByRole("button", { name: /^Sí, deshacer el match/ }).click();
  await expect(page).toHaveURL(`${APP}/matches?aviso=deshecho`);
  await expect(page.getByTestId("interest-notice")).toContainText(
    "Has deshecho el match"
  );
  await expect(page.getByTestId("person-matched")).toHaveCount(0);
  const closed = await page.request.get(`${APP}/mensajes/${conversationId}`);
  expect(closed.status()).toBe(404);
  chat = await chatState();
  expect(chat.conversations[0].closed_at).not.toBeNull();
  expect((await interestsState()).matches).toEqual([]);
  // Berta tampoco puede escribir ya.
  expect(await seedMessage(berta, conversationId, "¿Hola?")).toBe(400);
  expect((await chatState()).messages).toHaveLength(2);

  // service_role: nunca en las tablas del chat; el usuario solo lee, envía
  // mensajes y marca lo leído.
  const log = (await requestLog()).slice(logStart);
  const chatPaths = [
    "/rest/v1/conversations",
    "/rest/v1/conversation_participants",
    "/rest/v1/messages",
  ];
  expect(log.some((e) => e.apikeyIsService && chatPaths.includes(e.path))).toBe(false);
  for (const entry of log.filter((e) => chatPaths.includes(e.path))) {
    expect(
      entry.method === "GET" ||
        (entry.method === "POST" && entry.path === "/rest/v1/messages") ||
        (entry.method === "PATCH" && entry.path === "/rest/v1/conversation_participants")
    ).toBe(true);
  }
  expect(log.some((e) => e.apikeyIsService && e.path === "/rest/v1/rpc/undo_match")).toBe(
    true
  );
});

test("interés por habitación: la identidad solo en /matches", async ({ page }) => {
  const ownerEmail = uniqueEmail("propietaria");
  const owner = await seedCandidate({
    name: "Olga Propietaria",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
    budgetMin: 2000, // no pasaría los filtros duros: el interés va por la habitación
    email: ownerEmail,
  });
  const roomId = await seedRoom(ownerEmail, {
    title: "Habitación con balcón",
    status: "active",
    complete: true,
  });
  const detailPath = `/barcelona/habitaciones/${roomId}`;
  // El detalle público no nombra a la propietaria (tampoco con sesión).
  const anonymous = await page.request.get(`${APP}${detailPath}`);
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.text()).not.toContain("Olga");

  await viewerWithTest(page, "habitacion");
  await page.goto(detailPath);
  await expect(page.getByText("Olga Propietaria")).toHaveCount(0);
  await page.getByRole("button", { name: "Me interesa esta habitación" }).click();
  await expect(page).toHaveURL(`${APP}/matches?aviso=habitacion-enviado`);
  const sent = page.getByTestId("person-sent").filter({ hasText: "Olga Propietaria" });
  await expect(sent).toHaveCount(1);
  await expect(sent.getByTestId("room-context")).toContainText("Habitación con balcón");
  const db = await interestsState();
  expect(db.interests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ to_user_id: owner, room_id: roomId }),
    ])
  );
  // Repetirlo no crea otro interés.
  await page.goto(detailPath);
  await page.getByRole("button", { name: "Me interesa esta habitación" }).click();
  await expect(page).toHaveURL(`${APP}/matches?aviso=habitacion-ya-enviado`);
  expect(
    (await interestsState()).interests.filter((i) => i.to_user_id === owner)
  ).toHaveLength(1);
});
