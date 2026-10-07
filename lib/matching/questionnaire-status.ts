import { isValidAnswer } from "@/lib/matching/questionnaire";
import type { Questionnaire, QuestionnaireAnswers } from "@/lib/matching/types";

/**
 * Estado del test de la sesión (Fase 3.5). Una única función pura decide el
 * estado; la usan `/test`, `/explorar`, la Server Action y el servicio, así
 * que no pueden discrepar (y no puede haber bucles de redirección).
 *
 *   - `none`: no hay fila;
 *   - `draft`: versión vigente y `completed_at` NULL;
 *   - `completed`: versión vigente y `completed_at` con valor;
 *   - `outdated`: versión anterior a la vigente (con o sin completar);
 *   - `unsupported`: versión POSTERIOR a la vigente. Solo pasaría si
 *     `CURRENT_QUESTIONNAIRE_VERSION` bajara (no debe pasar nunca): se trata
 *     como error genérico, fallo cerrado.
 */
export type QuestionnaireStatus =
  "none" | "draft" | "completed" | "outdated" | "unsupported";

export type QuestionnaireRow = {
  questionnaire_version: number;
  completed_at: string | null;
};

export function questionnaireStatus(
  row: QuestionnaireRow | null,
  currentVersion: number
): QuestionnaireStatus {
  if (!row) return "none";
  if (row.questionnaire_version > currentVersion) return "unsupported";
  if (row.questionnaire_version < currentVersion) return "outdated";
  return row.completed_at === null ? "draft" : "completed";
}

/**
 * Respuestas guardadas que siguen valiendo para `questionnaire` (D15b): las de
 * ids que existen y con un valor de su escala. Por el invariante de ids
 * (D15a) un id que existe significa lo mismo en todas las versiones; la
 * escala se comprueba igualmente. Sirve tanto para un borrador de la versión
 * vigente como para reutilizar respuestas de una versión anterior.
 */
export function reusableAnswers(
  stored: unknown,
  questionnaire: Questionnaire
): QuestionnaireAnswers {
  const result: QuestionnaireAnswers = {};
  if (typeof stored !== "object" || stored === null || Array.isArray(stored))
    return result;
  const values = stored as Record<string, unknown>;
  for (const question of questionnaire.questions) {
    const value = values[question.id];
    if (isValidAnswer(question, value)) result[question.id] = value;
  }
  return result;
}

/** ¿Están todas las preguntas de `questionnaire` respondidas con un valor válido? */
export function isQuestionnaireComplete(
  answers: QuestionnaireAnswers,
  questionnaire: Questionnaire
): boolean {
  return questionnaire.questions.every((question) =>
    isValidAnswer(question, answers[question.id])
  );
}
