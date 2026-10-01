import { expect, type Page } from "@playwright/test";
import { APP_ORIGIN, MOCK_SUPABASE_URL } from "../support/mock-config.mjs";

/**
 * Utilidades del E2E local (E1). Todo va contra el Supabase simulado: los
 * endpoints /__test/* hacen de buzón y de "servidor" (desactivar cuenta).
 */

export const APP = APP_ORIGIN;

/** Email único por test: cada spec crea sus propios usuarios. */
export function uniqueEmail(label: string): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `e1-${label}-${id}@roomly-e1.test`;
}

async function mock(path: string): Promise<Response> {
  return fetch(`${MOCK_SUPABASE_URL}${path}`);
}

/** Último magic link enviado a `email` (el "buzón" del mock). */
export async function lastMagicLink(email: string): Promise<string> {
  const response = await mock(`/__test/outbox?email=${encodeURIComponent(email)}`);
  expect(response.status, "el mock tiene un email para esa dirección").toBe(200);
  return ((await response.json()) as { link: string }).link;
}

export type MockUserState = {
  id: string;
  profile: Record<string, unknown> | null;
  preferences: Record<string, unknown> | null;
};

export async function userState(email: string): Promise<MockUserState> {
  const response = await mock(`/__test/user?email=${encodeURIComponent(email)}`);
  expect(response.status).toBe(200);
  return (await response.json()) as MockUserState;
}

/** Borrado de cuenta hecho por el servidor (fuera del alcance del cliente). */
export async function deactivateAccount(email: string): Promise<void> {
  expect(
    (await mock(`/__test/deactivate?email=${encodeURIComponent(email)}`)).status
  ).toBe(200);
}

export async function requestLog(): Promise<
  Array<{ method: string; path: string; apikeyIsAnon: boolean; bearerRole: string }>
> {
  return (await (await mock("/__test/log")).json()) as never;
}

export const pathOf = (page: Page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};

/** /login → formulario real → signInWithOtp (PKCE) → enlace → /callback?code=. */
export async function requestMagicLink(page: Page, email: string, from = "/login") {
  await page.goto(from);
  await page.getByPlaceholder("tucorreo@ejemplo.com").fill(email);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByText("Revisa tu correo")).toBeVisible();
  return lastMagicLink(email);
}

export async function loginWithMagicLink(page: Page, email: string, from = "/login") {
  const link = await requestMagicLink(page, email, from);
  await page.goto(link);
  await page.waitForURL((url) => !url.pathname.startsWith("/callback"));
}

/** Onboarding completo desde /bienvenida/perfil hasta la home. */
export async function completeOnboarding(page: Page, fullName: string) {
  await expect(page).toHaveURL(`${APP}/bienvenida/perfil`);
  await page.locator("#full_name").fill(fullName);
  await page.locator("#date_of_birth").fill("2001-03-15");
  await page.getByLabel("Busco habitación").check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(`${APP}/bienvenida/preferencias`);
  await page.locator("#city_id").selectOption({ label: "Barcelona" });
  await page.locator("#budget_max").fill("650");
  await page.getByRole("button", { name: "Terminar" }).click();
  await expect(page).toHaveURL(`${APP}/`);
}

export const appNav = (page: Page) => page.getByRole("navigation", { name: "Tu cuenta" });
