import { describe, expect, it } from "vitest";
import { checkDeployConfig } from "../../scripts/deploy-config-check.mjs";

// Sesión 87 — comprobación de la configuración de staging y producción, sin
// conectarse a nada. Los valores de aquí son ficticios.

const REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";
const jwt = (payload: Record<string, unknown>) =>
  [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "firma-ficticia",
  ].join(".");
const ANON = jwt({ role: "anon", ref: REF });
const SERVICE = jwt({ role: "service_role", ref: REF });

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  NEXT_PUBLIC_SITE_URL: "https://staging.roomly.example",
  NEXT_PUBLIC_CHAT_REALTIME: "false",
};

type Result = { errors: string[]; warnings: string[] };
const check = (env: Record<string, string | undefined>, target = "staging"): Result =>
  checkDeployConfig(env, { target: target as "staging" | "production" });

describe("checkDeployConfig", () => {
  it("una configuración correcta no da errores", () => {
    expect(check(VALID)).toEqual({ errors: [], warnings: [] });
    expect(
      check({ ...VALID, NEXT_PUBLIC_SITE_URL: "https://roomly.example" }, "production")
    ).toEqual({ errors: [], warnings: [] });
  });

  it("nunca incluye un valor en los mensajes", () => {
    const { errors } = check({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE,
      NEXT_PUBLIC_LEAK: SERVICE,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).not.toContain(SERVICE);
    expect(errors.join("\n")).not.toContain(REF);
  });

  it("un target desconocido es un error", () => {
    expect(check(VALID, "dev").errors).toHaveLength(1);
  });

  it.each([
    [
      "falta la URL",
      { NEXT_PUBLIC_SUPABASE_URL: undefined },
      "NEXT_PUBLIC_SUPABASE_URL: falta",
    ],
    [
      "falta la clave de servidor",
      { SUPABASE_SERVICE_ROLE_KEY: "" },
      "SUPABASE_SERVICE_ROLE_KEY: falta",
    ],
    [
      "Supabase sin https",
      { NEXT_PUBLIC_SUPABASE_URL: `http://${REF}.supabase.co` },
      "debe ser https",
    ],
    [
      "Supabase local",
      { NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:54321" },
      "máquina local",
    ],
    [
      "proyecto prohibido (uwxb…)",
      { NEXT_PUBLIC_SUPABASE_URL: "https://uwxbabcdefghijklmnop.supabase.co" },
      "proyecto prohibido",
    ],
    [
      "claves iguales",
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE },
      "es igual a la clave service_role",
    ],
    [
      "anon con el rol service_role",
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "service_role", ref: REF }) },
      "rol anon",
    ],
    [
      "anon de otro proyecto",
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon", ref: OTHER_REF }) },
      "otro proyecto",
    ],
    [
      "service_role de otro proyecto",
      { SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: OTHER_REF }) },
      "otro proyecto",
    ],
    [
      "service_role con el rol anon",
      { SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "anon", ref: REF }) },
      "rol service_role",
    ],
    [
      "clave secreta como anon",
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_x" },
      "clave secreta",
    ],
    [
      "clave pública como servidor",
      { SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_x" },
      "clave pública",
    ],
    [
      "NEXT_PUBLIC_ con la clave de servidor",
      { NEXT_PUBLIC_OTRA: SERVICE },
      "NEXT_PUBLIC_OTRA: contiene la clave service_role",
    ],
    [
      "NEXT_PUBLIC_*SERVICE*",
      { NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "x" },
      "no puede llevar un secreto",
    ],
    [
      "sitio sin https",
      { NEXT_PUBLIC_SITE_URL: "http://staging.roomly.example" },
      "NEXT_PUBLIC_SITE_URL: debe ser https",
    ],
    ["sitio local", { NEXT_PUBLIC_SITE_URL: "https://localhost:3000" }, "máquina local"],
    [
      "sitio con ruta",
      { NEXT_PUBLIC_SITE_URL: "https://roomly.example/app" },
      "sin ruta",
    ],
    [
      "sitio = Supabase",
      { NEXT_PUBLIC_SITE_URL: `https://${REF}.supabase.co` },
      "no la de la app",
    ],
    [
      "realtime inválido",
      { NEXT_PUBLIC_CHAT_REALTIME: "yes" },
      "NEXT_PUBLIC_CHAT_REALTIME",
    ],
  ])("error: %s", (_label, overrides, message) => {
    const { errors } = check({ ...VALID, ...overrides } as Record<
      string,
      string | undefined
    >);
    expect(errors.join("\n")).toContain(message);
  });

  it("refs prohibidos extra por DEPLOY_FORBIDDEN_SUPABASE_REFS", () => {
    expect(
      check({ ...VALID, DEPLOY_FORBIDDEN_SUPABASE_REFS: " abcd , otro" }).errors.join()
    ).toContain("proyecto prohibido");
  });

  it("un dominio de staging en producción es un error", () => {
    expect(check(VALID, "production").errors.join()).toContain("dominio de staging");
  });

  it("formatos no reconocidos y URL sin ref: solo avisos", () => {
    const { errors, warnings } = check({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_URL: "https://db.roomly.example",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "clave-rara",
      SUPABASE_SERVICE_ROLE_KEY: "otra-clave-rara",
      NODE_ENV: "development",
    });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(4);
  });
});
