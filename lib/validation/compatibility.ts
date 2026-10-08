import { z } from "zod";
import { getCurrentQuestionnaire } from "@/lib/matching/questionnaire";
import type { Questionnaire } from "@/lib/matching/types";
import type { FormFields } from "@/lib/validation/form-data";

/**
 * Entrada del test de compatibilidad (Fase 3.1). Estricto: solo ids de
 * preguntas de la versión vigente, cada uno con un entero de su escala. Se
 * aceptan respuestas parciales (guardar un borrador); que el test esté
 * completo lo decide el servicio sobre las respuestas ya combinadas.
 *
 * Nunca se aceptan `profile_id`, `questionnaire_version` ni `completed_at`:
 * cualquier clave que no sea una pregunta es «Campo no permitido». El
 * servidor saca el perfil de la sesión, fija la versión vigente y decide si
 * el test está completo.
 */

const unknownKeyError = (issue: { code?: string; keys?: string[] }) =>
  issue.code === "unrecognized_keys"
    ? `Campo no permitido: ${(issue.keys ?? []).join(", ")}`
    : undefined;

export function questionnaireAnswersSchema(
  questionnaire: Questionnaire = getCurrentQuestionnaire()
) {
  const shape: Record<string, z.ZodOptional<z.ZodInt>> = {};
  for (const question of questionnaire.questions) {
    shape[question.id] = z
      .int({ error: "Elige una de las opciones" })
      .min(question.scale.min, { error: "Elige una de las opciones" })
      .max(question.scale.max, { error: "Elige una de las opciones" })
      .optional();
  }
  return z.strictObject(shape, { error: unknownKeyError });
}

/** Campos del formulario de `/test`: uno numérico por pregunta. */
export function questionnaireFormFields(
  questionnaire: Questionnaire = getCurrentQuestionnaire()
): FormFields {
  return Object.fromEntries(
    questionnaire.questions.map((question) => [question.id, "number" as const])
  );
}
