import "server-only";

import type { Database } from "@/types/database";
import {
  housingPreferencesCreateSchema,
  housingPreferencesUpdateSchema,
} from "@/lib/validation/housing-preferences";
import { toFieldErrors } from "@/lib/validation/common";
import {
  type DbClient,
  type DbFieldRule,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";

/**
 * Servicio de las preferencias de vivienda propias (Fase 2.1).
 *
 * Mismo patrón que el perfil: usuario de `auth.getUser()`, sin service_role,
 * sin upsert (el GRANT de UPDATE excluye `profile_id`). `profile_id` nunca
 * llega del input. La coherencia de barrios y las FKs las garantiza la base
 * de datos; aquí solo se traducen sus errores a errores de campo. Antes de
 * escribir, `checkPreferenceRules` comprueba también (Fases 2.3 y 2.5) que la
 * universidad sea de la ciudad, que una ciudad nueva esté activa y que, con
 * el onboarding completado, no se quite la ciudad; las dos reglas de datos
 * las repite la base de datos (`20260930140000`).
 */

type HousingPreferencesRow = Database["public"]["Tables"]["housing_preferences"]["Row"];
export type HousingPreferences = HousingPreferencesRow;

const HOUSING_PREFERENCES_COLUMNS =
  "profile_id, city_id, university_id, field_of_study, budget_min, budget_max, move_in_date, move_out_date, preferred_neighborhood_ids, roommates_wanted_min, roommates_wanted_max, updated_at" as const;

const CITY_REQUIRED_AFTER_ONBOARDING =
  "La ciudad es obligatoria: la necesitamos para buscarte piso y compañeros";
const CITY_NOT_AVAILABLE = "Esta ciudad todavía no está disponible";

/**
 * Errores conocidos → campo. El orden importa: el mensaje de "barrios sin
 * ciudad" es más concreto que el prefijo genérico del trigger.
 */
const HOUSING_DB_RULES: DbFieldRule[] = [
  {
    code: "23514",
    match: "housing_city_required:",
    field: "city_id",
    message: CITY_REQUIRED_AFTER_ONBOARDING,
  },
  {
    code: "23514",
    match: "housing_university:",
    field: "university_id",
    message: "La universidad no pertenece a la ciudad elegida",
  },
  {
    code: "23514",
    match: "housing_neighborhoods: no se pueden elegir barrios sin ciudad",
    field: "city_id",
    message: "Elige una ciudad para poder elegir barrios",
  },
  {
    code: "23514",
    match: "housing_neighborhoods:",
    field: "preferred_neighborhood_ids",
    message: "Algún barrio no pertenece a la ciudad elegida",
  },
  {
    code: "23503",
    match: "housing_neighborhoods:",
    field: "preferred_neighborhood_ids",
    message: "Algún barrio no existe",
  },
  {
    code: "23503",
    match: "housing_preferences_city_id_fkey",
    field: "city_id",
    message: "La ciudad no existe",
  },
  {
    code: "23503",
    match: "housing_preferences_university_id_fkey",
    field: "university_id",
    message: "La universidad no existe",
  },
  {
    code: "23514",
    match: "chk_housing_preferences_field_of_study",
    field: "field_of_study",
    message: "Los estudios admiten como máximo 120 caracteres",
  },
  {
    code: "23514",
    match: "chk_budget_positive",
    field: "budget_min",
    message: "El presupuesto no puede ser negativo",
  },
  {
    code: "23514",
    match: "chk_housing_preferences_budget_max_nonneg",
    field: "budget_max",
    message: "El presupuesto no puede ser negativo",
  },
  {
    code: "23514",
    match: "chk_budget_range",
    field: "budget_max",
    message: "El presupuesto máximo no puede ser menor que el mínimo",
  },
  {
    code: "23514",
    match: "chk_dates_range",
    field: "move_out_date",
    message: "La fecha de salida no puede ser anterior a la de entrada",
  },
  {
    code: "23514",
    match: "chk_housing_preferences_roommates",
    field: "roommates_wanted_max",
    message: "Revisa el número de compañeros",
  },
];

function mapHousingWriteError<T>(error: {
  code?: string;
  message?: string;
}): ServiceResult<T> {
  // FK de profile_id: el perfil no existe (o no es visible).
  if (
    error.code === "23503" &&
    (error.message ?? "").includes("housing_preferences_profile_id_fkey")
  ) {
    return fail("no_profile");
  }
  const mapped = mapDbError<T>(error, HOUSING_DB_RULES);
  if (!mapped.ok && mapped.error === "unknown" && error.code === "23514")
    return fail("validation");
  return mapped;
}

/**
 * Perfil propio existente y no eliminado; si no, el error correspondiente.
 * Devuelve si el onboarding está completado (Fase 2.5: cambia qué se puede
 * vaciar).
 */
async function requireActiveProfile(
  supabase: DbClient,
  userId: string
): Promise<ServiceResult<{ onboardingCompleted: boolean }>> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, deleted_at, onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!profile) return fail("no_profile");
  if (profile.deleted_at !== null) return fail("deleted");
  return ok({ onboardingCompleted: profile.onboarding_completed_at != null });
}

