"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OWN_PROFILE_PATH, requireOwnProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { updateProfile } from "@/lib/services/profile";
import type { FieldErrors } from "@/lib/services/result";
import { formDataToObject, formDataValues } from "@/lib/validation/form-data";
import {
  OWN_PROFILE_FIELDS,
  ownProfileFormValues,
} from "@/lib/validation/own-profile-form";

/**
 * Server Action del perfil propio (`/perfil`, Fase 2.4). Orquestación fina:
 * guard → FormData → `updateProfile` (2.1) → estado del formulario.
 * El perfil que se edita es siempre el de la sesión: `updateProfile` lo saca
 * de `auth.getUser()` y `profileUpdateSchema` (strict) rechaza `id`,
 * `profile_id`, `role`, `deleted_at`, `onboarding_completed_at` o cualquier
 * otra clave que no sea un campo editable. Una cuenta eliminada queda
 * bloqueada aquí (guard y servicio) y en RLS (`profiles_update_own`).
 */

export type ProfileFormState = {
  fieldErrors?: FieldErrors;
  formError?: string;
  /** Mensaje de éxito tras guardar. */
  success?: string;
  /** Valores del formulario: lo enviado (si hay errores) o lo guardado. */
  values?: Record<string, string | string[]>;
};

const GENERIC_ERROR =
  "No hemos podido guardar los cambios. Vuelve a intentarlo en un momento.";
const CHECK_FIELDS_ERROR = "Revisa los datos marcados.";
const SUCCESS_MESSAGE = "Cambios guardados.";

/** Errores de campo del formulario; los demás (incluido `_form`) van al error general. */
function toFormState(
  fieldErrors: FieldErrors,
  values: ProfileFormState["values"]
): ProfileFormState {
  const own: FieldErrors = {};
  const general: string[] = [];
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (key in OWN_PROFILE_FIELDS) own[key] = messages;
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

export async function submitOwnProfile(
  _previous: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  await requireOwnProfile();

  const values = formDataValues(formData, OWN_PROFILE_FIELDS);
  // Vacío → null: vaciar la descripción la borra; en los campos obligatorios
  // el esquema lo rechaza con su mensaje.
  const input = formDataToObject(formData, OWN_PROFILE_FIELDS, { emptyAs: "null" });

  const result = await updateProfile(await createClient(), input);
  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect(loginPath({ next: OWN_PROFILE_PATH }));
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

  revalidatePath(OWN_PROFILE_PATH);
  return { success: SUCCESS_MESSAGE, values: ownProfileFormValues(result.data) };
}
