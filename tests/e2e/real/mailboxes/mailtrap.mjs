// Adaptador de buzón del E2 real (Fase 2.8) para Mailtrap Email Sandbox.
// Implementa la interfaz de tests/e2e/real/e2e-real-lib.mjs (loadMailbox):
//   createMailbox(env) → { waitForMagicLink({ to, since, timeoutMs }), deleteMessages(to) }
//
// Configuración: E2E_MAILBOX_CONFIG (secret del Environment roomly-validation-2),
// un JSON de una línea:
//   {"accountId":"<id de cuenta>","inboxId":"<id del sandbox>","apiToken":"<token>"}
// `accountId` es opcional: si falta, se busca entre las cuentas del token la
// que tiene ese sandbox. El token necesita permiso Admin sobre el sandbox
// (leer y borrar mensajes).
//
// API (la misma que usa el SDK oficial mailtrap-nodejs):
//   GET    https://mailtrap.io/api/accounts
//   GET    https://mailtrap.io/api/accounts/{a}/inboxes/{i}/messages
//   GET    https://mailtrap.io/api/accounts/{a}/inboxes/{i}/messages/{m}/body.html | body.txt
//   DELETE https://mailtrap.io/api/accounts/{a}/inboxes/{i}/messages/{m}
//   Cabecera: Authorization: Bearer <token>
//
// Nunca registra ni incluye en un error el token, el email, el enlace ni el
// cuerpo de un mensaje: solo códigos HTTP y recuentos.

const API = "https://mailtrap.io/api";
const POLL_MS = 3_000;
// Margen por diferencia de reloj entre el runner y Mailtrap. El destinatario
// es único por ejecución, así que el filtro por fecha es secundario.
const CLOCK_SKEW_MS = 120_000;
const ID = /^[0-9]{1,20}$/;

/** Lee y valida E2E_MAILBOX_CONFIG sin repetir nunca su contenido. */
export function parseMailtrapConfig(raw) {
  let config;
  try {
    config = JSON.parse(raw ?? "");
  } catch {
    throw new Error("E2E_MAILBOX_CONFIG no es un JSON válido");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("E2E_MAILBOX_CONFIG debe ser un objeto JSON");
  }
  const inboxId = String(config.inboxId ?? "");
  const accountId = config.accountId == null ? null : String(config.accountId);
  const apiToken = typeof config.apiToken === "string" ? config.apiToken.trim() : "";
  if (!ID.test(inboxId)) throw new Error("E2E_MAILBOX_CONFIG: falta inboxId numérico");
  if (accountId !== null && !ID.test(accountId)) {
    throw new Error("E2E_MAILBOX_CONFIG: accountId debe ser numérico");
  }
  if (!apiToken) throw new Error("E2E_MAILBOX_CONFIG: falta apiToken");
  return { inboxId, accountId, apiToken };
}

/** Decodifica las entidades HTML que pueden aparecer dentro de un href. */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Primer enlace del cuerpo que apunte a `/auth/v1/verify`. La validación
 * estricta (origen del proyecto y `redirect_to` exacto) la hace
 * `assertMagicLink` en el spec; aquí solo se localiza.
 */
export function extractVerifyLink(body) {
  const text = String(body ?? "");
  const candidates = [
    ...[...text.matchAll(/href\s*=\s*"([^"]+)"/gi)].map((m) => m[1]),
    ...[...text.matchAll(/href\s*=\s*'([^']+)'/gi)].map((m) => m[1]),
    ...[...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]),
  ].map(decodeEntities);
  return candidates.find((url) => /\/auth\/v1\/verify\?/.test(url)) ?? null;
}

/** Mensajes dirigidos a `to` y creados desde `since` (con margen), más recientes primero. */
export function selectMessages(messages, to, since) {
  const target = String(to).toLowerCase();
  const from = since ? new Date(since).getTime() - CLOCK_SKEW_MS : -Infinity;
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => String(m?.to_email ?? "").toLowerCase() === target)
    .filter((m) => {
      const at = Date.parse(m?.created_at ?? m?.sent_at ?? "");
      return Number.isNaN(at) || at >= from;
    })
    .sort(
      (a, b) =>
        (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0)
    );
}

export function createMailbox(env, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const config = parseMailtrapConfig(env.E2E_MAILBOX_CONFIG);
  const headers = {
    Authorization: `Bearer ${config.apiToken}`,
    Accept: "application/json",
  };
  let accountId = config.accountId;

  async function request(path, { method = "GET", as = "json" } = {}) {
    const response = await fetchImpl(`${API}${path}`, { method, headers });
    if (!response.ok) {
      const error = new Error(`Mailtrap respondió HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (as === "none") return null;
    return as === "text" ? response.text() : response.json();
  }

  /** accountId de la configuración o, si falta, la cuenta del token que tiene el sandbox. */
  async function resolveAccount() {
    if (accountId) return accountId;
    const accounts = await request("/accounts");
    for (const account of Array.isArray(accounts) ? accounts : []) {
      const id = String(account?.id ?? "");
      if (!ID.test(id)) continue;
      try {
        await request(`/accounts/${id}/inboxes/${config.inboxId}`);
        accountId = id;
        return accountId;
      } catch (error) {
        if (error.status !== 404 && error.status !== 403) throw error;
      }
    }
    throw new Error("ninguna cuenta del token de Mailtrap tiene ese sandbox (inboxId)");
  }

  const messagesPath = async () =>
    `/accounts/${await resolveAccount()}/inboxes/${config.inboxId}/messages`;

  async function listFor(to, since) {
    return selectMessages(await request(await messagesPath()), to, since);
  }

  return {
    async waitForMagicLink({ to, since, timeoutMs }) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        for (const message of await listFor(to, since)) {
          const base = `${await messagesPath()}/${message.id}`;
          for (const part of ["body.html", "body.txt"]) {
            let body = "";
            try {
              body = await request(`${base}/${part}`, { as: "text" });
            } catch (error) {
              if (error.status !== 404) throw error;
            }
            const link = extractVerifyLink(body);
            if (link) return link;
          }
        }
        if (Date.now() >= deadline) {
          throw new Error("no llegó ningún email con el magic link al buzón de Mailtrap");
        }
        await sleep(POLL_MS);
      }
    },

    async deleteMessages(to) {
      const path = await messagesPath();
      for (const message of await listFor(to, null)) {
        await request(`${path}/${message.id}`, { method: "DELETE", as: "none" });
      }
      const remaining = await listFor(to, null);
      if (remaining.length > 0) {
        throw new Error(`quedan ${remaining.length} mensajes de prueba en Mailtrap`);
      }
    },
  };
}
