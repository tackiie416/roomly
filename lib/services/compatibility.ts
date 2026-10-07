import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";
import {
  isQuestionnaireComplete,
  questionnaireStatus,
  reusableAnswers,
  type QuestionnaireStatus,
} from "@/lib/matching/questionnaire-status";
import type { QuestionnaireAnswers } from "@/lib/matching/types";
import { toFieldErrors } from "@/lib/validation/common";
import { questionnaireAnswersSchema } from "@/lib/validation/compatibility";
import {
  type DbClient,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";

/**
 * Servicio del test de compatibilidad propio (Fase 3.1).
 *
 * Reparto de clientes (decisiones D17 y D18 de la especificación cerrada):
 *   - LECTURA del estado propio: cliente del usuario (`DbClient`, RLS:
 *     `compatibility_responses_select_own`). Nunca service_role.
 *   - ESCRITURA: `createAdminClient()` (service_role), porque `authenticated`
 *     no tiene INSERT ni UPDATE en la tabla. Solo después de comprobar la
 *     sesión, la cuenta activa con el onboarding completo y las respuestas
 *     con Zod. `profile_id` sale SIEMPRE de `getSessionUserId()`; la versión
 *     es SIEMPRE `CURRENT_QUESTIONNAIRE_VERSION`; `completed_at` lo decide
 *     este servicio, nunca el cliente.
 *
 * Reglas de escritura (D7, con el trigger de 20261007120000 como segunda capa):
 *   - D7.1: `completed_at` se fija solo cuando, combinadas, las 29 respuestas
 *     de la versión vigente son válidas (también en el primer INSERT).
 *   - D7.2: volver a guardar un test completado exige que sigan las 29 y no
 *     toca `completed_at`.
 *   - D7.3/D7.4: con una fila de una versión anterior se reutilizan las
 *     respuestas cuyo id sigue existiendo; si con lo nuevo están las 29, se
 *     completa en la misma escritura; si no, queda como borrador.
 *   - D7.5: una fila de una versión posterior no se toca (`conflict`).
 */

export type OwnQuestionnaire = {
  status: QuestionnaireStatus;
  /** Respuestas válidas para la versión vigente (las reutilizables si es `outdated`). */
  answers: QuestionnaireAnswers;
  /** Versión guardada (null si no hay fila). */
  storedVersion: number | null;
  currentVersion: number;
};

type StoredRow = {
  questionnaire_version: number;
  answers: unknown;
  completed_at: string | null;
};

const ROW_COLUMNS = "questionnaire_version, answers, completed_at" as const;

const INCOMPLETE_COMPLETED =
  "Para volver a guardar el test hay que responder todas las preguntas.";

export type CompatibilityDeps = {
  /** Cliente con service_role para escribir. Se inyecta en los tests. */
  adminClient: () => DbClient;
};

const DEFAULT_DEPS: CompatibilityDeps = { adminClient: () => createAdminClient() };

function toOwnQuestionnaire(row: StoredRow | null): OwnQuestionnaire {
  const questionnaire = getCurrentQuestionnaire();
  const status = questionnaireStatus(row, CURRENT_QUESTIONNAIRE_VERSION);
  return {
    status,
    answers:
      row && status !== "unsupported" ? reusableAnswers(row.answers, questionnaire) : {},
    storedVersion: row?.questionnaire_version ?? null,
    currentVersion: CURRENT_QUESTIONNAIRE_VERSION,
  };
}

/** Errores del trigger de integridad → error de servicio, sin el mensaje original. */
function mapWriteError<T>(error: { code?: string; message?: string }): ServiceResult<T> {
  const message = error.message ?? "";
  if (error.code === "23514" && message.includes("account_deleted:"))
    return fail("deleted");
  if (
    error.code === "23505" ||
    (error.code === "23514" &&
      (message.includes("questionnaire_completed_locked:") ||
        message.includes("questionnaire_version_downgrade:") ||
        message.includes("compatibility_profile_locked:")))
  ) {
    return fail("conflict");
  }
  return mapDbError(error);
}

/** Perfil propio activo y con el onboarding completo (el test va después del onboarding). */
async function requireActiveCompletedProfile(
  supabase: DbClient,
  userId: string
): Promise<ServiceResult<true>> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, deleted_at, onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!profile) return fail("no_profile");
  if (profile.deleted_at !== null) return fail("deleted");
  if (profile.onboarding_completed_at === null) return fail("forbidden");
  return ok(true);
}

