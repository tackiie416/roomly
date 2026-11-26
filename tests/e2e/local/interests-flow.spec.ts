import { expect, test, type Page } from "@playwright/test";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "../../../lib/matching/questionnaire";
import {
  APP,
  answerQuestions,
  appNav,
  completeOnboarding,
  interestsState,
  loginWithMagicLink,
  requestLog,
  resetMock,
  seedCandidate,
  seedInterest,
  uniqueEmail,
  userState,
} from "./helpers";

// Fase 5.1 — E1: «Me interesa» desde /explorar, match mutuo y /matches.
// Los intereses y matches solo los escribe el servidor con service_role y las
// rpc record_interest y withdraw_interest; el usuario solo los lee. Funciona
// sin JavaScript (formularios con Server Actions y redirect).
test.describe.configure({ mode: "serial" });

const IDS = getCurrentQuestionnaire().questions.map((q) => q.id);
const card = (page: Page, name: string) =>
  page.getByTestId("candidate").filter({ hasText: name });

async function viewerWithTest(page: Page, label: string) {
  const email = uniqueEmail(label);
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, `Viewer ${label}`);
  await answerQuestions(page, IDS, 1);
  await page.getByRole("button", { name: "Guardar respuestas" }).click();
  await expect(page).toHaveURL(`${APP}/explorar?test=completado`);
  return email;
}

