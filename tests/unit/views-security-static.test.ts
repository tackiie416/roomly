import { describe, expect, it } from "vitest";
import {
  CLIENT_ROLES,
  createdViews,
  grantsWrite,
  migrationFiles,
  migrationSql,
  normalizeSql,
  privilegeStatements,
  revokesWrites,
  roleMembershipGrants,
} from "./helpers/sql-privileges";

// Guardas generales de vistas (sesión 73, primera etapa del endurecimiento
// tras el hotfix 20261014120000). Lee todas las migraciones y falla si:
//   1. una vista nueva no es `security_invoker = true` (una vista que se
//      ejecuta con los privilegios de su dueño, `postgres` con BYPASSRLS en
//      Supabase, se salta la RLS incluso solo para leer) salvo excepción
//      aprobada en VIEW_EXCEPTIONS;
//   2. una vista nueva no revoca, en su misma migración y después de crearla,
//      todos los privilegios de PUBLIC, anon y authenticated (los privilegios
//      por defecto de Supabase les dan ALL a cualquier vista que cree
//      `postgres`);
//   3. alguna migración concede INSERT, UPDATE, DELETE, TRUNCATE o ALL sobre
//      una vista a PUBLIC, anon o authenticated (también en un GRANT con
//      varias relaciones o por columnas);
//   4. alguna migración concede algo sobre «all tables in schema» a esos roles,
//      cambia sus privilegios por defecto sobre tablas o les da la
//      pertenencia a otro rol.
// Es un test heurístico: no ve SQL dinámico ni concesiones hechas fuera de las
// migraciones. La garantía principal son los privilegios EFECTIVOS que miran
// tests/db/25_views_security.sql y P5 del preflight.

/**
 * Excepciones aprobadas. Hoy solo la vista de la Fase 0, que es
 * `security_invoker = false` (decisión H3/H4) y desde el hotfix
 * 20261014120000 no tiene NINGÚN privilegio de clientes (lo exige
 * tests/unit/public-profile-previews-lockdown.test.ts). Añadir una entrada
 * aquí necesita una decisión de seguridad explícita y documentada.
 */
const VIEW_EXCEPTIONS: Record<
  string,
  { createdIn: string; definer: boolean; lockedDownIn: string; reason: string }
> = {
  public_profile_previews: {
    createdIn: "20260925120100_rls_policies.sql",
    definer: true,
    lockedDownIn: "20261014120000_public_profile_previews_write_lockdown.sql",
    reason:
      "Fase 0 (H3/H4). security_invoker = false; sin privilegios de clientes desde el hotfix.",
  },
};

const migrations = migrationFiles();
const sqlByFile = new Map(migrations.map((file) => [file, migrationSql(file)]));
const views = migrations.flatMap((file) => createdViews(file, sqlByFile.get(file) ?? ""));
const viewNames = new Set(views.map((view) => view.name));
const clientRole = (role: string) => (CLIENT_ROLES as readonly string[]).includes(role);

describe("vistas de las migraciones", () => {
  it("se reconocen las vistas creadas (hoy, una)", () => {
    expect(views.map((view) => `${view.file}:${view.name}`)).toEqual([
      "20260925120100_rls_policies.sql:public_profile_previews",
    ]);
  });

  it("1. toda vista es security_invoker = true, salvo una excepción aprobada", () => {
    const offenders = views
      .filter((view) => !view.securityInvoker)
      .filter((view) => {
        const exception = VIEW_EXCEPTIONS[view.name];
        return !(exception && exception.definer && exception.createdIn === view.file);
      })
      .map(
        (view) => `${view.file}: ${view.name} (opciones: ${view.options || "ninguna"})`
      );
    expect(offenders).toEqual([]);
  });

  it("2. toda vista nueva revoca, en su migración, todo a PUBLIC, anon y authenticated", () => {
    const offenders = views
      .filter((view) => !VIEW_EXCEPTIONS[view.name])
      .flatMap((view) => {
        const sql = sqlByFile.get(view.file) ?? "";
        const later = privilegeStatements(sql.slice(view.index)).filter(
          (s) =>
            s.kind === "revoke" &&
            s.objectKind === "relation" &&
            s.objects.includes(view.name) &&
            revokesWrites(s.privileges)
        );
        const revoked = new Set(later.flatMap((s) => s.roles));
        return CLIENT_ROLES.filter((role) => !revoked.has(role)).map(
          (role) => `${view.file}: ${view.name} sin revocar a ${role}`
        );
      });
    expect(offenders).toEqual([]);
  });

  it("la excepción aprobada está bloqueada por el hotfix (REVOKE ALL a los tres roles)", () => {
    for (const [name, exception] of Object.entries(VIEW_EXCEPTIONS)) {
      const revoked = privilegeStatements(sqlByFile.get(exception.lockedDownIn) ?? "")
        .filter(
          (s) =>
            s.kind === "revoke" &&
            s.objects.includes(name) &&
            /\ball\b/.test(s.privileges)
        )
        .flatMap((s) => s.roles);
      for (const role of CLIENT_ROLES) expect(revoked).toContain(role);
    }
  });
});

