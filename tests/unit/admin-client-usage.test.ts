import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

// Fase 3.1 (D17) — service_role solo en el servidor y solo en tres servicios:
//   - lib/services/matching.ts: lectura cruzada de candidatos;
//   - lib/services/compatibility.ts: escritura del test propio;
//   - lib/services/room-images.ts (Fase 4.2, D17 ampliada): escritura de las
//     fotos (Storage y room_images) y firma de sus URL (D1). Es el único sitio
//     que emite URL de fotos, y nunca públicas.
// Ningún otro archivo de la app (app/, components/, lib/, proxy.ts) puede
// importar lib/supabase/admin.ts ni usar createAdminClient(); la clave solo
// la leen lib/env.server.ts (server-only) y lib/supabase/admin.ts; ningún
// componente de cliente importa servicios ni la configuración privada.
// lib/env.ts es solo pública: lo importa también lib/supabase/client.ts, y lo
// que contiene puede llegar a los bundles del navegador (D1 lo comprueba sobre
// el build de E1: tests/e2e/local/no-service-key-in-client.spec.ts).

const ALLOWED = [
  "lib/services/compatibility.ts",
  "lib/services/matching.ts",
  "lib/services/room-images.ts",
];
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

describe("createAdminClient / service_role: solo en los tres servicios autorizados", () => {
  it("solo lib/services/{matching,compatibility,room-images}.ts importan lib/supabase/admin", () => {
    const importers = APP_FILES.filter((file) =>
      /from\s+["']@\/lib\/supabase\/admin["']|require\(["']@\/lib\/supabase\/admin["']\)/.test(
        code(file)
      )
    ).sort();
    expect(importers).toEqual(ALLOWED);
  });

  it("solo esos tres archivos (y la definición) mencionan createAdminClient", () => {
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

  it("los tres servicios, el sanitizador de fotos, el cliente admin y la configuración privada son server-only", () => {
    for (const file of [
      ...ALLOWED,
      "lib/images/sanitize-room-image.ts",
      DEFINITION,
      PRIVATE_ENV,
    ]) {
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

describe("fotos de habitaciones (Fase 4.2, D1): sin URL públicas ni Storage fuera del servicio", () => {
  it("ningún archivo de la app construye URL públicas de Storage", () => {
    for (const file of APP_FILES) {
      expect(code(file), file).not.toMatch(/getPublicUrl|\/storage\/v1\/object\/public/);
    }
  });

  it("solo lib/services/room-images.ts usa la API de Storage (.storage.from)", () => {
    const users = APP_FILES.filter((file) =>
      /\.storage\s*\.from\(/.test(code(file))
    ).sort();
    expect(users).toEqual(["lib/services/room-images.ts"]);
  });

  it("solo el servicio de fotos importa el sanitizador (y sharp, solo el sanitizador)", () => {
    const sanitizer = APP_FILES.filter((file) =>
      /@\/lib\/images\/sanitize-room-image/.test(code(file))
    );
    expect(sanitizer).toEqual(["lib/services/room-images.ts"]);
    const sharp = APP_FILES.filter((file) => /from\s+["']sharp["']/.test(code(file)));
    expect(sharp).toEqual(["lib/images/sanitize-room-image.ts"]);
  });

  it("la limpieza de una habitación borrada solo la llama el servicio de habitaciones, que no usa service_role", () => {
    const callers = APP_FILES.filter(
      (file) =>
        file !== "lib/services/room-images.ts" &&
        /removeDeletedRoomObjects/.test(code(file))
    );
    expect(callers).toEqual(["lib/services/rooms.ts"]);
    expect(code("lib/services/rooms.ts")).not.toMatch(
      /@\/lib\/supabase\/admin|createAdminClient|\.storage\s*\.from\(/
    );
    expect(code("lib/services/rooms.ts")).toMatch(/^import "server-only";/);
  });

  it("ninguna Server Action ni página borra habitaciones directamente: solo deleteOwnRoom", () => {
    const deleters = APP_FILES.filter((file) =>
      /from\(\s*["']rooms["']\s*\)[\s\S]{0,200}?\.delete\(/.test(code(file))
    );
    expect(deleters).toEqual(["lib/services/rooms.ts"]);
  });
});
