import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  createMailbox,
  extractVerifyLink,
  parseMailtrapConfig,
  selectMessages,
} from "@/tests/e2e/real/mailboxes/mailtrap.mjs";
import {
  assertMagicLink,
  resolveMailboxAdapter,
} from "@/tests/e2e/real/e2e-real-lib.mjs";

// Fase 2.8 — adaptador de Mailtrap Email Sandbox para el E2 real. Sin red:
// `fetch` y `sleep` se inyectan. Comprueba las URLs y la cabecera que usa,
// cómo localiza el magic link y que nunca filtra el token ni el email.

const TOKEN = "tok_secreto_123";
const TO = "e2e+e2e-1-1@roomly-e2e.test";
const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";
const APP = "http://localhost:3000";
const LINK = `${PROJECT}/auth/v1/verify?token=abc&type=signup&redirect_to=${encodeURIComponent(`${APP}/callback`)}`;
const HTML = `<p>Confirma tu cuenta</p><a href="${LINK.replace(/&/g, "&amp;")}">Confirmar</a>`;
const config = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ accountId: "111", inboxId: "4946787", apiToken: TOKEN, ...extra });

type Call = { url: string; method: string; auth: string };

/** `fetch` simulado: responde según el método y la ruta, y registra las llamadas. */
function fakeFetch(routes: Record<string, () => { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetch = async (
    url: string,
    init: { method?: string; headers: Record<string, string> }
  ) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, auth: init.headers.Authorization });
    const key = `${method} ${url.replace("https://mailtrap.io/api", "")}`;
    const route = routes[key];
    const { status = 200, body = null } = route ? route() : { status: 404 };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
  return { fetch, calls };
}

const noSleep = async () => {};