async function readOwnRow(
  supabase: DbClient,
  userId: string
): Promise<ServiceResult<StoredRow | null>> {
  const { data, error } = await supabase
    .from("compatibility_responses")
    .select(ROW_COLUMNS)
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  return ok(data);
}

/** Estado del test propio. Solo lee, con el cliente del usuario. */
export async function getOwnQuestionnaire(
  supabase: DbClient
): Promise<ServiceResult<OwnQuestionnaire>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const row = await readOwnRow(supabase, userId);
  if (!row.ok) return row;
  return ok(toOwnQuestionnaire(row.data));
}

/**
 * Guarda respuestas del test propio (parciales o completas) y, si con ellas
 * quedan las 29 válidas, marca el test como completado.
 */
export async function saveQuestionnaireAnswers(
  supabase: DbClient,
  input: unknown,
  deps: CompatibilityDeps = DEFAULT_DEPS
): Promise<ServiceResult<OwnQuestionnaire>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const parsed = questionnaireAnswersSchema().safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));

  const profile = await requireActiveCompletedProfile(supabase, userId);
  if (!profile.ok) return profile;

  const current = await readOwnRow(supabase, userId);
  if (!current.ok) return current;
  const row = current.data;
  const status = questionnaireStatus(row, CURRENT_QUESTIONNAIRE_VERSION);
  // D7.5: nunca se escribe sobre una versión que el código no conoce.
  if (status === "unsupported") return fail("conflict");

  const questionnaire = getCurrentQuestionnaire();
  const submitted: QuestionnaireAnswers = {};
  for (const [id, value] of Object.entries(parsed.data)) {
    if (typeof value === "number") submitted[id] = value;
  }
  const merged: QuestionnaireAnswers = {
    ...(row ? reusableAnswers(row.answers, questionnaire) : {}),
    ...submitted,
  };
  const complete = isQuestionnaireComplete(merged, questionnaire);

  // D7.2: un test completado de la versión vigente no vuelve a borrador.
  if (status === "completed" && !complete) {
    return fail("validation", { _form: [INCOMPLETE_COMPLETED] });
  }

  const admin = deps.adminClient();
  if (!row) {
    const { data, error } = await admin
      .from("compatibility_responses")
      .insert({
        profile_id: userId,
        questionnaire_version: CURRENT_QUESTIONNAIRE_VERSION,
        answers: merged,
        completed_at: complete ? new Date().toISOString() : null,
      })
      .select(ROW_COLUMNS)
      .single();
    if (error) return mapWriteError(error);
    return ok(toOwnQuestionnaire(data));
  }

  // Ya completado en esta versión: se guardan las respuestas y la fecha no se
  // envía (S4). En los demás casos, la fecha la decide `complete`.
  const payload =
    status === "completed"
      ? { questionnaire_version: CURRENT_QUESTIONNAIRE_VERSION, answers: merged }
      : {
          questionnaire_version: CURRENT_QUESTIONNAIRE_VERSION,
          answers: merged,
          completed_at: complete ? new Date().toISOString() : null,
        };

  // Solo si la fila sigue como se leyó: dos guardados simultáneos no se pisan
  // (si otra pestaña la cambió, 0 filas → `conflict`).
  let update = admin
    .from("compatibility_responses")
    .update(payload)
    .eq("profile_id", userId)
    .eq("questionnaire_version", row.questionnaire_version);
  if (row.completed_at === null) update = update.is("completed_at", null);
  const { data, error } = await update.select(ROW_COLUMNS).maybeSingle();
  if (error) return mapWriteError(error);
  if (!data) return fail("conflict");
  return ok(toOwnQuestionnaire(data));
}
