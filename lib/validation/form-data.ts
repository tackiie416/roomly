/**
 * Conversión de `FormData` a un objeto plano para los esquemas Zod (Fase 2.3).
 *
 * Nunca se confía en los tipos del navegador: todo llega como texto y aquí
 * solo se hace la conversión mínima (número, lista, vacío). La validación de
 * verdad la hacen los esquemas `strict` de lib/validation/*. Las claves que
 * no están en `fields` se conservan tal cual para que el esquema las rechace
 * como "Campo no permitido" (así se detecta un `profile_id`, `role` o
 * `onboarding_completed_at` inyectado); solo se descartan las claves internas
 * de Next.js (`$ACTION_...`), que no son datos del usuario.
 */

export type FieldKind =
  /** Texto (también fechas `AAAA-MM-DD` y UUIDs): se deja como string. */
  | "text"
  /** Número: se convierte si el texto es numérico; si no, se deja para que falle la validación. */
  | "number"
  /** Lista (checkboxes/select múltiple): siempre un array de strings no vacíos. */
  | "list"
  /**
   * Casilla única (Fase 2.4): marcada (`on`, el valor por defecto del
   * navegador) → `true`; sin marcar el navegador no la envía → `false`.
   * Cualquier otro valor se deja tal cual para que la validación lo rechace.
   */
  | "checkbox";

export type FormFields = Record<string, FieldKind>;

export type EmptyAs = "omit" | "null";

const NUMERIC = /^-?\d+(\.\d+)?$/;
const NEXT_INTERNAL_KEY = /^\$ACTION_/;

function isNextInternalKey(key: string): boolean {
  return NEXT_INTERNAL_KEY.test(key);
}

/**
 * @param emptyAs qué hacer con un campo vacío o ausente: `"omit"` (no se
 *   envía; en un INSERT se aplica el valor de la base de datos) o `"null"`
 *   (se envía `null` para vaciarlo; una lista ausente pasa a `[]`).
 */
export function formDataToObject(
  formData: FormData,
  fields: FormFields,
  options: { emptyAs: EmptyAs }
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, kind] of Object.entries(fields)) {
    const values = formData.getAll(key);
    if (kind === "checkbox") {
      // Ausente = sin marcar, con cualquier `emptyAs`: el formulario siempre
      // la contiene, así que no enviarla es una respuesta, no un campo omitido.
      if (values.length === 0) result[key] = false;
      else if (values.length === 1 && values[0] === "on") result[key] = true;
      else result[key] = values.length === 1 ? values[0] : values;
      continue;
    }
    if (kind === "list") {
      // Checkboxes sin marcar no se envían: con "null", ausente = lista vacía
      // (para poder vaciarla); con "omit", ausente = no se toca.
      if (values.length === 0 && options.emptyAs === "omit") continue;
      result[key] = values
        .map((value) => (typeof value === "string" ? value.trim() : value))
        .filter((value) => value !== "");
      continue;
    }

    if (values.length === 0) continue;
    // Más de un valor para un campo escalar: se pasa como lista para que la
    // validación lo rechace, en vez de quedarse con uno de ellos.
    if (values.length > 1) {
      result[key] = values;
      continue;
    }

    const value = values[0];
    if (typeof value !== "string") {
      result[key] = value; // un archivo: el esquema lo rechazará
      continue;
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      if (options.emptyAs === "null") result[key] = null;
      continue;
    }
    result[key] = kind === "number" && NUMERIC.test(trimmed) ? Number(trimmed) : value;
  }

  // Claves inesperadas: se conservan para que el esquema `strict` las rechace.
  for (const key of new Set(formData.keys())) {
    if (key in fields || isNextInternalKey(key)) continue;
    const values = formData.getAll(key);
    result[key] = values.length === 1 ? values[0] : values;
  }

  return result;
}

/**
 * Valores enviados, como texto, para volver a rellenar el formulario si hay
 * errores (React vacía los formularios tras una acción). Solo los campos
 * conocidos: nunca se devuelve nada inyectado.
 */
export function formDataValues(
  formData: FormData,
  fields: FormFields
): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [key, kind] of Object.entries(fields)) {
    const raw = formData
      .getAll(key)
      .filter((value): value is string => typeof value === "string");
    if (kind === "list") values[key] = raw;
    else if (kind === "checkbox") values[key] = raw.length > 0 ? "on" : "";
    else if (raw.length > 0) values[key] = raw[0];
  }
  return values;
}
