import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ROOM_WRITABLE_COLUMNS } from "@/lib/validation/rooms";

// CRUD de habitaciones (sesión 68) — comprobaciones sobre el código fuente:
//   - R2: ningún archivo de la aplicación lee ni escribe `room_addresses`
//     (la dirección exacta no se pide ni se guarda);
//   - las columnas que escribe el CRUD están en el GRANT vigente de
//     `authenticated` sobre `rooms` (20261015120000), leído de la migración;
//   - INSERT y UPDATE separados: nunca `upsert`, y solo lib/services/rooms.ts
//     escribe en `rooms`, siempre con el cliente del usuario (el cliente admin
//     de ese archivo solo llama a delete_own_room: admin-client-usage.test.ts).

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
const SERVICE = "lib/services/rooms.ts";

const migration = readFileSync(
  "supabase/migrations/20261015120000_rooms_integrity_publication.sql",
  "utf8"
).replace(/--.*$/gm, "");
const grant = (kind: "insert" | "update") =>
  (
    migration.match(
      new RegExp(`grant ${kind} \\(([\\s\\S]*?)\\) on public\\.rooms to authenticated`)
    )?.[1] ?? ""
  )
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);

describe("R2: room_addresses no se toca desde la aplicación", () => {
  it("ningún archivo de app/, components/, lib/ ni proxy.ts la nombra en su código", () => {
    expect(APP_FILES.length).toBeGreaterThan(50);
    const offenders = APP_FILES.filter((file) => /room_addresses/.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it("el CRUD no lee ni escribe address_exact ni approx_*", () => {
    const service = code(SERVICE);
    expect(service).not.toMatch(/address_exact|approx_lat|approx_lng/);
    for (const file of APP_FILES.filter((f) => /habitaciones|components\/rooms/.test(f)))
      expect(code(file)).not.toMatch(/address_exact|approx_lat|approx_lng/);
  });
});

describe("las columnas que escribe el CRUD están en el GRANT de authenticated", () => {
  const insert = grant("insert");
  const update = grant("update");

  it("el GRANT se ha leído de la migración", () => {
    expect(insert).toHaveLength(20);
    expect(update).toHaveLength(19);
  });

  it("INSERT: las del formulario y owner_id (de la sesión); nunca status, deleted_at ni approx_*", () => {
    for (const column of [...ROOM_WRITABLE_COLUMNS, "owner_id"])
      expect(insert).toContain(column);
    for (const column of ["status", "deleted_at", "approx_lat", "approx_lng", "id"])
      expect(ROOM_WRITABLE_COLUMNS).not.toContain(column);
    expect(ROOM_WRITABLE_COLUMNS).not.toContain("owner_id");
  });

  it("UPDATE: las del formulario y, aparte, status; nunca id ni owner_id", () => {
    for (const column of [...ROOM_WRITABLE_COLUMNS, "status"])
      expect(update).toContain(column);
    expect(update).not.toContain("owner_id");
    expect(update).not.toContain("id");
  });

  it("el mock de E1 emula el mismo GRANT (no uno más permisivo)", () => {
    const mock = readFileSync("tests/e2e/support/mock-supabase.mjs", "utf8");
    const data = [
      ...(mock.match(/const ROOM_DATA_COLUMNS = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(
        /"([a-z_]+)"/g
      ),
    ].map(([, column]) => column);
    expect(mock).toMatch(
      /const ROOMS_INSERT = \["id", "owner_id", \.\.\.ROOM_DATA_COLUMNS\];/
    );
    expect(mock).toMatch(/const ROOMS_UPDATE = \[\.\.\.ROOM_DATA_COLUMNS, "status"\];/);
    expect(["id", "owner_id", ...data].sort()).toEqual([...insert].sort());
    expect([...data, "status"].sort()).toEqual([...update].sort());
  });

  it("el servicio escribe exactamente esos payloads: un INSERT y dos UPDATE", () => {
    const service = code(SERVICE);
    const inserts = [...service.matchAll(/\.insert\(([^)]*)\)/g)].map(([, arg]) =>
      arg.trim()
    );
    expect(inserts).toEqual(["{ ...fields, owner_id: userId }"]);
    const updates = [...service.matchAll(/\.update\(([^)]*)\)/g)]
      .map(([, arg]) => arg.trim())
      .sort();
    expect(updates).toEqual(["fields", "{ status }"]);
    // `fields` sale siempre de los esquemas estrictos (sin status ni owner_id).
    expect(service).toMatch(
      /const fields = parsed\.data;[\s\S]*const fields = parsed\.data;/
    );
  });
});

describe("INSERT y UPDATE separados: nunca upsert, y solo el servicio escribe en rooms", () => {
  it("ningún archivo de la aplicación llama a .upsert(", () => {
    const offenders = APP_FILES.filter((file) => /\.upsert\s*\(/.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it("toda escritura en rooms está en lib/services/rooms.ts", () => {
    const writers = APP_FILES.filter((file) =>
      [...code(file).matchAll(/\.from\(\s*["']rooms["']\s*\)([\s\S]*?);/g)].some(
        ([, chain]) => /\.(insert|update|upsert|delete)\s*\(/.test(chain)
      )
    );
    expect(writers).toEqual([SERVICE]);
  });

  it("app/actions/rooms.ts es orquestación: no consulta tablas ni usa service_role", () => {
    const actions = code("app/actions/rooms.ts");
    expect(actions).not.toMatch(
      /\.from\(|\.rpc\(|createAdminClient|lib\/supabase\/admin/
    );
  });
});
