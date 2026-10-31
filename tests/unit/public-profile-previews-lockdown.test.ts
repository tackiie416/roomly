import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Hotfix de seguridad (2026-10-31) — public_profile_previews sin privilegios
// de clientes (20261014120000). La vista es `security_invoker = false` y
// actualizable: cualquier privilegio de escritura de PUBLIC, anon o
// authenticated sobre ella vuelve a abrir la escritura en `profiles` sin RLS.
// Este test lee las migraciones y falla si una posterior al hotfix:
//   - concede cualquier privilegio sobre la vista a PUBLIC, anon o
//     authenticated (también por columnas o con ALL);
//   - concede algo sobre «all tables in schema public» a esos roles, o les
//     cambia los privilegios por defecto (alcanzaría a la vista);
//   - vuelve a crear la vista (una vista nueva recibe los privilegios por
//     defecto de Supabase: todos para anon y authenticated).
// Cualquiera de esas cosas necesita una decisión de seguridad explícita y un
// cambio consciente de este test. Lo que pasa en la base de datos lo prueban
// tests/db/24 y P4 del preflight.

const MIGRATIONS_DIR = "supabase/migrations";
const HOTFIX = "20261014120000_public_profile_previews_write_lockdown.sql";
const ORIGINAL = "20260925120100_rls_policies.sql";
const CLIENT_ROLES = ["public", "anon", "authenticated"];

/** SQL sin comentarios `--` ni `/* *\/`, en minúsculas y con espacios normalizados. */
function normalizedSql(file: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const after = (file: string) => migrations.filter((name) => name > file);

/** Roles de la cláusula TO de un GRANT, sin `with grant option`. */
function grantees(clause: string): string[] {
  return clause
    .replace(/\bwith grant option\b/, "")
    .split(",")
    .map((role) => role.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/** GRANT sobre la vista: privilegios y roles de cada uno. */
function viewGrants(sql: string) {
  const pattern =
    /\bgrant\s+([^;]*?)\s+on\s+(?:table\s+)?(?:public\.)?"?public_profile_previews"?\s+to\s+([^;]*?)\s*;/g;
  return [...sql.matchAll(pattern)].map((match) => ({
    privileges: match[1].trim(),
    roles: grantees(match[2]),
  }));
}

describe("el hotfix 20261014120000 existe y revoca todo a los clientes", () => {
  it("está en las migraciones", () => {
    expect(migrations).toContain(HOTFIX);
  });

  it("revoca ALL de PUBLIC, anon y authenticated, y comprueba el resultado", () => {
    const sql = normalizedSql(HOTFIX);
    for (const role of CLIENT_ROLES)
      expect(sql).toContain(
        `revoke all on table public.public_profile_previews from ${role};`
      );
    expect(sql).toMatch(
      /has_table_privilege\(grantee, 'public\.public_profile_previews'/
    );
    expect(sql).toMatch(
      /has_any_column_privilege\(grantee, 'public\.public_profile_previews'/
    );
    // El hotfix no concede nada ni toca profiles.
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).not.toMatch(/\bon (?:table )?(?:public\.)?profiles\b/);
  });

  it("va después de la última migración que concede sobre la vista y antes de la primera de la Fase 4.1 (20261015120000)", () => {
    expect(HOTFIX > ORIGINAL).toBe(true);
    expect(HOTFIX < "20261015120000").toBe(true);
    const granting = migrations.filter(
      (name) => viewGrants(normalizedSql(name)).length > 0
    );
    expect(granting).toEqual([ORIGINAL]);
  });
});

describe("ninguna migración posterior vuelve a abrir la vista", () => {
  it("el GRANT histórico de 20260925120100 es solo SELECT (el resto venía de los privilegios por defecto)", () => {
    expect(viewGrants(normalizedSql(ORIGINAL))).toEqual([
      { privileges: "select", roles: ["anon", "authenticated"] },
    ]);
  });

  it("ningún GRANT sobre la vista a PUBLIC, anon o authenticated después del hotfix", () => {
    const offenders = after(HOTFIX).flatMap((name) =>
      viewGrants(normalizedSql(name))
        .filter((grant) => grant.roles.some((role) => CLIENT_ROLES.includes(role)))
        .map((grant) => `${name}: grant ${grant.privileges} to ${grant.roles.join(", ")}`)
    );
    expect(offenders).toEqual([]);
  });

  it("ningún GRANT sobre todas las tablas del esquema ni cambio de privilegios por defecto para esos roles", () => {
    const pattern =
      /\bgrant\s+[^;]*?\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+([^;]*?)\s*;|\balter\s+default\s+privileges\b[^;]*?\bgrant\b[^;]*?\bon\s+tables\b[^;]*?\bto\s+([^;]*?)\s*;/g;
    const offenders = migrations.flatMap((name) =>
      [...normalizedSql(name).matchAll(pattern)]
        .filter((match) =>
          grantees(match[1] ?? match[2]).some((role) => CLIENT_ROLES.includes(role))
        )
        .map(() => name)
    );
    expect(offenders).toEqual([]);
  });

  it("nadie vuelve a crear la vista (recibiría de nuevo los privilegios por defecto)", () => {
    const creators = migrations.filter((name) =>
      /\bcreate\s+(?:or\s+replace\s+)?view\s+(?:public\.)?"?public_profile_previews"?/.test(
        normalizedSql(name)
      )
    );
    expect(creators).toEqual([ORIGINAL]);
  });
});

describe("el detector reconoce lo que debe impedir", () => {
  it("encuentra GRANT de DML, ALL y por columnas, con o sin esquema", () => {
    const sql = [
      "grant update on public.public_profile_previews to anon;",
      "grant all on table public_profile_previews to authenticated with grant option;",
      'grant select (full_name) on "public_profile_previews" to public;',
    ].join(" ");
    expect(viewGrants(sql)).toEqual([
      { privileges: "update", roles: ["anon"] },
      { privileges: "all", roles: ["authenticated"] },
      { privileges: "select (full_name)", roles: ["public"] },
    ]);
  });
});
