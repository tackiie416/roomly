import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_USERS_TO_DELETE,
  SIGNUP_OPEN_WARNING,
  SIGNUP_UNKNOWN_WARNING,
  withSignupCheck,
  assertMagicLink,
  checkAuthSettings,
  resolveMailboxAdapter,
  selectUsersToDelete,
  testEmail,
  testEmailPattern,
  validateRunId,
  validateTemplate,
} from "@/tests/e2e/real/e2e-real-lib.mjs";

// Fase 2.8 — lógica pura del E2E real (E2): dirección única por ejecución,
// qué usuarios puede borrar la limpieza, qué enlace se acepta y qué
// adaptador de buzón se carga. Sin red ni secretos.

const TEMPLATE = "buzon+{id}@pruebas.example";
const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";
const APP = "http://localhost:3000";
const verify = (redirect = `${APP}/callback`, origin = PROJECT) =>
  `${origin}/auth/v1/verify?token=abc&type=magiclink&redirect_to=${encodeURIComponent(redirect)}`;

describe("plantilla y id de ejecución", () => {
  it.each([
    ["", "no está definida"],
    ["buzon@pruebas.example", "{id} una sola vez"],
    ["{id}+{id}@pruebas.example", "{id} una sola vez"],
    ["buzon@{id}.example", "en la parte local"],
    ["{id}", "{id} una sola vez"],
    ["buzon {id}@pruebas.example", "forma de email"],
  ])("rechaza %j", (template, message) => {
    expect(() => validateTemplate(template)).toThrow(message);
  });

  it.each(["", "e2e-1", "e2e-1-x", "E2E-1-1", "e2e-1-1 ", "x-e2e-1-1", "e2e-1-1;rm"])(
    "id de ejecución inválido %j",
    (runId) => expect(() => validateRunId(runId)).toThrow()
  );

  it("dirección única y en minúsculas", () => {
    expect(testEmail("Buzon+{id}@Pruebas.Example", "e2e-42-1")).toBe(
      "buzon+e2e-42-1@pruebas.example"
    );
    expect(testEmail(TEMPLATE, "e2e-42-1")).not.toBe(testEmail(TEMPLATE, "e2e-42-2"));
  });
});

describe("usuarios que puede borrar la limpieza", () => {
  const pattern = testEmailPattern(TEMPLATE);

  it("solo las direcciones generadas con la plantilla", () => {
    expect(pattern.test("buzon+e2e-1-1@pruebas.example")).toBe(true);
    expect(pattern.test("buzon+e2e-9999-3@pruebas.example")).toBe(true);
    for (const other of [
      "buzon@pruebas.example",
      "buzon+otra@pruebas.example",
      "buzon+e2e-1-1@pruebas.example.evil",
      "xbuzon+e2e-1-1@pruebas.example",
      "buzon+e2e-1-1x@pruebas.example",
      "buzon+e2e-1-1@pruebasXexample",
      "persona.real@example.com",
    ]) {
      expect(pattern.test(other), other).toBe(false);
    }
  });

  it("filtra y nunca incluye usuarios reales", () => {
    const users = [
      { id: "1", email: "buzon+e2e-1-1@pruebas.example" },
      { id: "2", email: "persona.real@example.com" },
      { id: "3", email: "BUZON+E2E-2-1@PRUEBAS.EXAMPLE" },
      { id: "4", email: null },
    ];
    expect(selectUsersToDelete(users, TEMPLATE).map((u: { id: string }) => u.id)).toEqual(
      ["1", "3"]
    );
  });

  it(`más de ${MAX_USERS_TO_DELETE} → no borra nada (fallo cerrado)`, () => {
    const users = Array.from({ length: MAX_USERS_TO_DELETE + 1 }, (_, i) => ({
      id: String(i),
      email: `buzon+e2e-${i}-1@pruebas.example`,
    }));
    expect(() => selectUsersToDelete(users, TEMPLATE)).toThrow("no se borra nada");
    expect(selectUsersToDelete(users.slice(1), TEMPLATE)).toHaveLength(
      MAX_USERS_TO_DELETE
    );
  });
});

describe("magic link aceptado", () => {
  const opts = { verifyOrigin: PROJECT, appOrigin: APP };

  it("el /auth/v1/verify del proyecto que vuelve a <app>/callback", () => {
    expect(assertMagicLink(verify(), opts)).toContain("/auth/v1/verify");
  });

  it.each([
    [
      "otro proyecto",
      verify(`${APP}/callback`, "https://zzzzzzzzzzzzzzzzzzzz.supabase.co"),
    ],
    [
      "host parecido",
      verify(`${APP}/callback`, "https://abcdefghijklmnopqrst.supabase.co.evil.com"),
    ],
    ["http en vez de https", verify(`${APP}/callback`, PROJECT.replace("https", "http"))],
    [
      "otra ruta",
      `${PROJECT}/auth/v1/otp?redirect_to=${encodeURIComponent(`${APP}/callback`)}`,
    ],
    ["redirect externo", verify("https://evil.com/callback")],
    ["redirect a otra ruta de la app", verify(`${APP}/perfil`)],
    ["redirect con sufijo", verify(`${APP}/callback/x`)],
    ["sin redirect", `${PROJECT}/auth/v1/verify?token=abc`],
    ["no es una URL", "texto del email"],
  ])("rechaza: %s", (_label, link) => {
    expect(() => assertMagicLink(link, opts)).toThrow();
  });
});

