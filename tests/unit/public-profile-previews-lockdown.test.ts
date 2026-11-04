import { describe, expect, it } from "vitest";
import {
  CLIENT_ROLES,
  migrationFiles,
  migrationSql,
  normalizeSql,
  privilegeStatements,
} from "./helpers/sql-privileges";

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

const HOTFIX = "20261014120000_public_profile_previews_write_lockdown.sql";
const ORIGINAL = "20260925120100_rls_policies.sql";
const VIEW = "public_profile_previews";

const migrations = migrationFiles();
const normalizedSql = migrationSql;
const after = (file: string) => migrations.filter((name) => name > file);
const isClient = (role: string) => (CLIENT_ROLES as readonly string[]).includes(role);

/**
 * GRANT sobre la vista (parser compartido de tests/unit/helpers/sql-privileges.ts:
 * también cuando la vista va en un GRANT con varias relaciones). Heurístico:
 * no ve SQL dinámico ni pertenencias a roles; eso lo miran tests/db/24 y P4.
 */
function viewGrants(sql: string) {
  return privilegeStatements(sql)
    .filter(
      (s) => s.kind === "grant" && s.objectKind === "relation" && s.objects.includes(VIEW)
    )
    .map((s) => ({ privileges: s.privileges, roles: s.roles }));
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
        .filter((grant) => grant.roles.some(isClient))
        .map((grant) => `${name}: grant ${grant.privileges} to ${grant.roles.join(", ")}`)
    );
    expect(offenders).toEqual([]);
  });

  it("ningún GRANT sobre todas las tablas del esquema ni cambio de privilegios por defecto para esos roles", () => {
    const defaults =
      /\balter\s+default\s+privileges\b[^;]*?\bgrant\b[^;]*?\bon\s+tables\b[^;]*?\bto\s+([^;]*?)\s*;/g;
    const offenders = migrations.flatMap((name) => {
      const sql = normalizedSql(name);
      const allTables = privilegeStatements(sql).filter(
        (s) =>
          s.kind === "grant" && s.objectKind === "all-tables" && s.roles.some(isClient)
      );
      const defaultGrants = [...sql.matchAll(defaults)].filter((match) =>
        match[1]
          .split(",")
          .map((role) => role.trim().replace(/^"|"$/g, ""))
          .some(isClient)
      );
      return allTables.length + defaultGrants.length > 0 ? [name] : [];
    });
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
  it("encuentra GRANT de DML, ALL, por columnas y con varias relaciones, con o sin esquema", () => {
    const sql = normalizeSql(
      [
        "grant update on public.public_profile_previews to anon;",
        "grant all on table public_profile_previews to authenticated with grant option;",
        'grant select (full_name) on "public_profile_previews" to public;',
        "grant select, delete on public.profiles, public.public_profile_previews to anon;",
      ].join(" ")
    );
    expect(viewGrants(sql)).toEqual([
      { privileges: "update", roles: ["anon"] },
      { privileges: "all", roles: ["authenticated"] },
      { privileges: "select (full_name)", roles: ["public"] },
      { privileges: "select, delete", roles: ["anon"] },
    ]);
  });
});
