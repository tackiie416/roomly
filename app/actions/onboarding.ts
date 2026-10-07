"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOnboardingStep } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PREFERENCES_PATH,
  ONBOARDING_PROFILE_PATH,
  TEST_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { completeOnboarding, createProfile } from "@/lib/services/profile";
import { createHousingPreferences } from "@/lib/services/housing-preferences";
import type { FieldErrors, ServiceErrorCode } from "@/lib/services/result";
import { toFieldErrors } from "@/lib/validation/common";
import { housingPreferencesOnboardingSchema } from "@/lib/validation/housing-preferences";
import {
  formDataToObject,
  formDataValues,
  type FormFields,
} from "@/lib/validation/form-data";

/**
 * Server Actions del onboarding (Fase 2.3). Orquestación fina:
 * guard del paso → FormData → servicio de 2.1 → redirección.
 * La lógica (validación, acceso a datos, reglas de completitud) vive en
 * lib/services/* y lib/validation/*; el usuario sale siempre de la sesión.
 * Nunca se acepta `profile_id`, `role`, `deleted_at` ni
 * `onboarding_completed_at`: los esquemas `strict` los rechazan.
 */

export type OnboardingFormState = {
  fieldErrors?: FieldErrors;
  formError?: string;
  /** Lo enviado, para volver a rellenar el formulario si hay errores. */
  values?: Record<string, string | string[]>;
};

const GENERIC_ERROR =
  "No hemos podido guardar los datos. Vuelve a intentarlo en un momento.";
const CHECK_FIELDS_ERROR = "Revisa los datos marcados.";

const PROFILE_FIELDS: FormFields = {
  full_name: "text",
  date_of_birth: "text",
  seeking_status: "text",
};

const PREFERENCES_FIELDS: FormFields = {
  city_id: "text",
  university_id: "text",
  field_of_study: "text",
  budget_min: "number",
  budget_max: "number",
  move_in_date: "text",
  move_out_date: "text",
  preferred_neighborhood_ids: "list",
  roommates_wanted_min: "number",
  roommates_wanted_max: "number",
};

/** Errores de campo del formulario; los demás (incluido `_form`) van al error general. */
function toFormState(
  fieldErrors: FieldErrors,
  fields: FormFields,
  values: OnboardingFormState["values"]
): OnboardingFormState {
  const own: FieldErrors = {};
  const general: string[] = [];
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (key in fields) own[key] = messages;
    else general.push(...messages);
  }
  const formError =
    general.length > 0
      ? general.join(" ")
      : Object.keys(own).length > 0
        ? undefined
        : CHECK_FIELDS_ERROR;
  return { fieldErrors: own, formError, values };
}

/** Error de servicio → redirección (sesión o estado) o estado del formulario. */
function fromServiceError(
  result: { error: ServiceErrorCode; fieldErrors?: FieldErrors },
  fields: FormFields,
  values: OnboardingFormState["values"]
): OnboardingFormState {
  switch (result.error) {
    case "unauthenticated":
      redirect(loginPath());
    case "deleted":
      redirect(DEACTIVATED_PATH);
    case "no_profile":
      redirect(ONBOARDING_PROFILE_PATH);
    case "validation":
      return toFormState(result.fieldErrors ?? {}, fields, values);
    default:
      return { formError: GENERIC_ERROR, values };
  }
}

/** Paso 1: crear el perfil (nombre, fecha de nacimiento, qué busca). */
export async function submitOnboardingProfile(
  _previous: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  await requireOnboardingStep("perfil");

  const values = formDataValues(formData, PROFILE_FIELDS);
  const input = formDataToObject(formData, PROFILE_FIELDS, { emptyAs: "omit" });

  // createProfile valida con profileCreateSchema (strict, seeking_status
  // obligatorio y sin default) y hace INSERT, o UPDATE si ya existía.
  const result = await createProfile(await createClient(), input);
  if (!result.ok) return fromServiceError(result, PROFILE_FIELDS, values);

  redirect(ONBOARDING_PREFERENCES_PATH);
}

/** Paso 2: guardar preferencias (ciudad obligatoria) y completar el onboarding. */
export async function submitOnboardingPreferences(
  _previous: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  await requireOnboardingStep("preferencias");

  const values = formDataValues(formData, PREFERENCES_FIELDS);
  // Vacío → null: si ya había preferencias, vaciar un campo lo borra.
  const input = formDataToObject(formData, PREFERENCES_FIELDS, { emptyAs: "null" });

  // Ciudad obligatoria antes de escribir nada: no se guardan preferencias a medias.
  const parsed = housingPreferencesOnboardingSchema.safeParse(input);
  if (!parsed.success)
    return toFormState(toFieldErrors(parsed.error), PREFERENCES_FIELDS, values);

  const supabase = await createClient();
  const saved = await createHousingPreferences(supabase, parsed.data);
  if (!saved.ok) return fromServiceError(saved, PREFERENCES_FIELDS, values);

  // Solo aquí se marca el onboarding como completo (y lo comprueba de nuevo
  // el servicio y el trigger de la base de datos).
  const completed = await completeOnboarding(supabase);
  if (!completed.ok) return fromServiceError(completed, PREFERENCES_FIELDS, values);

  // D5 (Fase 3): al terminar el onboarding se va siempre al test de
  // compatibilidad; `next` no se usa para saltárselo.
  redirect(TEST_PATH);
}
