import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Tipos y utilidades comunes de lib/services/*.
 *
 * Los servicios reciben el cliente Supabase de servidor (lib/supabase/server.ts),
 * que usa la clave pública y pasa por RLS. Nunca el de service_role.
 */

export type DbClient = SupabaseClient<Database>;

export type ServiceErrorCode =
  | "unauthenticated"
  | "validation"
  | "no_profile"
  | "deleted"
  | "not_found"
  | "conflict"
  | "forbidden"
  | "unknown";

export type FieldErrors = Record<string, string[]>;

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceErrorCode; fieldErrors?: FieldErrors };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  error: ServiceErrorCode,
  fieldErrors?: FieldErrors
): ServiceResult<T> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** Forma mínima de un error de PostgREST/Postgres que nos interesa. */
export type DbError = { code?: string; message?: string } | null | undefined;

/**
 * Cómo traducir un error concreto de la base de datos a un error de campo.
 * `match` se busca en el mensaje del error (nombre de la constraint o
 * prefijo del mensaje del trigger), que nunca se devuelve al usuario.
 */
export type DbFieldRule = { code: string; match: string; field: string; message: string };

/**
 * Traduce un error de base de datos a un resultado de servicio sin exponer
 * el mensaje original:
 *   - las reglas conocidas (CHECK, FK, trigger) → `validation` con el campo;
 *   - 42501 (RLS o GRANT) → `forbidden`;
 *   - cualquier otro → `unknown`.
 */
export function mapDbError<T = never>(
  error: DbError,
  rules: DbFieldRule[] = []
): ServiceResult<T> {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  const rule = rules.find(
    (candidate) => candidate.code === code && message.includes(candidate.match)
  );
  if (rule) return fail("validation", { [rule.field]: [rule.message] });
  if (code === "42501") return fail("forbidden");
  return fail("unknown");
}

/** Id del usuario de la sesión, siempre de `auth.getUser()` (nunca del input). */
export async function getSessionUserId(supabase: DbClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}