describe("adaptador de buzón", () => {
  const root = "/repo";

  it("sin adaptador → error que explica qué falta", () => {
    expect(() => resolveMailboxAdapter(undefined, root)).toThrow(
      "E2E_MAILBOX_ADAPTER no está definida"
    );
  });

  it.each([
    "/etc/passwd.mjs",
    "tests/e2e/../../lib/supabase/admin.mjs",
    "tests/e2ex/adaptador.mjs",
    "tests/e2e/real/adaptador.ts",
    "node_modules/x/index.mjs",
  ])("rechaza %j (fuera de tests/e2e o no es .mjs/.js)", (modulePath) => {
    expect(() => resolveMailboxAdapter(modulePath, root)).toThrow("dentro de tests/e2e/");
  });

  it("acepta un módulo dentro de tests/e2e", () => {
    expect(resolveMailboxAdapter("tests/e2e/real/mailboxes/proveedor.mjs", root)).toBe(
      path.resolve(root, "tests/e2e/real/mailboxes/proveedor.mjs")
    );
  });
});

describe("ajustes de Auth", () => {
  it("antes: email y registro activos", () => {
    expect(
      checkAuthSettings({ external: { email: true }, disable_signup: false }, "before")
    ).toEqual([]);
    expect(
      checkAuthSettings({ external: { email: true }, disable_signup: true }, "before")
    ).toHaveLength(1);
    expect(checkAuthSettings({ external: { email: false } }, "before")).toHaveLength(1);
  });
});

describe("limpieza: el aviso de registro abierto no depende del buzón", () => {
  function reporter() {
    const lines: Array<[string, string]> = [];
    return {
      lines,
      report: {
        warning: (text: string) => lines.push(["warning", text]),
        info: (text: string) => lines.push(["info", text]),
      },
    };
  }
  const open = async () => ({ disable_signup: false });
  const closed = async () => ({ disable_signup: true });

  it("el buzón falla y el registro sigue abierto → avisa y relanza el error del buzón", async () => {
    const { lines, report } = reporter();
    const mailboxError = new Error("adaptador de buzón no disponible");
    await expect(
      withSignupCheck(
        async () => {
          throw mailboxError;
        },
        open,
        report
      )
    ).rejects.toBe(mailboxError);
    expect(lines).toEqual([["warning", SIGNUP_OPEN_WARNING]]);
  });

  it("falla el borrado de usuarios → también avisa", async () => {
    const { lines, report } = reporter();
    await expect(
      withSignupCheck(
        async () => {
          throw new Error("deleteUser falló (500)");
        },
        open,
        report
      )
    ).rejects.toThrow("deleteUser falló");
    expect(lines).toEqual([["warning", SIGNUP_OPEN_WARNING]]);
  });

  it("todo bien y registro abierto → avisa sin fallar", async () => {
    const { lines, report } = reporter();
    let ran = false;
    await withSignupCheck(
      async () => {
        ran = true;
      },
      open,
      report
    );
    expect(ran).toBe(true);
    expect(lines).toEqual([["warning", SIGNUP_OPEN_WARNING]]);
  });

  it("registro cerrado → informa, sin aviso", async () => {
    const { lines, report } = reporter();
    await withSignupCheck(async () => {}, closed, report);
    expect(lines.map(([kind]) => kind)).toEqual(["info"]);
  });

  it("no se pueden leer los ajustes → avisa de que hay que revisarlo y no oculta el error original", async () => {
    const { lines, report } = reporter();
    const mailboxError = new Error("buzón");
    await expect(
      withSignupCheck(
        async () => {
          throw mailboxError;
        },
        async () => {
          throw new Error("HTTP 503");
        },
        report
      )
    ).rejects.toBe(mailboxError);
    expect(lines).toEqual([["warning", SIGNUP_UNKNOWN_WARNING]]);

    const solo = reporter();
    await expect(
      withSignupCheck(
        async () => {},
        async () => {
          throw new Error("HTTP 503");
        },
        solo.report
      )
    ).rejects.toThrow("HTTP 503");
    expect(solo.lines).toEqual([["warning", SIGNUP_UNKNOWN_WARNING]]);
  });

  it("cleanup.mjs usa withSignupCheck en la fase after, con el buzón dentro", () => {
    const source = readFileSync("tests/e2e/real/cleanup.mjs", "utf8");
    const call = source.slice(source.indexOf("await withSignupCheck("));
    expect(call.indexOf("loadMailbox")).toBeGreaterThan(0);
    expect(call.indexOf("loadMailbox")).toBeLessThan(call.indexOf("authSettings"));
    expect(source.match(/disable_signup/g) ?? []).toHaveLength(0);
  });
});
