"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OWN_PREFERENCES_PATH, requireOwnProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import {
  createHousingPreferences,
  updateHousingPreferences,
} from "@/lib/services/housing-preferences";
import type { FieldErrors } from "@/lib/services/result";
import { formDataToObject, formDataValues } from "@/lib/validation/form-data";
import {
  PREFERENCES_FORM_FIELDS,
  preferencesFormValues,
  type PreferencesFormState,
} from "@/lib/validation/preferences-form";

/**
 * Server Action de `/preferencias` (Fase 2.5). Orquestación fina:
 * guard → FormData → servicio de preferencias (2.1) → estado del formulario.
 * UPDATE si ya existen; si no (`not_found`), INSERT. Nunca upsert.
 * `profile_id` sale de la sesión dentro del servicio; los esquemas `strict`
 * rechazan `profile_id` o cualquier otra clave que no sea un campo. Las
 * reglas (ciudad obligatoria tras el onboarding, ciudad activa, universidad
 * y barrios de la ciudad) viven en el servicio y en la base de datos.
 * Nunca toca `onboarding_completed_at`.
 */

const GENERIC_ERROR =
  "No hemos podido guardar tus preferencias. Vuelve a intentarlo en un momento.";
const CHECK_FIELDS_ERROR = "Revisa los datos marcados.";
const SUCCESS_MESSAGE = "Preferencias guardadas.";

/** Errores de campo del formulario; los demás (incluido `_form`) van al error general. */
function toFormState(
  fieldErrors: FieldErrors,
  values: PreferencesFormState["values"]
): PreferencesFormState {
  const own: FieldErrors = {};
  const general: string[] = [];
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (key in PREFERENCES_FORM_FIELDS) own[key] = messages;
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

export async function submitOwnPreferences(
  _previous: PreferencesFormState,
  formData: FormData
): Promise<PreferencesFormState> {
  await requireOwnProfile(OWN_PREFERENCES_PATH);

  const values = formDataValues(formData, PREFERENCES_FORM_FIELDS);
  // Vacío → null: vaciar un campo opcional lo borra; los barrios sin marcar
  // quedan en lista vacía.
  const input = formDataToObject(formData, PREFERENCES_FORM_FIELDS, { emptyAs: "null" });

  const supabase = await createClient();
  let result = await updateHousingPreferences(supabase, input);
  if (!result.ok && result.error === "not_found") {
    result = await createHousingPreferences(supabase, input);
  }

  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect(loginPath({ next: OWN_PREFERENCES_PATH }));
      case "deleted":
        redirect(DEACTIVATED_PATH);
      case "no_profile":
        redirect(ONBOARDING_PROFILE_PATH);
      case "validation":
        return toFormState(result.fieldErrors ?? {}, values);
      default:
        return { formError: GENERIC_ERROR, values };
    }
  }

  revalidatePath(OWN_PREFERENCES_PATH);
  return { success: SUCCESS_MESSAGE, values: preferencesFormValues(result.data) };
}
