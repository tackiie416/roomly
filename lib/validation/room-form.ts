import type { OwnRoom } from "@/lib/services/rooms";
import type { FieldErrors } from "@/lib/services/result";
import { ROOM_FORM_FIELDS } from "@/lib/validation/rooms";

/**
 * Formulario de habitación (`/habitaciones/nueva` y `/habitaciones/[id]/editar`,
 * sesión 68): su estado y cómo se rellena con la fila guardada. Sin E/S: lo
 * usan las páginas (valores iniciales) y las Server Actions. Los nombres son
 * los de las columnas de `rooms` que el formulario escribe; nunca `owner_id`,
 * `status`, `deleted_at` ni `approx_*`.
 */

export type RoomFormValues = Record<string, string | string[]>;

export type RoomFormState = {
  fieldErrors?: FieldErrors;
  formError?: string;
  /** Mensaje de éxito tras guardar (solo la edición: el alta redirige). */
  success?: string;
  /** Lo enviado (si hay errores) o lo guardado. */
  values?: RoomFormValues;
};

/** Estado del cambio de estado de una habitación (R7). */
export type RoomStatusFormState = {
  formError?: string;
  success?: string;
};

/** Valores de un formulario vacío (alta). `students_only` sin marcar: es explícito. */
export const EMPTY_ROOM_FORM_VALUES: RoomFormValues = Object.fromEntries(
  Object.entries(ROOM_FORM_FIELDS).map(([key, kind]) => [key, kind === "list" ? [] : ""])
);

/** Fila guardada → valores del formulario (vacío = sin valor; casillas `on`/``). */
export function roomFormValues(room: OwnRoom): RoomFormValues {
  const asText = (value: string | number | null) => (value === null ? "" : String(value));
  const asCheckbox = (value: boolean) => (value ? "on" : "");
  return {
    title: room.title,
    description: asText(room.description),
    city_id: room.city_id,
    neighborhood_id: asText(room.neighborhood_id),
    price_month: String(room.price_month),
    expenses_included: asCheckbox(room.expenses_included),
    deposit_amount: asText(room.deposit_amount),
    available_from: room.available_from,
    min_stay_months: asText(room.min_stay_months),
    max_stay_months: asText(room.max_stay_months),
    total_roommates: asText(room.total_roommates),
    total_rooms: asText(room.total_rooms),
    features: [...room.features],
    pets_allowed: asCheckbox(room.pets_allowed),
    smoking_allowed: asCheckbox(room.smoking_allowed),
    students_only: room.students_only ? "true" : "false",
    house_rules: asText(room.house_rules),
    roommate_preferences: asText(room.roommate_preferences),
  };
}