test("«Me interesa», match mutuo, /matches y retirar un interés", async ({ page }) => {
  // Cuenta filas globales: parte de un mock vacío (E1 corre con un único worker).
  await resetMock();
  const logStart = (await requestLog()).length;
  const ana = await seedCandidate({
    name: "Ana Interés",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
    bio: "Me encanta cocinar los domingos.",
    birth: "2001-03-15",
  });
  // No pasa los filtros duros: su perfil da 404, como un id inexistente.
  const far = await seedCandidate({
    name: "Lejana Interés",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
    budgetMin: 900,
  });
  const berta = await seedCandidate({
    name: "Berta Interés",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
  });
  const email = await viewerWithTest(page, "interes");
  const viewerId = (await userState(email)).profile?.id as string;
  await expect(page.getByTestId("candidate")).toHaveCount(2);
  await expect(appNav(page).getByRole("link", { name: "Matches" })).toBeVisible();

  // 0. «Ver perfil» de Ana (Fase 5.2): su texto, sin datos privados.
  await card(page, "Ana Interés")
    .getByRole("link", { name: /^Ver perfil/ })
    .click();
  await expect(page).toHaveURL(`${APP}/explorar/${ana}`);
  const profile = page.getByTestId("person-profile");
  await expect(profile).toContainText("Me encanta cocinar los domingos.");
  await expect(profile).toContainText("Busca habitación");
  await expect(appNav(page).getByRole("link", { name: "Explorar" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  const profileHtml = await (await page.request.get(`${APP}/explorar/${ana}`)).text();
  expect(profileHtml).not.toContain("2001-03-15");
  expect(profileHtml).not.toMatch(/@roomly-e1\.test/);
  for (const hidden of [far, "00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
    const response = await page.request.get(`${APP}/explorar/${hidden}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("Lejana Interés");
  }
  // «Me interesa» desde el perfil vuelve al perfil.
  await profile.getByRole("button", { name: /^Me interesa/ }).click();
  await expect(page).toHaveURL(`${APP}/explorar/${ana}?aviso=enviado`);
  await expect(profile).toContainText("Le has enviado «Me interesa»");
  await profile.getByRole("button", { name: /^Retirar/ }).click();
  await expect(page).toHaveURL(`${APP}/explorar/${ana}?aviso=retirado`);
  await page.goto("/explorar");

  // 1. «Me interesa» a Ana: enviado, sin match.
  await card(page, "Ana Interés")
    .getByRole("button", { name: /^Me interesa/ })
    .click();
  await expect(page).toHaveURL(`${APP}/explorar?aviso=enviado`);
  await expect(page.getByTestId("interest-notice")).toContainText(
    "Le hemos enviado tu «Me interesa»"
  );
  await expect(card(page, "Ana Interés")).toContainText("Le has enviado «Me interesa»");
  let db = await interestsState();
  expect(db.interests).toEqual([
    expect.objectContaining({ from_user_id: viewerId, to_user_id: ana }),
  ]);
  expect(db.matches).toEqual([]);

  // 2. Berta ya le había mostrado interés: «Hacer match» crea el match.
  expect(await seedInterest(berta, email)).toBe("sent");
  await page.goto("/explorar");
  await expect(card(page, "Berta Interés")).toContainText("Te ha mostrado interés");
  await card(page, "Berta Interés")
    .getByRole("button", { name: /^Hacer match/ })
    .click();
  await expect(page).toHaveURL(`${APP}/explorar?aviso=match`);
  await expect(page.getByTestId("interest-notice")).toContainText("¡Tenéis un match!");
  await expect(card(page, "Berta Interés")).toContainText("Tenéis un match");
  db = await interestsState();
  expect(db.matches).toHaveLength(1);
  expect(db.matches[0]).toMatchObject({
    user_a_id: [viewerId, berta].sort()[0],
    user_b_id: [viewerId, berta].sort()[1],
  });
  // El score del match es el del motor (100: mismas respuestas), no uno del navegador.
  expect(db.matches[0].compatibility_score).toBe(100);

  // 3. /matches: Berta en matches, Ana en enviados.
  await appNav(page).getByRole("link", { name: "Matches" }).click();
  await expect(page).toHaveURL(`${APP}/matches`);
  await expect(page.getByTestId("person-matched")).toHaveCount(1);
  await expect(page.getByTestId("person-matched")).toContainText("Berta Interés");
  await expect(page.getByTestId("person-matched")).toContainText("100%");
  await expect(page.getByTestId("person-sent")).toContainText("Ana Interés");
  await expect(page.getByTestId("person-received")).toHaveCount(0);
  // Un match no se retira (sin botón).
  await expect(
    page.getByTestId("person-matched").getByRole("button", { name: /Retirar/ })
  ).toHaveCount(0);

  // 4. Retirar el interés a Ana.
  await page
    .getByTestId("person-sent")
    .getByRole("button", { name: /^Retirar/ })
    .click();
  await expect(page).toHaveURL(`${APP}/matches?aviso=retirado`);
  await expect(page.getByTestId("interest-notice")).toContainText(
    "Has retirado tu «Me interesa»"
  );
  await expect(page.getByTestId("person-sent")).toHaveCount(0);
  db = await interestsState();
  expect(db.interests.some((i) => i.to_user_id === ana)).toBe(false);
  expect(db.matches).toHaveLength(1);

  // 5. Un aviso inventado no muestra nada.
  await page.goto("/matches?aviso=%3Cb%3Ehola%3C%2Fb%3E");
  await expect(page.getByTestId("interest-notice")).toHaveCount(0);

  // service_role: solo las rpc de intereses y la lectura cruzada de perfiles
  // (más la escritura del test); el usuario solo LEE interests y matches.
  const log = (await requestLog()).slice(logStart);
  const service = log.filter((entry) => entry.apikeyIsService);
  for (const entry of service) {
    expect(
      (entry.method === "GET" && entry.path === "/rest/v1/profiles") ||
        (["POST", "PATCH"].includes(entry.method) &&
          entry.path === "/rest/v1/compatibility_responses") ||
        (entry.method === "POST" &&
          ["/rest/v1/rpc/record_interest", "/rest/v1/rpc/withdraw_interest"].includes(
            entry.path
          ))
    ).toBe(true);
  }
  expect(service.filter((e) => e.path === "/rest/v1/rpc/record_interest")).toHaveLength(
    3
  );
  expect(service.filter((e) => e.path === "/rest/v1/rpc/withdraw_interest")).toHaveLength(
    2
  );
  const userReads = log.filter(
    (entry) =>
      !entry.apikeyIsService &&
      ["/rest/v1/interests", "/rest/v1/matches"].includes(entry.path)
  );
  expect(userReads.length).toBeGreaterThan(0);
  expect(userReads.every((entry) => entry.method === "GET")).toBe(true);
});

test("sin JavaScript: «Me interesa» y retirar", async ({ page, browser }) => {
  await seedCandidate({
    name: "Carla SinJS",
    version: CURRENT_QUESTIONNAIRE_VERSION,
    questionIds: IDS,
    answer: 1,
  });
  await viewerWithTest(page, "interes-sin-js");
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();
  await p.goto(`${APP}/explorar`);
  await card(p, "Carla SinJS")
    .getByRole("button", { name: /^Me interesa/ })
    .click();
  await expect(p).toHaveURL(`${APP}/explorar?aviso=enviado`);
  await expect(card(p, "Carla SinJS")).toContainText("Le has enviado «Me interesa»");
  await card(p, "Carla SinJS")
    .getByRole("button", { name: /^Retirar/ })
    .click();
  await expect(p).toHaveURL(`${APP}/explorar?aviso=retirado`);
  await expect(
    card(p, "Carla SinJS").getByRole("button", { name: /^Me interesa/ })
  ).toBeVisible();
  await noJs.close();
});
