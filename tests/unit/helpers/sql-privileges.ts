import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Lectura heurística de GRANT, REVOKE y CREATE VIEW en las migraciones, para
 * los tests estáticos de privilegios (hotfix 20261014120000 y guardas de
 * vistas, sesión 73).
 *
 * Es una ayuda, no una garantía: no ve el SQL dinámico (`execute format(...)`
 * dentro de un DO o una función), ni una concesión que llegue por pertenencia
 * a otro rol creada fuera de las migraciones, ni privilegios por defecto
 * cambiados a mano en un proyecto. La garantía son los tests que miran los
 * privilegios EFECTIVOS en la base de datos (tests/db/24 y 25, P4 y P5 del
 * preflight).
 */

export const MIGRATIONS_DIR = "supabase/migrations";
export const CLIENT_ROLES = ["public", "anon", "authenticated"] as const;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** SQL sin comentarios `--` ni `/* *\/`, en minúsculas y con los espacios normalizados. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function migrationSql(file: string): string {
  return normalizeSql(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
}

/** Separa por comas de primer nivel (las firmas de funciones llevan comas entre paréntesis). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Nombre sin esquema `public.` ni comillas. */
export function bareName(name: string): string {
  return name
    .trim()
    .replace(/^"?public"?\./, "")
    .replace(/^"|"$/g, "");
}

export type ObjectKind =
  | "relation"
  | "function"
  | "sequence"
  | "schema"
  | "all-tables"
  | "all-functions"
  | "all-sequences"
  | "other";

export type PrivilegeStatement = {
  kind: "grant" | "revoke";
  /** Privilegios tal cual (p. ej. `select, update (full_name)` o `all privileges`). */
  privileges: string;
  objectKind: ObjectKind;
  /** Objetos sin esquema ni comillas (para «all … in schema», el esquema). */
  objects: string[];
  /** Roles de TO (grant) o FROM (revoke), sin comillas ni `with grant option`. */
  roles: string[];
  statement: string;
};

function objectList(text: string): { objectKind: ObjectKind; objects: string[] } {
  const all =
    /^all (tables|functions|sequences|routines|procedures) in schema (.+)$/.exec(text);
  if (all) {
    const kind: ObjectKind =
      all[1] === "tables"
        ? "all-tables"
        : all[1] === "sequences"
          ? "all-sequences"
          : "all-functions";
    return { objectKind: kind, objects: splitTopLevel(all[2]).map(bareName) };
  }
  const typed =
    /^(table|function|procedure|routine|sequence|schema|type|domain|database)\s+(.+)$/.exec(
      text
    );
  const keyword = typed?.[1];
  const rest = typed ? typed[2] : text;
  const objectKind: ObjectKind =
    keyword === undefined || keyword === "table"
      ? "relation"
      : keyword === "sequence"
        ? "sequence"
        : keyword === "schema"
          ? "schema"
          : ["function", "procedure", "routine"].includes(keyword)
            ? "function"
            : "other";
  return { objectKind, objects: splitTopLevel(rest).map(bareName) };
}

function roleList(text: string): string[] {
  return splitTopLevel(
    text
      .replace(/\bwith grant option\b/, "")
      .replace(/\bgranted by\b.*$/, "")
      .replace(/\b(cascade|restrict)\b/g, "")
  ).map((role) => role.replace(/^"|"$/g, "").replace(/^group\s+/, ""));
}

/**
 * GRANT y REVOKE de privilegios sobre objetos (con cláusula ON), también con
 * varias relaciones en una sola sentencia, por columnas o sobre «all tables in
 * schema». No incluye las concesiones de pertenencia a roles (ver
 * `roleMembershipGrants`).
 */
export function privilegeStatements(sql: string): PrivilegeStatement[] {
  const out: PrivilegeStatement[] = [];
  const grant = /\bgrant\s+([^;]*?)\s+on\s+([^;]*?)\s+to\s+([^;]*?)\s*;/g;
  for (const match of sql.matchAll(grant)) {
    const { objectKind, objects } = objectList(match[2].trim());
    out.push({
      kind: "grant",
      privileges: match[1].trim(),
      objectKind,
      objects,
      roles: roleList(match[3]),
      statement: match[0],
    });
  }
  const revoke =
    /\brevoke\s+(?:grant option for\s+)?([^;]*?)\s+on\s+([^;]*?)\s+from\s+([^;]*?)\s*;/g;
  for (const match of sql.matchAll(revoke)) {
    const { objectKind, objects } = objectList(match[2].trim());
    out.push({
      kind: "revoke",
      privileges: match[1].trim(),
      objectKind,
      objects,
      roles: roleList(match[3]),
      statement: match[0],
    });
  }
  return out;
}

/** `grant rol_a, rol_b to rol_c;` (pertenencia a roles, sin ON). */
export function roleMembershipGrants(
  sql: string
): Array<{ roles: string[]; to: string[] }> {
  const pattern = /\bgrant\s+([a-z_"][a-z0-9_",\s]*?)\s+to\s+([^;]*?)\s*;/g;
  return [...sql.matchAll(pattern)]
    .filter((match) => !/\bon\b/.test(match[1]))
    .map((match) => ({ roles: roleList(match[1]), to: roleList(match[2]) }));
}

/** Privilegios que permiten escribir (o equivalentes): INSERT, UPDATE, DELETE, TRUNCATE o ALL. */
export function grantsWrite(privileges: string): boolean {
  return /\b(all|insert|update|delete|truncate)\b/.test(privileges);
}

/** ¿Revoca, al menos, INSERT, UPDATE y DELETE? (ALL lo incluye.) */
export function revokesWrites(privileges: string): boolean {
  if (/\ball\b/.test(privileges)) return true;
  return ["insert", "update", "delete"].every((p) =>
    new RegExp(`\\b${p}\\b`).test(privileges)
  );
}

export type CreatedView = {
  file: string;
  name: string;
  materialized: boolean;
  /** Opciones de WITH (...) antes de AS, normalizadas. */
  options: string;
  securityInvoker: boolean;
  /** Posición en el SQL normalizado de la migración (para «después de crearla»). */
  index: number;
};

/** Vistas que crea una migración (CREATE [OR REPLACE] [MATERIALIZED] VIEW). */
export function createdViews(file: string, sql: string): CreatedView[] {
  const pattern =
    /\bcreate\s+(?:or\s+replace\s+)?(materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?((?:"?public"?\.)?"?[a-z_][a-z0-9_]*"?)\s*(?:\(([^)]*)\))?\s*(?:with\s*\(([^)]*)\))?\s+as\b/g;
  return [...sql.matchAll(pattern)].map((match) => {
    const options = (match[4] ?? "").replace(/\s+/g, "");
    return {
      file,
      name: bareName(match[2]),
      materialized: Boolean(match[1]),
      options,
      securityInvoker: /security_invoker=(true|on|1|yes)\b/.test(options),
      index: match.index ?? 0,
    };
  });
}
