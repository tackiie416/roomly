import "server-only";

import type { Database } from "@/types/database";
import {
  dateOfBirthSchema,
  fullNameSchema,
  profileCreateSchema,
  profileUpdateSchema,
  seekingStatusSchema,
} from "@/lib/validation/profile";
import { toFieldErrors } from "@/lib/validation/common";
import {
  type DbClient,
  type DbFieldRule,
  type FieldErrors,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";

/**
 * Servicio del perfil propio (Fase 2.1).
 *
 * Server Action → este servicio → cliente Supabase de servidor → RLS.
 * El usuario sale siempre de `auth.getUser()`. Nunca se usa upsert (PR8:
 * `id` no está en el GRANT de UPDATE): crear es INSERT y, si ya existe, UPDATE
 * de los campos permitidos. Nunca se escriben `id` (en UPDATE), `role`,
 * `deleted_at`, `created_at` ni `updated_at`, y `onboarding_completed_at`
 * solo lo fija `completeOnboarding`.
 */

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/** Proyección explícita del perfil propio. Sin `role`. */
const OWN_PROFILE_COLUMNS =
  "id, full_name, date_of_birth, bio, seeking_status, email_notifications_enabled, onboarding_completed_at, deleted_at" as const;

export type OwnProfile = Pick<
  ProfileRow,
  | "id"
  | "full_name"
  | "date_of_birth"
  | "bio"
  | "seeking_status"
  | "email_notifications_enabled"
  | "onboarding_completed_at"
  | "deleted_at"
>;

/**
 * Estado del perfil de la sesión:
 *   - `no_profile`: no hay fila propia en `profiles`;
 *   - `deleted`: `deleted_at` no es nulo (tiene prioridad sobre todo);
 *   - `incomplete`: no eliminado y `onboarding_completed_at` nulo;
 *   - `complete`: no eliminado y `onboarding_completed_at` con valor.
 */
export type ProfileState =
  | { status: "no_profile" }
  | { status: "deleted" }
  | { status: "incomplete"; profile: OwnProfile; hasPreferences: boolean }
  | { status: "complete"; profile: OwnProfile };

/** CHECKs de `profiles` → campo del formulario. */
const PROFILE_DB_RULES: DbFieldRule[] = [
  {
    code: "23514",
    match: "chk_profiles_full_name",
    field: "full_name",
    message: "El nombre no es válido",
  },
  {
    code: "23514",
    match: "chk_min_age",
    field: "date_of_birth",
    message: "Tienes que tener al menos 18 años",
  },
  {
    code: "23514",
    match: "chk_profiles_bio_length",
    field: "bio",
    message: "La descripción admite como máximo 500 caracteres",
  },
];

/** Trigger de completitud del onboarding (Fase 2.3) → campo del formulario. */
const ONBOARDING_DB_RULES: DbFieldRule[] = [
  {
    code: "23514",
    match: "onboarding_incomplete:",
    field: "city_id",
    message: "Elige una ciudad para terminar",
  },
];

/** 23514 no reconocido: sigue siendo un dato rechazado por la base de datos. */
function mapProfileWriteError<T>(error: {
  code?: string;
  message?: string;
}): ServiceResult<T> {
  const mapped = mapDbError<T>(error, PROFILE_DB_RULES);
  if (!mapped.ok && mapped.error === "unknown" && error.code === "23514")
    return fail("validation");
  return mapped;
}

async function readOwnProfile(supabase: DbClient, userId: string) {
  return supabase
    .from("profiles")
    .select(OWN_PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
}

export async function getProfileState(
  supabase: DbClient
): Promise<ServiceResult<ProfileState>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const { data: profile, error } = await readOwnProfile(supabase, userId);
  if (error) return mapDbError(error);
  if (!profile) return ok({ status: "no_profile" });
  if (profile.deleted_at !== null) return ok({ status: "deleted" });
  if (profile.onboarding_completed_at !== null)
    return ok({ status: "complete", profile });

  const { data: preferences, error: preferencesError } = await supabase
    .from("housing_preferences")
    .select("profile_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (preferencesError) return mapDbError(preferencesError);

  return ok({ status: "incomplete", profile, hasPreferences: preferences !== null });
}

export async function createProfile(
  supabase: DbClient,
  input: unknown
): Promise<ServiceResult<OwnProfile>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const parsed = profileCreateSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));
  const fields = parsed.data;

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({ id: userId, ...fields })
    .select(OWN_PROFILE_COLUMNS)
    .single();
  if (!error) return ok(created);
  if (error.code !== "23505") return mapProfileWriteError(error);

  // 23505: el perfil ya existe. Solo puede ser el propio (RLS impide
  // insertar con otro id). Nunca se reactiva una cuenta eliminada.
  const { data: existing, error: readError } = await readOwnProfile(supabase, userId);
  if (readError || !existing) return mapDbError(readError);
  if (existing.deleted_at !== null) return fail("deleted");

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update(fields)
    .eq("id", userId)
    .select(OWN_PROFILE_COLUMNS)
    .single();
  if (updateError) return mapProfileWriteError(updateError);
  return ok(updated);
}

