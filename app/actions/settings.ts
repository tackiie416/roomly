"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_PATH, requireOwnProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { updateNotificationSettings } from "@/lib/services/profile";
import { formDataToObject } from "@/lib/validation/form-data";

/**
 * Server Action de `/ajustes` (Fase 2.6). Orquestación fina:
 * guard → FormData → `updateNotificationSettings` → estado del formulario.
 * Solo cambia `email_notifications_enabled`; el servicio usa el usuario de la
 * sesión y un esquema estricto, así que `profile_id`, `id` o cualquier otro
 * campo del perfil enviado a mano se rechaza sin escribir nada. El logout
 * de `/ajustes` es el `signOut` de 2.2 (`app/actions/auth.ts`): aquí no hay
 * ninguna acción de sesión ni de borrado de cuenta.
 */

export type SettingsFormState = {
  formError?: string;
  success?: string;
  /** `"on"` si la casilla quedó marcada; `""` si no. */
  emailNotifications?: "on" | "";
};

const GENERIC_ERROR =
  "No hemos podido guardar tus ajustes. Vuelve a intentarlo en un momento.";
const SUCCESS_MESSAGE = "Ajustes guardados.";

const SETTINGS_FIELDS = { email_notifications_enabled: "checkbox" } as const;

export async function submitNotificationSettings(
  previous: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  await requireOwnProfile(SETTINGS_PATH);

  const input = formDataToObject(formData, SETTINGS_FIELDS, { emptyAs: "null" });
  const result = await updateNotificationSettings(await createClient(), input);

  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect(loginPath({ next: SETTINGS_PATH }));
      case "deleted":
        redirect(DEACTIVATED_PATH);
      case "no_profile":
        redirect(ONBOARDING_PROFILE_PATH);
      case "validation": {
        // Mensajes propios del esquema (p. ej. "Campo no permitido: …"),
        // nunca texto de Supabase. Se conserva lo que había antes.
        const messages = Object.values(result.fieldErrors ?? {}).flat();
        return {
          formError: messages.length > 0 ? messages.join(" ") : GENERIC_ERROR,
          emailNotifications: previous.emailNotifications,
        };
      }
      default:
        return {
          formError: GENERIC_ERROR,
          emailNotifications: previous.emailNotifications,
        };
    }
  }

  revalidatePath(SETTINGS_PATH);
  return {
    success: SUCCESS_MESSAGE,
    emailNotifications: result.data.email_notifications_enabled ? "on" : "",
  };
}
