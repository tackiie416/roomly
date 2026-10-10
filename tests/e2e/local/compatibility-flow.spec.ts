import { expect, test } from "@playwright/test";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  getCurrentQuestionnaire,
} from "../../../lib/matching/questionnaire";
import {
  APP,
  answerQuestions,
  completeOnboarding,
  loginWithMagicLink,
  pathOf,
  requestLog,
  resetMock,
  seedCandidate,
  seedOwnResponse,
  uniqueEmail,
  userState,
} from "./helpers";

// Fase 3 — E1: onboarding → /test (guardar a medias, retomar, completar) →
// /explorar con candidatos (solo el DTO, sin admins, cuentas eliminadas ni
// presupuestos incompatibles) → editar el test completado. service_role solo
// lo usa el servidor de la app: lectura cruzada y escritura del test. Con la
// versión vigente del cuestionario (la v2, S1–S4); quien solo tiene el test v1
// ve el aviso de actualización y no sale como candidato.
test.describe.configure({ mode: "serial" });

const CURRENT = CURRENT_QUESTIONNAIRE_VERSION;
const IDS = getCurrentQuestionnaire().questions.map((q) => q.id);
const V1_IDS = QUESTIONNAIRE_V1.questions.map((q) => q.id);
/** Ids comunes a la v1 y la vigente (21) y los ocho nuevos de la vigente. */
const SHARED_IDS = IDS.filter((id) => V1_IDS.includes(id));
const NEW_IDS = IDS.filter((id) => !V1_IDS.includes(id));
const REPLACED_IDS = V1_IDS.filter((id) => !IDS.includes(id));

// Un número oculto solo cuenta como filtrado si aparece suelto: los UUID
// aleatorios (ids del DTO, payload RSC) y los hashes de los chunks pueden
// contener «612» o «437» por azar.
const standalone = (value: string) =>
  new RegExp(`(?<![A-Za-z0-9_+/-])${value}(?![A-Za-z0-9_+/])`);