export async function updateProfile(
  supabase: DbClient,
  input: unknown
): Promise<ServiceResult<OwnProfile>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const { data: existing, error: readError } = await readOwnProfile(supabase, userId);
  if (readError) return mapDbError(readError);
  if (!existing) return fail("no_profile");
  // RLS permite hoy editar la propia fila aunque tenga deleted_at: el
  // servicio lo bloquea.
  if (existing.deleted_at !== null) return fail("deleted");

  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("id", userId)
    .select(OWN_PROFILE_COLUMNS)
    .single();
  if (error) return mapProfileWriteError(error);
  return ok(updated);
}

/**
 * Marca el onboarding como completado cuando se cumple el mínimo decidido:
 * perfil no eliminado con `full_name`, `date_of_birth` y `seeking_status`
 * válidos, y una fila de `housing_preferences` con `city_id`. El resto de
 * preferencias es opcional. Idempotente: si ya estaba completo, devuelve el
 * perfil sin tocar el timestamp.
 *
 * Límite conocido: la base de datos no distingue un `seeking_status` elegido
 * de su default `flexible`. La elección explícita se garantiza en la entrada
 * (`profileCreateSchema` lo exige sin valor por defecto) y la UI de 2.3 no
 * debe preseleccionarlo.
 */
export async function completeOnboarding(
  supabase: DbClient
): Promise<ServiceResult<OwnProfile>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const { data: profile, error: readError } = await readOwnProfile(supabase, userId);
  if (readError) return mapDbError(readError);
  if (!profile) return fail("no_profile");
  if (profile.deleted_at !== null) return fail("deleted");
  if (profile.onboarding_completed_at !== null) return ok(profile);

  const fieldErrors: FieldErrors = {};
  if (!fullNameSchema.safeParse(profile.full_name).success) {
    fieldErrors.full_name = ["Falta tu nombre"];
  }
  if (!dateOfBirthSchema.safeParse(profile.date_of_birth).success) {
    fieldErrors.date_of_birth = ["Falta una fecha de nacimiento válida"];
  }
  if (!seekingStatusSchema.safeParse(profile.seeking_status).success) {
    fieldErrors.seeking_status = ["Elige qué estás buscando"];
  }

  const { data: preferences, error: preferencesError } = await supabase
    .from("housing_preferences")
    .select("city_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (preferencesError) return mapDbError(preferencesError);
  if (!preferences) {
    fieldErrors.housing_preferences = ["Faltan tus preferencias de vivienda"];
  } else if (preferences.city_id === null) {
    fieldErrors.city_id = ["Elige una ciudad"];
  }

  if (Object.keys(fieldErrors).length > 0) return fail("validation", fieldErrors);

  // Solo si sigue sin completar: dos peticiones simultáneas no pisan el
  // timestamp de la primera.
  const { data: completed, error } = await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", userId)
    .is("onboarding_completed_at", null)
    .select(OWN_PROFILE_COLUMNS)
    .maybeSingle();
  // El trigger trg_profiles_onboarding_completion (Fase 2.3) rechaza la
  // escritura si, entre la comprobación y el UPDATE, faltan las preferencias
  // o la ciudad (p. ej. se borraron en otra pestaña).
  if (error) return mapDbError(error, ONBOARDING_DB_RULES);
  if (completed) return ok(completed);

  const { data: current, error: rereadError } = await readOwnProfile(supabase, userId);
  if (rereadError || !current) return mapDbError(rereadError);
  if (current.deleted_at !== null) return fail("deleted");
  if (current.onboarding_completed_at !== null) return ok(current);
  return fail("unknown");
}

/**
 * ¿La sesión es de un admin activo? Exige `role = 'admin'` **y**
 * `deleted_at` nulo: un admin con la cuenta eliminada no lo es (igual que
 * `is_admin()` en la base de datos, que sigue siendo la defensa real de los
 * datos). Lectura mínima y separada para que `OwnProfile` no exponga `role`.
 */
export async function isActiveAdmin(supabase: DbClient): Promise<ServiceResult<boolean>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const { data, error } = await supabase
    .from("profiles")
    .select("role, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  return ok(data !== null && data.role === "admin" && data.deleted_at === null);
}