describe("ninguna migración abre escritura de clientes sobre vistas", () => {
  it("3. ningún GRANT de escritura sobre una vista a PUBLIC, anon o authenticated", () => {
    const offenders = migrations.flatMap((file) =>
      privilegeStatements(sqlByFile.get(file) ?? "")
        .filter(
          (s) =>
            s.kind === "grant" &&
            s.objectKind === "relation" &&
            s.objects.some((object) => viewNames.has(object)) &&
            s.roles.some(clientRole) &&
            grantsWrite(s.privileges)
        )
        .map((s) => `${file}: ${s.statement}`)
    );
    expect(offenders).toEqual([]);
  });

  it("4a. nada sobre «all tables in schema» para esos roles", () => {
    const offenders = migrations.flatMap((file) =>
      privilegeStatements(sqlByFile.get(file) ?? "")
        .filter(
          (s) =>
            s.kind === "grant" &&
            s.objectKind === "all-tables" &&
            s.roles.some(clientRole)
        )
        .map((s) => `${file}: ${s.statement}`)
    );
    expect(offenders).toEqual([]);
  });

  it("4b. ningún privilegio por defecto nuevo para esos roles", () => {
    const pattern =
      /\balter\s+default\s+privileges\b[^;]*?\bgrant\b[^;]*?\bto\s+([^;]*?)\s*;/g;
    const offenders = migrations.flatMap((file) =>
      [...(sqlByFile.get(file) ?? "").matchAll(pattern)]
        .filter((match) =>
          match[1]
            .split(",")
            .map((role) => role.trim().replace(/^"|"$/g, ""))
            .some(clientRole)
        )
        .map((match) => `${file}: ${match[0]}`)
    );
    expect(offenders).toEqual([]);
  });

  it("4c. ninguna pertenencia a otro rol para esos roles", () => {
    const offenders = migrations.flatMap((file) =>
      roleMembershipGrants(sqlByFile.get(file) ?? "")
        .filter((grant) => grant.to.some(clientRole))
        .map(
          (grant) => `${file}: grant ${grant.roles.join(", ")} to ${grant.to.join(", ")}`
        )
    );
    expect(offenders).toEqual([]);
  });
});

describe("el detector reconoce lo que debe impedir (y lo que no)", () => {
  const sql = normalizeSql(`
    create view public.v_ok with (security_invoker = true) as select 1 as x;
    revoke all on public.v_ok from public, anon, authenticated;
    grant select on public.v_ok to authenticated;
    create materialized view "v_mat" as select 1 as x;
    create or replace view public.v_def as select 1 as x;
    grant select, update on public.rooms, public.v_def to anon;
    grant insert (x) on table v_ok to "authenticated" with grant option;
    grant execute on function public.f(uuid, text), public.g() to anon;
    grant service_role to anon;
    grant usage on schema public to anon;
    revoke insert, update, delete on v_def from authenticated;
  `);

  it("CREATE VIEW: nombre, materializada y security_invoker", () => {
    expect(
      createdViews("x.sql", sql).map((v) => [v.name, v.materialized, v.securityInvoker])
    ).toEqual([
      ["v_ok", false, true],
      ["v_mat", true, false],
      ["v_def", false, false],
    ]);
  });

  it("GRANT con varias relaciones, por columnas, con comillas y sobre funciones", () => {
    const grants = privilegeStatements(sql).filter((s) => s.kind === "grant");
    expect(grants.map((s) => [s.privileges, s.objectKind, s.objects, s.roles])).toEqual([
      ["select", "relation", ["v_ok"], ["authenticated"]],
      ["select, update", "relation", ["rooms", "v_def"], ["anon"]],
      ["insert (x)", "relation", ["v_ok"], ["authenticated"]],
      ["execute", "function", ["f(uuid, text)", "g()"], ["anon"]],
      ["usage", "schema", ["public"], ["anon"]],
    ]);
    expect(grantsWrite("select, update")).toBe(true);
    expect(grantsWrite("insert (x)")).toBe(true);
    expect(grantsWrite("select")).toBe(false);
  });

  it("REVOKE: privilegios, objetos y roles", () => {
    const revokes = privilegeStatements(sql).filter((s) => s.kind === "revoke");
    expect(revokes.map((s) => [s.privileges, s.objects, s.roles])).toEqual([
      ["all", ["v_ok"], ["public", "anon", "authenticated"]],
      ["insert, update, delete", ["v_def"], ["authenticated"]],
    ]);
    expect(revokesWrites("insert, update, delete")).toBe(true);
    expect(revokesWrites("update")).toBe(false);
  });

  it("pertenencia a roles (sin ON)", () => {
    expect(roleMembershipGrants(sql)).toEqual([
      { roles: ["service_role"], to: ["anon"] },
    ]);
  });
});