test("test de convivencia y candidatos compatibles", async ({ page }) => {
  // Este test cuenta filas globales (candidatos): parte de un mock vacío
  // para que un reintento no vea los candidatos ni el usuario del intento
  // anterior (E1 corre con un único worker).
  await resetMock();
  const logStart = (await requestLog()).length;
  // Otras personas que ya terminaron (la que mira tiene «hasta 650 €» y
  // ninguna preferencia de barrios ni compañeros).
  // El id sí puede salir (forma parte del DTO: ya es público en
  // public_profile_previews); el resto de la fila, no.
  const match = await seedCandidate({
    name: "Compatible Uno",
    version: CURRENT,
    questionIds: IDS,
    answer: 1,
    birth: "2001-03-15",
    budgetMin: 437,
    budgetMax: 612,
  });
  // 3: válido en las escalas 1–5 y 1–3 (un valor fuera de escala la haría
  // no comparable y el motor la omitiría).
  const lower = await seedCandidate({
    name: "Compatible Dos",
    version: CURRENT,
    questionIds: IDS,
    answer: 3,
  });
  const hiddenSeeds = [
    { name: "Admin Oculta", role: "admin" as const },
    { name: "Eliminada Oculta", deleted: true },
    { name: "Presupuesto Lejano", budgetMin: 900 },
  ];
  for (const seed of hiddenSeeds) {
    await seedCandidate({ ...seed, version: CURRENT, questionIds: IDS });
  }
  // Test completado solo en la v1: desactualizado, no es candidato.
  await seedCandidate({ name: "Version Antigua", version: 1, questionIds: V1_IDS });

  const email = uniqueEmail("test-compat");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Exploradora E1");
  await expect(page.getByRole("heading", { name: "Test de convivencia" })).toBeVisible();

  // Sin test, /explorar lleva a /test.
  await page.goto("/explorar");
  await expect(page).toHaveURL(`${APP}/test`);

  // Guardar a medias.
  await answerQuestions(page, IDS.slice(0, 3), 1);
  await page.getByRole("button", { name: "Guardar respuestas" }).click();
  await expect(
    page.getByText("Progreso guardado. Te faltan 26 preguntas para terminar.")
  ).toBeVisible();
  let state = await userState(email);
  expect(state.compatibility).toMatchObject({
    questionnaire_version: CURRENT,
    completed_at: null,
  });
  expect(Object.keys(state.compatibility?.answers as object)).toHaveLength(3);

  // Con un borrador, /explorar sigue llevando a /test; al volver, lo guardado sigue marcado.
  await page.goto("/explorar");
  await expect(page).toHaveURL(`${APP}/test`);
  await expect(page.getByText("Llevas 3 de 29 preguntas.")).toBeVisible();
  await expect(page.locator(`input[name="${IDS[0]}"][value="1"]`)).toBeChecked();

  // Completar → /explorar.
  await answerQuestions(page, IDS.slice(3), 1);
  await page.getByRole("button", { name: "Guardar respuestas" }).click();
  await expect(page).toHaveURL(`${APP}/explorar`);
  state = await userState(email);
  const completedAt = state.compatibility?.completed_at;
  expect(completedAt).not.toBeNull();

  // Candidatos: solo los compatibles, por score; nada fuera del DTO.
  const cards = page.getByTestId("candidate");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Compatible Uno");
  await expect(cards.nth(0)).toContainText("100%");
  await expect(cards.nth(0)).toContainText("400–650 € al mes");
  await expect(cards.nth(0)).toContainText("Por qué encajáis");
  await expect(cards.nth(1)).toContainText("Compatible Dos");
  await expect(cards.nth(1)).toContainText("Posibles diferencias");
  // HTML recién servido de /explorar (con navegación de cliente, el DOM
  // conserva el payload de /test: la definición pública del cuestionario y
  // las respuestas propias, que no son datos de otras personas).
  const html = await (await page.request.get(`${APP}/explorar`)).text();
  expect(html).toContain("Compatible Uno");
  expect(html).toContain(match);
  expect(html).toContain(lower);
  for (const hidden of [
    "Admin Oculta",
    "Eliminada Oculta",
    "Presupuesto Lejano",
    "Version Antigua",
    "2001-03-15",
    "clean_frequency",
    "categoryScores",
  ]) {
    expect(html).not.toContain(hidden);
  }
  for (const hidden of ["437", "612"]) {
    expect(html).not.toMatch(standalone(hidden));
  }
  // Fase 3: sin «Ver perfil» ni «Me interesa».
  await expect(page.getByText("Ver perfil")).toHaveCount(0);
  await expect(page.getByText("Me interesa")).toHaveCount(0);

  // Paginación: fuera de rango → aviso; inválida → página 1.
  await page.goto("/explorar?pagina=99");
  await expect(page.getByText("Esta página no existe.")).toBeVisible();
  await page.goto("/explorar?pagina=abc");
  await expect(page.getByTestId("candidate")).toHaveCount(2);

  // Editar el test completado: vuelve a /explorar y la fecha no cambia (D7.2).
  await page.goto("/test");
  await expect(page.getByText("Ya has completado el test.")).toBeVisible();
  await page.locator(`input[name="${IDS[1]}"][value="3"]`).check();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(`${APP}/explorar`);
  state = await userState(email);
  expect(state.compatibility?.completed_at).toBe(completedAt);
  expect(state.compatibility?.questionnaire_version).toBe(CURRENT);
  expect((state.compatibility?.answers as Record<string, number>)[IDS[1]]).toBe(3);

  // service_role: solo el servidor, solo lectura cruzada de perfiles y
  // escritura del test. El usuario solo lee su fila del test.
  const log = (await requestLog()).slice(logStart);
  const service = log.filter((entry) => entry.apikeyIsService);
  expect(service.length).toBeGreaterThan(0);
  expect(service.every((entry) => entry.bearerRole === "service_role")).toBe(true);
  for (const entry of service) {
    expect(
      (entry.method === "GET" && entry.path === "/rest/v1/profiles") ||
        (["POST", "PATCH"].includes(entry.method) &&
          entry.path === "/rest/v1/compatibility_responses")
    ).toBe(true);
  }
  const userTest = log.filter(
    (entry) => !entry.apikeyIsService && entry.path === "/rest/v1/compatibility_responses"
  );
  expect(userTest.length).toBeGreaterThan(0);
  expect(userTest.every((entry) => entry.method === "GET")).toBe(true);
});

