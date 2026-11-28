import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "../../../lib/matching/questionnaire";
import {
  APP,
  completeOnboarding,
  loginWithMagicLink,
  makeAdmin,
  resetMock,
  seedCandidate,
  seedOwnResponse,
  seedRoom,
  uniqueEmail,
} from "./helpers";

// Sesión 88 — accesibilidad automática (axe-core, WCAG 2.1 A y AA) de las
// páginas principales, en escritorio y en un móvil de 375 px. Supabase
// simulado. Es una red de seguridad, no una auditoría: axe no detecta todo
// (orden de lectura, textos claros, uso solo con teclado), y eso sigue
// necesitando una revisión manual antes de la beta.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`
  );
  expect(summary, `${label}: infracciones de axe`).toEqual([]);
  // Que axe haya evaluado algo de verdad (no una página vacía o a medio cargar).
  expect(results.passes.length, `${label}: reglas evaluadas`).toBeGreaterThan(10);
}

/** Sin scroll horizontal: nada más ancho que la ventana. */
async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `${label}: scroll horizontal`).toBeLessThanOrEqual(0);
}

const VIEWPORTS = [
  { name: "escritorio", width: 1280, height: 800 },
  { name: "móvil", width: 375, height: 740 },
];

test.beforeEach(async () => {
  await resetMock();
});

for (const viewport of VIEWPORTS) {
  test(`páginas públicas sin infracciones de axe (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const owner = uniqueEmail("a11y-owner");
    // La propietaria necesita perfil para que la habitación exista en el mock.
    await loginWithMagicLink(page, owner);
    await completeOnboarding(page, "Duena Accesible");
    const roomId = await seedRoom(owner, {
      title: "Habitación accesible",
      status: "active",
      complete: true,
      photos: 1,
    });
    await page.context().clearCookies();

    for (const path of [
      "/",
      "/login",
      "/barcelona/habitaciones",
      `/barcelona/habitaciones/${roomId}`,
      "/una-ruta-que-no-existe",
    ]) {
      await page.goto(`${APP}${path}`);
      if (path.endsWith(roomId))
        await expect(
          page.getByRole("heading", { name: "Habitación accesible" })
        ).toBeVisible();
      await expectNoViolations(page, path);
      await expectNoHorizontalScroll(page, path);
    }
  });

  test(`páginas con sesión sin infracciones de axe (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const email = uniqueEmail("a11y-user");
    await loginWithMagicLink(page, email);
    await expectNoViolations(page, "/bienvenida/perfil");
    await expectNoHorizontalScroll(page, "/bienvenida/perfil");
    await completeOnboarding(page, "Persona Accesible");
    // /test a medias, como lo ve quien acaba el onboarding.
    await expectNoViolations(page, "/test (vacío)");
    // Test completado (2 es válido en todas las escalas) y un candidato, para
    // auditar /explorar con una tarjeta y no solo el estado vacío.
    const ids = getCurrentQuestionnaire().questions.map((q) => q.id);
    await seedOwnResponse(email, {
      version: CURRENT_QUESTIONNAIRE_VERSION,
      questionIds: ids,
      answer: 2,
      completed: true,
    });
    await seedCandidate({
      name: "Candidata Accesible",
      version: CURRENT_QUESTIONNAIRE_VERSION,
      questionIds: ids,
      answer: 2,
    });
    await makeAdmin(email);

    for (const path of [
      "/test",
      "/explorar",
      "/matches",
      "/mensajes",
      "/habitaciones",
      "/habitaciones/nueva",
      "/perfil",
      "/preferencias",
      "/ajustes",
      "/ajustes/bloqueos",
      "/ajustes/eliminar-cuenta",
      "/admin",
      "/admin/usuarios",
      "/admin/reportes",
      "/admin/habitaciones",
      "/admin/metricas",
    ]) {
      await page.goto(`${APP}${path}`);
      // Sin redirección: se audita la página pedida, no /login ni otra.
      await expect(page).toHaveURL(`${APP}${path}`);
      await expect(page.locator("main")).toBeVisible();
      if (path === "/explorar")
        await expect(page.getByText("Candidata").first()).toBeVisible();
      await expectNoViolations(page, path);
      await expectNoHorizontalScroll(page, path);
    }
  });
}
