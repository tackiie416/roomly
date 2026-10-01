// Lógica pura del E2E real (E2, Fase 2.8), compartida por el spec y por la
// limpieza. Sin red, sin secretos: se prueba en tests/unit/e2e-real-lib.test.ts.
import path from "node:path";

/** Id de ejecución que pone el workflow: e2e-<run_id>-<run_attempt>. */
export const RUN_ID_PATTERN = /^e2e-[0-9]+-[0-9]+$/;
const RUN_ID_FRAGMENT = "e2e-[0-9]+-[0-9]+";
/** Nunca se borran más usuarios que esto de una vez (fallo cerrado). */
export const MAX_USERS_TO_DELETE = 10;

/**
 * Plantilla de la dirección de prueba (secret E2E_EMAIL_TEMPLATE), con `{id}`
 * exactamente una vez en la parte local, p. ej. `buzon+{id}@dominio`. La
 * forma concreta depende del proveedor de buzón elegido.
 */
export function validateTemplate(template) {
  if (typeof template !== "string" || template.length === 0) {
    throw new Error("E2E_EMAIL_TEMPLATE no está definida");
  }
  const at = template.lastIndexOf("@");
  if (template.split("{id}").length !== 2 || at < 0 || template.indexOf("{id}") > at) {
    throw new Error(
      "E2E_EMAIL_TEMPLATE debe contener {id} una sola vez, en la parte local"
    );
  }
  if (!/^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(template.replace("{id}", "x"))) {
    throw new Error("E2E_EMAIL_TEMPLATE no tiene forma de email");
  }
  return template;
}

export function validateRunId(runId) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) {
    throw new Error("E2E_RUN_ID debe tener la forma e2e-<run_id>-<intento>");
  }
  return runId;
}

/** Dirección única de esta ejecución. */
export function testEmail(template, runId) {
  return validateTemplate(template).replace("{id}", validateRunId(runId)).toLowerCase();
}

/**
 * Expresión que reconoce SOLO direcciones generadas con la plantilla (de
 * esta ejecución o de una anterior que no llegó a limpiar).
 */
export function testEmailPattern(template) {
  const [local, domain] = validateTemplate(template).toLowerCase().split("{id}");
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escape(local)}${RUN_ID_FRAGMENT}${escape(domain)}$`);
}

/** Usuarios que la limpieza puede borrar: los de la plantilla, y como mucho MAX. */
export function selectUsersToDelete(users, template) {
  const pattern = testEmailPattern(template);
  const selected = users.filter((user) =>
    pattern.test(String(user.email ?? "").toLowerCase())
  );
  if (selected.length > MAX_USERS_TO_DELETE) {
    throw new Error(
      `La limpieza encontró ${selected.length} usuarios de prueba (máximo ${MAX_USERS_TO_DELETE}); no se borra nada: revísalo a mano`
    );
  }
  return selected;
}

/**
 * El enlace del email debe ser el /auth/v1/verify del proyecto esperado y
 * volver exactamente a `<app>/callback`. Si no, no se abre.
 */
export function assertMagicLink(link, { verifyOrigin, appOrigin }) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error("el email no contiene un enlace válido");
  }
  if (url.origin !== new URL(verifyOrigin).origin || url.pathname !== "/auth/v1/verify") {
    throw new Error("el enlace no apunta al /auth/v1/verify del proyecto de validación");
  }
  if (url.searchParams.get("redirect_to") !== `${new URL(appOrigin).origin}/callback`) {
    throw new Error("el enlace no vuelve exactamente a <app>/callback");
  }
  return url.toString();
}

/**
 * Adaptador de buzón (E2E_MAILBOX_ADAPTER): ruta de un módulo DENTRO de
 * tests/e2e/ que exporta `createMailbox(env)` con
 *   waitForMagicLink({ to, since, timeoutMs }) → Promise<string>
 *   deleteMessages(to) → Promise<void>
 * El proveedor concreto aún no está decidido: no hay ninguno en el repo.
 */
export function resolveMailboxAdapter(modulePath, root) {
  if (!modulePath) {
    throw new Error(
      "E2E_MAILBOX_ADAPTER no está definida: falta el adaptador del proveedor de buzón (ver docs/SUPABASE_VALIDATION.md)"
    );
  }
  const allowed = path.resolve(root, "tests/e2e");
  const resolved = path.resolve(root, modulePath);
  if (!resolved.startsWith(`${allowed}${path.sep}`) || !/\.m?js$/.test(resolved)) {
    throw new Error(
      "E2E_MAILBOX_ADAPTER debe ser un módulo .mjs/.js dentro de tests/e2e/"
    );
  }
  return resolved;
}

export async function loadMailbox(env, root) {
  const resolved = resolveMailboxAdapter(env.E2E_MAILBOX_ADAPTER, root);
  const adapter = await import(resolved);
  if (typeof adapter.createMailbox !== "function") {
    throw new Error("el adaptador de buzón no exporta createMailbox(env)");
  }
  const mailbox = adapter.createMailbox(env);
  for (const method of ["waitForMagicLink", "deleteMessages"]) {
    if (typeof mailbox?.[method] !== "function") {
      throw new Error(`el adaptador de buzón no implementa ${method}`);
    }
  }
  return mailbox;
}

/** Ajustes públicos de Auth (/auth/v1/settings): lo que el E2 necesita. */
export function checkAuthSettings(settings, phase) {
  const problems = [];
  if (!settings?.external?.email)
    problems.push("el proveedor de email de Auth está desactivado");
  if (phase === "before") {
    if (settings?.disable_signup)
      problems.push("el registro está desactivado (el E2 prueba un alta nueva)");
  }
  return problems;
}

export const SIGNUP_OPEN_WARNING =
  "El registro público de Auth sigue ABIERTO en el proyecto de validación: desactívalo ahora (Authentication → Sign In / Providers → Allow new users to sign up).";
export const SIGNUP_UNKNOWN_WARNING =
  "No se pudo comprobar si el registro público sigue abierto: revísalo a mano en el dashboard y ciérralo.";

/**
 * Limpieza `after` del E2: ejecuta `work` (borrar usuarios, vaciar el buzón)
 * y, pase lo que pase con ella, comprueba DESPUÉS si el registro sigue abierto
 * y lo avisa. El aviso no depende del buzón ni del borrado. Si `work` falló,
 * se relanza ese mismo error (no se oculta); si solo falló la comprobación,
 * se relanza la de la comprobación, tras avisar de que no se pudo hacer.
 */
export async function withSignupCheck(work, readSettings, report) {
  let failure;
  try {
    await work();
  } catch (error) {
    failure = error;
  }
  try {
    const settings = await readSettings();
    if (settings?.disable_signup)
      report.info("E2 limpieza: el registro público ya está cerrado");
    else report.warning(SIGNUP_OPEN_WARNING);
  } catch (error) {
    report.warning(SIGNUP_UNKNOWN_WARNING);
    failure ??= error;
  }
  if (failure) throw failure;
}
