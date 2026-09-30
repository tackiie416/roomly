import type { OwnProfile } from "@/lib/services/profile";
import type { FormFields } from "@/lib/validation/form-data";

/**
 * Formulario del perfil propio (`/perfil`, Fase 2.4): qué campos tiene y
 * cómo se rellena con el perfil guardado. Sin E/S: lo usan la página (valores
 * iniciales) y la Server Action (lectura del FormData y valores tras guardar).
 * Los nombres son los de las columnas de `profiles` y coinciden con
 * `profileUpdateSchema`; no hay ningún campo protegido.
 */
export const OWN_PROFILE_FIELDS = {
  full_name: "text",
  date_of_birth: "text",
  seeking_status: "text",
  bio: "text",
  email_notifications_enabled: "checkbox",
} as const satisfies FormFields;

export type OwnProfileFormValues = Record<keyof typeof OWN_PROFILE_FIELDS, string>;

/** Perfil guardado → valores del formulario (la casilla marcada es `"on"`). */
export function ownProfileFormValues(
  profile: Pick<
    OwnProfile,
    | "full_name"
    | "date_of_birth"
    | "seeking_status"
    | "bio"
    | "email_notifications_enabled"
  >
): OwnProfileFormValues {
  return {
    full_name: profile.full_name,
    date_of_birth: profile.date_of_birth,
    seeking_status: profile.seeking_status,
    bio: profile.bio ?? "",
    email_notifications_enabled: profile.email_notifications_enabled ? "on" : "",
  };
}