test("test v1 completado: aviso, se conservan las 21 respuestas comunes y se completa la v2", async ({
  page,
}) => {
  expect(SHARED_IDS).toHaveLength(21);
  expect(NEW_IDS).toHaveLength(8);
  const email = uniqueEmail("test-v1");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Test Antiguo");
  // El test se completó en la v1 (2 es válido en las escalas 1–3 y 1–5).
  await seedOwnResponse(email, {
    version: 1,
    questionIds: V1_IDS,
    answer: 2,
    completed: true,
  });

  // Desactualizado: /explorar lleva a /test, que avisa del cambio.
  await page.goto("/explorar");
  await expect(page).toHaveURL(`${APP}/test`);
  await expect(page.getByText("Hemos actualizado el test.")).toBeVisible();
  // Las 21 comunes, marcadas con lo de la v1; las ocho nuevas, sin responder;
  // los ocho ids de la v1 sustituidos no están en el formulario.
  for (const id of SHARED_IDS) {
    await expect(page.locator(`input[name="${id}"][value="2"]`)).toBeChecked();
  }
  for (const id of NEW_IDS) {
    await expect(page.locator(`input[name="${id}"]:checked`)).toHaveCount(0);
  }
  for (const id of REPLACED_IDS) {
    await expect(page.locator(`input[name="${id}"]`)).toHaveCount(0);
  }

  // Siete de las ocho nuevas → borrador de la v2; falta una.
  await answerQuestions(page, NEW_IDS.slice(0, 7), 1);
  await page.getByRole("button", { name: "Guardar respuestas" }).click();
  await expect(
    page.getByText("Progreso guardado. Te falta 1 pregunta para terminar.")
  ).toBeVisible();
  let state = await userState(email);
  expect(state.compatibility).toMatchObject({
    questionnaire_version: CURRENT,
    completed_at: null,
  });
  let answers = state.compatibility?.answers as Record<string, number>;
  expect(Object.keys(answers)).toHaveLength(28);
  for (const id of REPLACED_IDS) expect(answers).not.toHaveProperty(id);
  await page.goto("/explorar");
  await expect(page).toHaveURL(`${APP}/test`);
  await expect(page.getByText("Llevas 28 de 29 preguntas.")).toBeVisible();

  // La última → completado en la v2 y /explorar.
  await answerQuestions(page, NEW_IDS.slice(7), 1);
  await page.getByRole("button", { name: "Guardar respuestas" }).click();
  await expect(page).toHaveURL(`${APP}/explorar`);
  state = await userState(email);
  expect(state.compatibility?.questionnaire_version).toBe(CURRENT);
  expect(state.compatibility?.completed_at).not.toBeNull();
  answers = state.compatibility?.answers as Record<string, number>;
  expect(Object.keys(answers).sort()).toEqual([...IDS].sort());
  for (const id of SHARED_IDS) expect(answers[id]).toBe(2);
  for (const id of NEW_IDS) expect(answers[id]).toBe(1);
});

test("el test funciona sin JavaScript", async ({ page, browser }) => {
  const email = uniqueEmail("test-sin-js");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Sin JS Test");

  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();
  await p.goto(`${APP}/test`);
  await answerQuestions(p, IDS, 2);
  await p.getByRole("button", { name: "Guardar respuestas" }).click();
  await expect(p).toHaveURL(`${APP}/explorar`);
  expect(pathOf(p)).toBe("/explorar");
  const state = await userState(email);
  expect(state.compatibility?.completed_at).not.toBeNull();
  await noJs.close();
});
