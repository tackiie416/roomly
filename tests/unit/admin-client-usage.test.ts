import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

// Fase 3.1 (D17) — service_role solo en el servidor y solo en dos servicios:
//   - lib/services/matching.ts: lectura cruzada de candidatos;
//   - lib/services/compatibility.ts: escritura del test propio.
// Ningún otro archivo de la app (app/, components/, lib/, proxy.ts) puede
// importar lib/supabase/admin.ts ni usar createAdminClient(); la clave solo
// la leen lib/env.ts y lib/supabase/admin.ts; ningún componente de cliente
// importa servicios.

const ALLOWED = ["lib/services/compatibility.ts", "lib/services/matching.ts"];
const DEFINITION = "lib/supabase/admin.ts";
const KEY_READERS = ["lib/env.ts", "lib/supabase/admin.ts"];

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

  it("la clave service_role solo la leen lib/env.ts y lib/supabase/admin.ts", () => {
    const readers = APP_FILES.filter((file) =>
      /SUPABASE_SERVICE_ROLE_KEY|getServiceRoleKey/.test(code(file))
    ).sort();
    expect(readers).toEqual(KEY_READERS);
  });

  it("los dos servicios y el cliente admin son server-only", () => {
    for (const file of [...ALLOWED, DEFINITION]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/^import "server-only";/m);
    }
  });

  it("ningún componente de cliente importa servicios ni el cliente admin", () => {
    const clientFiles = APP_FILES.filter((file) =>
      /^\s*["']use client["'];?/m.test(readFileSync(file, "utf8"))
    );
    for (const file of clientFiles) {
      expect(code(file), file).not.toMatch(/@\/lib\/services\/|@\/lib\/supabase\/admin/);
    }
  });

  it("ninguna variable NEXT_PUBLIC_* lleva la clave service_role", () => {
    for (const file of APP_FILES) {
      expect(code(file), file).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);
    }
  });
});
