import type { HousingPreferences } from "@/lib/services/housing-preferences";
import type { FieldErrors } from "@/lib/services/result";
import type { FormFields } from "@/lib/validation/form-data";

/**
 * Formulario de preferencias de vivienda de `/preferencias` (Fase 2.5): qué
 * campos tiene y cómo se rellena con la fila guardada. Sin E/S: lo usan la
 * página (valores iniciales) y la Server Action. Los nombres son los de las
 * columnas de `housing_preferences`; `profile_id` no está: sale de la sesión.
 */
export const PREFERENCES_FORM_FIELDS = {
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
} as const satisfies FormFields;

export type PreferencesFormValues = Record<string, string | string[]>;

/** Estado de los formularios de preferencias (onboarding y `/preferencias`). */
export type PreferencesFormState = {
  fieldErrors?: FieldErrors;
  formError?: string;
  /** Mensaje de éxito tras guardar (solo `/preferencias`). */
  success?: string;
  /** Lo enviado (si hay errores) o lo guardado. */
  values?: PreferencesFormValues;
};

/** Fila guardada → valores del formulario (vacío = sin valor). */
export function preferencesFormValues(
  preferences: Omit<HousingPreferences, "profile_id" | "updated_at">
): PreferencesFormValues {
  const asText = (value: string | number | null) => (value === null ? "" : String(value));
  return {
    city_id: asText(preferences.city_id),
    university_id: asText(preferences.university_id),
    field_of_study: asText(preferences.field_of_study),
    budget_min: asText(preferences.budget_min),
    budget_max: asText(preferences.budget_max),
    move_in_date: asText(preferences.move_in_date),
    move_out_date: asText(preferences.move_out_date),
    preferred_neighborhood_ids: preferences.preferred_neighborhood_ids,
    roommates_wanted_min: asText(preferences.roommates_wanted_min),
    roommates_wanted_max: asText(preferences.roommates_wanted_max),
  };
}
