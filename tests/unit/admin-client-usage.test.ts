import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

// Fase 3.1 (D17) — service_role solo en el servidor y solo en dos servicios:
//   - lib/services/matching.ts: lectura cruzada de candidatos;
//   - lib/services/compatibility.ts: escritura del test propio.
// Ningún otro archivo de la app (app/, components/, lib/, proxy.ts) puede
// importar lib/supabase/admin.ts ni usar createAdminClient(); la clave solo
// la leen lib/env.server.ts (server-only) y lib/supabase/admin.ts; ningún
// componente de cliente importa servicios ni la configuración privada.
// lib/env.ts es solo pública: lo importa también lib/supabase/client.ts, y lo
// que contiene puede llegar a los bundles del navegador (D1 lo comprueba sobre
// el build de E1: tests/e2e/local/no-service-key-in-client.spec.ts).

const ALLOWED = ["lib/services/compatibility.ts", "lib/services/matching.ts"];
const DEFINITION = "lib/supabase/admin.ts";
const PRIVATE_ENV = "lib/env.server.ts";
const PUBLIC_ENV = "lib/env.ts";
const KEY_READERS = [PRIVATE_ENV, DEFINITION];
/** Cualquier importación de lib/env.server: `from`, solo por efecto, `import()` o `require`. */
const PRIVATE_ENV_IMPORT =
  /\b(?:from|import|require)\s*\(?\s*["'][^"']*\benv\.server(?:\.ts)?["']/;

/** Código sin comentarios. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [full.split(path.sep).join("/")] : [];
  });
}

const APP_FILES = [
  ...sourceFiles("app"),
  ...sourceFiles("components"),
  ...sourceFiles("lib"),
  ...(existsSync("proxy.ts") ? ["proxy.ts"] : []),
];

describe("createAdminClient / service_role: solo en los dos servicios autorizados", () => {
  it("solo lib/services/{matching,compatibility}.ts importan lib/supabase/admin", () => {
    const importers = APP_FILES.filter((file) =>
      /from\s+["']@\/lib\/supabase\/admin["']|require\(["']@\/lib\/supabase\/admin["']\)/.test(
        code(file)
      )
    ).sort();
    expect(importers).toEqual(ALLOWED);
  });

  it("solo esos dos archivos (y la definición) mencionan createAdminClient", () => {
    const users = APP_FILES.filter((file) =>
      code(file).includes("createAdminClient")
    ).sort();
    expect(users).toEqual([...ALLOWED, DEFINITION].sort());
  });

  it("la clave service_role solo la leen lib/env.server.ts y lib/supabase/admin.ts", () => {
    const readers = APP_FILES.filter((file) =>
      /SUPABASE_SERVICE_ROLE_KEY|getServiceRoleKey/.test(code(file))
    ).sort();
    expect(readers).toEqual(KEY_READERS);
  });

  it("lib/env.ts (pública, la importa el cliente) no menciona la clave ni importa la configuración privada", () => {
    expect(code(PUBLIC_ENV)).not.toMatch(/SERVICE_ROLE|service_role|serviceRole/i);
    expect(code(PUBLIC_ENV)).not.toMatch(PRIVATE_ENV_IMPORT);
  });

  it("solo el cliente admin importa lib/env.server, y lee la clave con su getServiceRoleKey()", () => {
    const importers = APP_FILES.filter((file) => PRIVATE_ENV_IMPORT.test(code(file)));
    expect(importers).toEqual([DEFINITION]);
    const admin = code(DEFINITION);
    expect(admin).toContain('import { getServiceRoleKey } from "@/lib/env.server";');
    expect(admin).toContain("const serviceRoleKey = getServiceRoleKey();");
    expect(admin).not.toMatch(/process\.env/);
  });

  it("los dos servicios, el cliente admin y la configuración privada son server-only", () => {
    for (const file of [...ALLOWED, DEFINITION, PRIVATE_ENV]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/^import "server-only";/);
    }
  });

  it("ningún componente de cliente importa servicios ni el cliente admin", () => {
    const clientFiles = APP_FILES.filter((file) =>
      /^\s*["']use client["'];?/m.test(readFileSync(file, "utf8"))
    );
    for (const file of clientFiles) {
      expect(code(file), file).not.toMatch(/@\/lib\/services\/|@\/lib\/supabase\/admin/);
      expect(code(file), file).not.toMatch(PRIVATE_ENV_IMPORT);
    }
  });

  it("ninguna variable NEXT_PUBLIC_* lleva la clave service_role", () => {
    for (const file of APP_FILES) {
      expect(code(file), file).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);
    }
  });
});