const UNIVERSITY_CITY_MISMATCH = "La universidad no pertenece a la ciudad elegida";

/**
 * Reglas que dependen de otros datos, antes de escribir. Si el input solo
 * trae uno de los campos, el otro es el valor ya guardado.
 *   - Con el onboarding completado, la ciudad no se puede quitar (Fase 2.5,
 *     riesgo C; también `trg_housing_preferences_city_required`).
 *   - Una ciudad nueva (distinta de la guardada) tiene que estar activa
 *     (`cities.is_active`, el rollout ciudad a ciudad). Una ciudad ya
 *     guardada que después se desactivó se puede conservar. Una inexistente
 *     la rechaza la FK al escribir ("La ciudad no existe").
 *   - La universidad tiene que ser de la ciudad elegida (Fase 2.3; también
 *     `trg_housing_preferences_university`). Una universidad sin ciudad vale
 *     con cualquiera.
 */
async function checkPreferenceRules(
  supabase: DbClient,
  userId: string,
  fields: { city_id?: string | null; university_id?: string | null },
  options: { onboardingCompleted: boolean }
): Promise<ServiceResult<true>> {
  if (fields.city_id === undefined && fields.university_id === undefined) return ok(true);

  if (fields.city_id === null && options.onboardingCompleted) {
    return fail("validation", { city_id: [CITY_REQUIRED_AFTER_ONBOARDING] });
  }

  const { data: current, error: currentError } = await supabase
    .from("housing_preferences")
    .select("city_id, university_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (currentError) return mapDbError(currentError);
  const cityId =
    fields.city_id === undefined ? (current?.city_id ?? null) : fields.city_id;
  const universityId =
    fields.university_id === undefined
      ? (current?.university_id ?? null)
      : fields.university_id;

  if (fields.city_id && fields.city_id !== current?.city_id) {
    const { data: city, error } = await supabase
      .from("cities")
      .select("id, is_active")
      .eq("id", fields.city_id)
      .maybeSingle();
    if (error) return mapDbError(error);
    if (city && !city.is_active) {
      return fail("validation", { city_id: [CITY_NOT_AVAILABLE] });
    }
  }

  if (!universityId) return ok(true);
  const { data: university, error } = await supabase
    .from("universities")
    .select("id, city_id")
    .eq("id", universityId)
    .maybeSingle();
  if (error) return mapDbError(error);
  // Inexistente: lo rechaza la FK al escribir ("La universidad no existe").
  if (!university || university.city_id === null) return ok(true);
  if (university.city_id !== cityId) {
    return fail("validation", { university_id: [UNIVERSITY_CITY_MISMATCH] });
  }
  return ok(true);
}

export async function getHousingPreferences(
  supabase: DbClient
): Promise<ServiceResult<HousingPreferences | null>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const profile = await requireActiveProfile(supabase, userId);
  if (!profile.ok) return profile;

  const { data, error } = await supabase
    .from("housing_preferences")
    .select(HOUSING_PREFERENCES_COLUMNS)
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  return ok(data);
}

export async function createHousingPreferences(
  supabase: DbClient,
  input: unknown
): Promise<ServiceResult<HousingPreferences>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const parsed = housingPreferencesCreateSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));
  const fields = parsed.data;

  const profile = await requireActiveProfile(supabase, userId);
  if (!profile.ok) return profile;

  const rules = await checkPreferenceRules(supabase, userId, fields, profile.data);
  if (!rules.ok) return rules;

  const { data: created, error } = await supabase
    .from("housing_preferences")
    .insert({ profile_id: userId, ...fields })
    .select(HOUSING_PREFERENCES_COLUMNS)
    .single();
  if (!error) return ok(created);
  if (error.code !== "23505") return mapHousingWriteError(error);

  // 23505: ya existen. Se actualizan los campos enviados, nunca profile_id.
  if (Object.keys(fields).length === 0) {
    const { data: existing, error: readError } = await supabase
      .from("housing_preferences")
      .select(HOUSING_PREFERENCES_COLUMNS)
      .eq("profile_id", userId)
      .maybeSingle();
    if (readError || !existing) return mapDbError(readError);
    return ok(existing);
  }
  const { data: updated, error: updateError } = await supabase
    .from("housing_preferences")
    .update(fields)
    .eq("profile_id", userId)
    .select(HOUSING_PREFERENCES_COLUMNS)
    .single();
  if (updateError) return mapHousingWriteError(updateError);
  return ok(updated);
}

export async function updateHousingPreferences(
  supabase: DbClient,
  input: unknown
): Promise<ServiceResult<HousingPreferences>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const parsed = housingPreferencesUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));

  const profile = await requireActiveProfile(supabase, userId);
  if (!profile.ok) return profile;

  const rules = await checkPreferenceRules(supabase, userId, parsed.data, profile.data);
  if (!rules.ok) return rules;

  const { data: updated, error } = await supabase
    .from("housing_preferences")
    .update(parsed.data)
    .eq("profile_id", userId)
    .select(HOUSING_PREFERENCES_COLUMNS)
    .maybeSingle();
  if (error) return mapHousingWriteError(error);
  // Sin fila que actualizar: las preferencias todavía no existen.
  if (!updated) return fail("not_found");
  return ok(updated);
}
