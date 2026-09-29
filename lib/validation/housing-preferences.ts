import { z } from "zod";
import {
  isoDateSchema,
  nonNegativeIntegerSchema,
  optionalTextSchema,
  uuidSchema,
} from "@/lib/validation/common";

/**
 * Esquemas de entrada de las preferencias de vivienda propias (Fase 2.1).
 *
 * Forma y coherencia básica (tipos, mínimo ≤ máximo, fechas, longitud).
 * Lo que depende de datos (que la ciudad, la universidad o cada barrio
 * existan, y que los barrios sean de la ciudad elegida) lo sigue garantizando
 * PostgreSQL: FKs y `trg_housing_preferences_neighborhoods`. Los servicios
 * traducen esos errores a errores de campo.
 *
 * Sin techos de presupuesto, compañeros ni número de barrios: la
 * especificación no define ninguno (decisión de producto, Fase 2.0).
 * `profile_id` no se acepta: lo pone el servicio a partir de la sesión.
 */

const unknownKeyError = (issue: { code?: string; keys?: string[] }) =>
  issue.code === "unrecognized_keys"
    ? `Campo no permitido: ${(issue.keys ?? []).join(", ")}`
    : undefined;

/** Lista de barrios sin duplicados, en el orden en que llegaron. */
const neighborhoodIdsSchema = z
  .array(uuidSchema, { error: "Lista de barrios no válida" })
  .transform((ids) => [...new Set(ids)]);

const shape = {
  city_id: uuidSchema.nullable().optional(),
  university_id: uuidSchema.nullable().optional(),
  field_of_study: optionalTextSchema(120, "Los estudios").optional(),
  budget_min: nonNegativeIntegerSchema.nullable().optional(),
  budget_max: nonNegativeIntegerSchema.nullable().optional(),
  move_in_date: isoDateSchema.nullable().optional(),
  move_out_date: isoDateSchema.nullable().optional(),
  preferred_neighborhood_ids: neighborhoodIdsSchema.optional(),
  roommates_wanted_min: nonNegativeIntegerSchema.nullable().optional(),
  roommates_wanted_max: nonNegativeIntegerSchema.nullable().optional(),
};

type Shape = { [K in keyof typeof shape]?: z.output<(typeof shape)[K]> };

/** Reglas entre campos, solo cuando ambos valores llegan en la misma petición. */
function checkRanges(value: Shape, ctx: z.RefinementCtx) {
  const { budget_min, budget_max, move_in_date, move_out_date } = value;
  if (budget_min != null && budget_max != null && budget_min > budget_max) {
    ctx.addIssue({
      code: "custom",
      path: ["budget_max"],
      message: "El presupuesto máximo no puede ser menor que el mínimo",
    });
  }
  if (move_in_date != null && move_out_date != null && move_in_date > move_out_date) {
    ctx.addIssue({
      code: "custom",
      path: ["move_out_date"],
      message: "La fecha de salida no puede ser anterior a la de entrada",
    });
  }
  const { roommates_wanted_min: min, roommates_wanted_max: max } = value;
  if (min != null && max != null && min > max) {
    ctx.addIssue({
      code: "custom",
      path: ["roommates_wanted_max"],
      message: "El máximo de compañeros no puede ser menor que el mínimo",
    });
  }
}

const NEIGHBORHOODS_NEED_CITY = "Elige una ciudad para poder elegir barrios";

/**
 * Crear: todo opcional (el mínimo para completar el onboarding lo comprueba
 * `completeOnboarding`), pero elegir barrios exige elegir ciudad.
 */
export const housingPreferencesCreateSchema = z
  .strictObject(shape, { error: unknownKeyError })
  .superRefine((value, ctx) => {
    checkRanges(value, ctx);
    if ((value.preferred_neighborhood_ids?.length ?? 0) > 0 && value.city_id == null) {
      ctx.addIssue({
        code: "custom",
        path: ["city_id"],
        message: NEIGHBORHOODS_NEED_CITY,
      });
    }
  });

/**
 * Actualizar: al menos un campo. Si se envían barrios y a la vez se borra la
 * ciudad (`city_id: null`), se rechaza aquí; si la ciudad no viene en la
 * petición, la coherencia con la ciudad guardada la comprueba el trigger.
 * Igual con los rangos: si solo llega uno de los dos extremos, el CHECK de
 * la base de datos lo compara con el valor guardado.
 */
export const housingPreferencesUpdateSchema = z
  .strictObject(shape, { error: unknownKeyError })
  .superRefine((value, ctx) => {
    checkRanges(value, ctx);
    if ((value.preferred_neighborhood_ids?.length ?? 0) > 0 && value.city_id === null) {
      ctx.addIssue({
        code: "custom",
        path: ["city_id"],
        message: NEIGHBORHOODS_NEED_CITY,
      });
    }
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "No hay ningún cambio que guardar",
      });
    }
  });

export type HousingPreferencesCreateInput = z.output<
  typeof housingPreferencesCreateSchema
>;
export type HousingPreferencesUpdateInput = z.output<
  typeof housingPreferencesUpdateSchema
>;
