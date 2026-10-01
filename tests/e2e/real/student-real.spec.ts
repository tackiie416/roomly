import { expect, test, type Page } from "@playwright/test";
import { assertMagicLink, loadMailbox, testEmail } from "./e2e-real-lib.mjs";

/**
 * E2 — alta REAL de un estudiante contra el proyecto de validación
 * (roomly-validation-2). Formulario real → signInWithOtp → email real →
 * magic link → /callback?code= (PKCE) → onboarding → app → logout.
 * Sin generateLink ni atajos de autenticación: el enlace sale del buzón.
 *
 * Solo desde el job `e2e-real` del workflow manual. Este proceso NO recibe
 * service_role (la preparación y la limpieza son pasos aparte). Nada de lo
 * que se registra contiene el email, el enlace ni cookies: las comprobaciones
 * de URL comparan solo la ruta y los errores se reescriben sin datos.
 */

const env = process.env;
// Playwright se ejecuta desde la raíz del repositorio (playwright.real.config.ts).
const ROOT = process.cwd();
const APP = new URL(env.E2E_APP_URL ?? "http://localhost:3000").origin;

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

let redactEmail = "";

/** Quita del mensaje el email de prueba y cualquier URL (enlace, código, query). */
function redact(message: string): string {
  let out = message.replace(/https?:\/\/\S+/g, "<url>");
  if (redactEmail) out = out.split(redactEmail).join("<email>");
  return out.replace(/code=[^\s&"']+/g, "code=<código>");
}

/** Ejecuta un paso y, si falla, lanza un error sin datos de la ejecución. */
async function step<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const detail = error instanceof Error ? redact(error.message).split("\n")[0] : "";
    throw new Error(`E2 falló en: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

test("alta real por magic link, onboarding, perfil, preferencias, ajustes y logout", async ({
  page,
}) => {
  const email = testEmail(env.E2E_EMAIL_TEMPLATE, env.E2E_RUN_ID);
  redactEmail = email;
  const mailbox = await loadMailbox(env, ROOT);
  const since = new Date();

  await step("pedir el magic link desde /login", async () => {
    await page.goto("/login");
    await page.getByPlaceholder("tucorreo@ejemplo.com").fill(email);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByText("Revisa tu correo")).toBeVisible({ timeout: 30_000 });
  });

  const link = await step("recibir el email en el buzón de prueba", async () =>
    assertMagicLink(
      await mailbox.waitForMagicLink({ to: email, since, timeoutMs: 120_000 }),
      {
        verifyOrigin: env.SUPABASE_VALIDATION_URL!,
        appOrigin: APP,
      }
    )
  );

  await step(
    "abrir el enlace en el mismo navegador (PKCE) y pasar por /callback",
    async () => {
      await page.goto(link);
      await page.waitForURL(
        (url) => url.origin === APP && !url.pathname.startsWith("/callback"),
        {
          timeout: 30_000,
        }
      );
    }
  );
  expect(pathnameOf(page), "usuario nuevo → paso 1 del onboarding").toBe(
    "/bienvenida/perfil"
  );

  await step("onboarding: perfil", async () => {
    await page.locator("#full_name").fill("Estudiante E2");
    await page.locator("#date_of_birth").fill("2001-03-15");
    await page.getByLabel("Busco habitación").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL((url) => url.pathname === "/bienvenida/preferencias");
  });
  await step("onboarding: preferencias con ciudad", async () => {
    await page.locator("#city_id").selectOption({ label: "Barcelona" });
    await page.locator("#budget_max").fill("650");
    await page.getByRole("button", { name: "Terminar" }).click();
    await page.waitForURL((url) => url.pathname === "/");
  });

  await step("/perfil: guardar y releer", async () => {
    await page.goto("/perfil");
    await page.locator("#bio").fill("Alta real E2");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados.")).toBeVisible();
    await page.reload();
    await expect(page.locator("#bio")).toHaveValue("Alta real E2");
  });
  await step("/preferencias: guardar y releer", async () => {
    await page.goto("/preferencias");
    await page.locator("#budget_max").fill("700");
    await page.getByRole("button", { name: "Guardar preferencias" }).click();
    await expect(page.getByText("Preferencias guardadas.")).toBeVisible();
    await page.reload();
    await expect(page.locator("#budget_max")).toHaveValue("700");
  });
  await step("/ajustes: desactivar el aviso y releer", async () => {
    await page.goto("/ajustes");
    await page.locator('input[name="email_notifications_enabled"]').uncheck();
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText("Ajustes guardados.")).toBeVisible();
    await page.reload();
    await expect(
      page.locator('input[name="email_notifications_enabled"]')
    ).not.toBeChecked();
  });

  await step("logout desde el nav", async () => {
    await page
      .getByRole("navigation", { name: "Tu cuenta" })
      .getByRole("button", { name: "Cerrar sesión" })
      .click();
    await page.waitForURL((url) => url.pathname === "/login");
  });
  await page.goto("/perfil");
  expect(pathnameOf(page), "sin sesión, /perfil vuelve a /login").toBe("/login");
});
