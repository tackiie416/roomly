import { expect, test } from "@playwright/test";
import {
  APP,
  completeOnboarding,
  deactivateAccount,
  loginWithMagicLink,
  resetMock,
  seedRoom,
  uniqueEmail,
  userState,
} from "./helpers";

// Sesión 85 — «Descargar mis datos» desde /ajustes (Supabase simulado). La
// descarga es un adjunto JSON sin caché, solo con datos propios; sin sesión
// lleva al login, y también funciona con la cuenta desactivada.
// No es el E2 real: no hay Supabase de verdad.

test.beforeEach(async () => {
  await resetMock();
});

test("descargar mis datos: adjunto JSON propio, sin sesión al login", async ({
  page,
  browser,
}) => {
  const anon = await browser.newContext();
  const anonResponse = await anon
    .newPage()
    .then((p) => p.request.get(`${APP}/ajustes/mis-datos`, { maxRedirects: 0 }));
  expect([303, 307]).toContain(anonResponse.status());
  expect(anonResponse.headers().location).toMatch(/\/login/);
  await anon.close();

  const email = uniqueEmail("mis-datos");
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, "Nora Exporta");
  await seedRoom(email, { title: "Mi habitación exportada", status: "draft" });

  const settings = await page.goto("/ajustes");
  // Cabeceras de seguridad (next.config.ts, sesión 86), en una página real.
  const headers = settings?.headers() ?? {};
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-powered-by"]).toBeUndefined();
  const link = page.getByTestId("data-export-link");
  await expect(link).toHaveAttribute("href", "/ajustes/mis-datos");
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(
    /^roomly-mis-datos-\d{4}-\d{2}-\d{2}\.json$/
  );

  const response = await page.request.get(`${APP}/ajustes/mis-datos`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  const data = await response.json();
  const id = (await userState(email)).profile?.id;
  expect(data).toMatchObject({
    format: "roomly-data-export",
    account: { id, email },
    profile: { id, full_name: "Nora Exporta" },
    rooms: [{ title: "Mi habitación exportada", status: "draft" }],
  });
  expect(data.housingPreferences).not.toBeNull();

  // Con la cuenta desactivada se sigue pudiendo descargar.
  await deactivateAccount(email);
  const afterDeactivation = await page.request.get(`${APP}/ajustes/mis-datos`);
  expect(afterDeactivation.status()).toBe(200);
  expect((await afterDeactivation.json()).profile.deleted_at).not.toBeNull();
});