describe("configuración E2E_MAILBOX_CONFIG", () => {
  it("acepta accountId opcional e ids numéricos como número o texto", () => {
    expect(parseMailtrapConfig(config())).toEqual({
      accountId: "111",
      inboxId: "4946787",
      apiToken: TOKEN,
    });
    expect(
      parseMailtrapConfig(JSON.stringify({ inboxId: 4946787, apiToken: TOKEN }))
    ).toEqual({
      accountId: null,
      inboxId: "4946787",
      apiToken: TOKEN,
    });
  });

  it.each([
    ["", "no es un JSON válido"],
    [`{"inboxId":"1","apiToken":"${TOKEN}"`, "no es un JSON válido"],
    ["[]", "debe ser un objeto JSON"],
    [JSON.stringify({ apiToken: TOKEN }), "falta inboxId"],
    [JSON.stringify({ inboxId: "abc", apiToken: TOKEN }), "falta inboxId"],
    [
      JSON.stringify({ inboxId: "1", accountId: "x1", apiToken: TOKEN }),
      "accountId debe ser numérico",
    ],
    [JSON.stringify({ inboxId: "1", apiToken: "  " }), "falta apiToken"],
  ])("rechaza %j sin repetir su contenido", (raw, message) => {
    let error: Error | undefined;
    try {
      parseMailtrapConfig(raw);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toContain(message);
    expect(error?.message).not.toContain(TOKEN);
  });
});

describe("localizar el magic link", () => {
  it("lo saca de un href HTML con &amp; y el spec lo acepta", () => {
    const link = extractVerifyLink(HTML);
    expect(link).toBe(LINK);
    expect(assertMagicLink(link, { verifyOrigin: PROJECT, appOrigin: APP })).toBe(
      new URL(LINK).toString()
    );
  });

  it("también del texto plano, e ignora enlaces que no son /auth/v1/verify", () => {
    expect(extractVerifyLink(`Abre https://otra.example/x y luego ${LINK} gracias`)).toBe(
      LINK
    );
    expect(extractVerifyLink('<a href="https://otra.example/promo">x</a>')).toBeNull();
    expect(extractVerifyLink("")).toBeNull();
  });
});

describe("selección de mensajes", () => {
  const since = new Date("2026-10-06T21:00:00Z");
  const messages = [
    { id: 1, to_email: TO.toUpperCase(), created_at: "2026-10-06T21:01:00Z" },
    { id: 2, to_email: "otro@roomly-e2e.test", created_at: "2026-10-06T21:01:00Z" },
    { id: 3, to_email: TO, created_at: "2026-10-06T20:00:00Z" },
    { id: 4, to_email: TO, created_at: "2026-10-06T21:05:00Z" },
  ];

  it("solo el destinatario de la ejecución, desde `since` (con margen de reloj), más reciente primero", () => {
    expect(selectMessages(messages, TO, since).map((m: { id: number }) => m.id)).toEqual([
      4, 1,
    ]);
  });

  it("sin `since` (limpieza), todos los del destinatario", () => {
    expect(selectMessages(messages, TO, null).map((m: { id: number }) => m.id)).toEqual([
      4, 1, 3,
    ]);
  });
});

describe("createMailbox contra la API de Mailtrap (simulada)", () => {
  const base = "/accounts/111/inboxes/4946787/messages";

  it("espera el email, lee el HTML y devuelve el enlace, con Bearer y las rutas del SDK oficial", async () => {
    let polls = 0;
    const { fetch, calls } = fakeFetch({
      [`GET ${base}`]: () => ({
        body:
          ++polls < 3
            ? []
            : [{ id: 9, to_email: TO, created_at: new Date().toISOString() }],
      }),
      [`GET ${base}/9/body.html`]: () => ({ body: HTML }),
    });
    const mailbox = createMailbox(
      { E2E_MAILBOX_CONFIG: config() },
      { fetch, sleep: noSleep }
    );
    const link = await mailbox.waitForMagicLink({
      to: TO,
      since: new Date(),
      timeoutMs: 60_000,
    });
    expect(link).toBe(LINK);
    expect(polls).toBe(3);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(
      calls.every((c) =>
        c.url.startsWith("https://mailtrap.io/api/accounts/111/inboxes/4946787/")
      )
    ).toBe(true);
  });

  it("si el HTML no trae el enlace, prueba con el texto", async () => {
    const { fetch } = fakeFetch({
      [`GET ${base}`]: () => ({
        body: [{ id: 9, to_email: TO, created_at: new Date().toISOString() }],
      }),
      [`GET ${base}/9/body.html`]: () => ({ status: 404 }),
      [`GET ${base}/9/body.txt`]: () => ({ body: `Entra: ${LINK}` }),
    });
    const mailbox = createMailbox(
      { E2E_MAILBOX_CONFIG: config() },
      { fetch, sleep: noSleep }
    );
    expect(
      await mailbox.waitForMagicLink({ to: TO, since: new Date(), timeoutMs: 1_000 })
    ).toBe(LINK);
  });

  it("si no llega a tiempo, falla sin el email ni el token en el mensaje", async () => {
    const { fetch } = fakeFetch({ [`GET ${base}`]: () => ({ body: [] }) });
    const mailbox = createMailbox(
      { E2E_MAILBOX_CONFIG: config() },
      { fetch, sleep: noSleep }
    );
    const error = await mailbox
      .waitForMagicLink({ to: TO, since: new Date(), timeoutMs: 0 })
      .catch((e: Error) => e);
    expect((error as Error).message).toContain("no llegó ningún email");
    expect((error as Error).message).not.toContain(TO);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("un error HTTP (token inválido) se informa solo con el código", async () => {
    const { fetch } = fakeFetch({ [`GET ${base}`]: () => ({ status: 401 }) });
    const mailbox = createMailbox(
      { E2E_MAILBOX_CONFIG: config() },
      { fetch, sleep: noSleep }
    );
    const error = await mailbox
      .waitForMagicLink({ to: TO, since: new Date(), timeoutMs: 0 })
      .catch((e: Error) => e);
    expect((error as Error).message).toBe("Mailtrap respondió HTTP 401");
  });

  it("deleteMessages borra los del destinatario y comprueba que no queda ninguno", async () => {
    let inbox = [
      { id: 1, to_email: TO, created_at: "2026-10-06T21:01:00Z" },
      { id: 2, to_email: "otro@roomly-e2e.test", created_at: "2026-10-06T21:01:00Z" },
    ];
    const { fetch, calls } = fakeFetch({
      [`GET ${base}`]: () => ({ body: inbox }),
      [`DELETE ${base}/1`]: () => {
        inbox = inbox.filter((m) => m.id !== 1);
        return { body: null };
      },
    });
    const mailbox = createMailbox(
      { E2E_MAILBOX_CONFIG: config() },
      { fetch, sleep: noSleep }
    );
    await mailbox.deleteMessages(TO);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      `https://mailtrap.io/api${base}/1`,
    ]);
    expect(inbox.map((m) => m.id)).toEqual([2]);
  });

  it("sin accountId, busca la cuenta del token que tiene el sandbox", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /accounts": () => ({ body: [{ id: 5 }, { id: 111 }] }),
      "GET /accounts/5/inboxes/4946787": () => ({ status: 404 }),
      "GET /accounts/111/inboxes/4946787": () => ({ body: { id: 4946787 } }),
      [`GET ${base}`]: () => ({ body: [] }),
    });
    const mailbox = createMailbox(
      { E2E_MAILBOX_CONFIG: JSON.stringify({ inboxId: "4946787", apiToken: TOKEN }) },
      { fetch, sleep: noSleep }
    );
    await mailbox.deleteMessages(TO);
    expect(calls.map((c) => c.url)).toContain(`https://mailtrap.io/api${base}`);
  });

  it("sin accountId y sin ninguna cuenta con ese sandbox, falla con un mensaje claro", async () => {
    const { fetch } = fakeFetch({ "GET /accounts": () => ({ body: [{ id: 5 }] }) });
    const mailbox = createMailbox(
      { E2E_MAILBOX_CONFIG: JSON.stringify({ inboxId: "4946787", apiToken: TOKEN }) },
      { fetch, sleep: noSleep }
    );
    await expect(mailbox.deleteMessages(TO)).rejects.toThrow("ninguna cuenta del token");
  });
});

describe("carga desde el workflow", () => {
  it("E2E_MAILBOX_ADAPTER=tests/e2e/real/mailboxes/mailtrap.mjs es una ruta válida", () => {
    const root = process.cwd();
    expect(resolveMailboxAdapter("tests/e2e/real/mailboxes/mailtrap.mjs", root)).toBe(
      path.resolve(root, "tests/e2e/real/mailboxes/mailtrap.mjs")
    );
  });
});
