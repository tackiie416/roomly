import { z } from "zod";

/**
 * Piezas compartidas por los esquemas de lib/validation/*.
 *
 * Fechas: se trabaja siempre con cadenas ISO `AAAA-MM-DD` y con el día
 * actual en UTC, que es lo que usa PostgreSQL con `current_date` en Supabase
 * (zona horaria UTC por defecto). Así el servidor y la base de datos coinciden
 * sin depender de la zona horaria del navegador.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Número de caracteres como los cuenta PostgreSQL (`char_length`): code points, no unidades UTF-16. */
export function charLength(value: string): number {
  return [...value].length;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `true` si es una fecha real con formato `AAAA-MM-DD` (rechaza 2023-02-30). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Día actual en UTC como `AAAA-MM-DD` (equivalente a `current_date` en Supabase). */
export function todayUtc(now: Date = new Date()): string {
  return formatIsoDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

/**
 * Fecha límite para tener al menos `years` años hoy, igual que
 * `current_date - interval 'N years'` en PostgreSQL: si el día no existe en
 * el mes resultante (29 de febrero en año no bisiesto), se ajusta al último
 * día del mes.
 */
export function latestBirthDateForAge(years: number, now: Date = new Date()): string {
  const year = now.getUTCFullYear() - years;
  const month = now.getUTCMonth() + 1;
  const day = Math.min(now.getUTCDate(), daysInMonth(year, month));
  return formatIsoDate(year, month, day);
}

/** Cadena ISO `AAAA-MM-DD` válida. Las cadenas ISO se comparan bien como texto. */
export const isoDateSchema = z
  .string({ error: "Introduce una fecha" })
  .refine(isIsoDate, { error: "La fecha no es válida (formato AAAA-MM-DD)" });

/** UUID normalizado a minúsculas (PostgreSQL los devuelve así). */
export const uuidSchema = z
  .uuid({ error: "Identificador no válido" })
  .transform((value) => value.toLowerCase());

/**
 * Entero ≥ 0 que cabe en `integer` de PostgreSQL. El máximo es el del tipo de
 * la columna, no un límite de producto: sin él, un valor enorme daría un
 * error de desbordamiento en vez de un error de validación.
 */
export const nonNegativeIntegerSchema = z
  .int32({ error: "Introduce un número entero válido" })
  .min(0, { error: "No puede ser negativo" });

/**
 * Texto opcional: `trim`, y cadena vacía → `null`. `maxLength` se cuenta en
 * caracteres como PostgreSQL.
 */
export function optionalTextSchema(maxLength: number, label: string) {
  return z
    .string({ error: `${label} debe ser texto` })
    .nullable()
    .transform((value) => {
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    })
    .refine((value) => value === null || charLength(value) <= maxLength, {
      error: `${label}: máximo ${maxLength} caracteres`,
    });
}

/** Clave usada en `fieldErrors` para errores que no son de un campo concreto. */
export const FORM_ERROR_KEY = "_form";

/** Errores de Zod como `fieldErrors` (los de nivel raíz, bajo `_form`). */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const flat = z.flattenError(error);
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(flat.fieldErrors)) {
    if (Array.isArray(messages) && messages.length > 0) fieldErrors[key] = messages;
  }
  if (flat.formErrors.length > 0) fieldErrors[FORM_ERROR_KEY] = flat.formErrors;
  return fieldErrors;
}
