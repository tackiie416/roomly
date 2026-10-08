"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCompleteProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  EXPLORE_PATH,
  ONBOARDING_PREFERENCES_PATH,
  ONBOARDING_PROFILE_PATH,
  TEST_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { saveQuestionnaireAnswers } from "@/lib/services/compatibility";
import { getCurrentQuestionnaire as currentQuestionnaireDefinition } from "@/lib/matching/questionnaire";
import type { FieldErrors } from "@/lib/services/result";
import { formDataToObject, formDataValues } from "@/lib/validation/form-data";
import { questionnaireFormFields } from "@/lib/validation/compatibility";

/**
 * Server Action de `/test` (Fase 3.5). Orquestación fina:
 * guard → FormData → `saveQuestionnaireAnswers` → redirección o estado.
 * El servicio saca el perfil de la sesión, fija la versión vigente, valida
 * con Zod estricto (rechaza `profile_id`, `questionnaire_version`,
 * `completed_at` o cualquier clave que no sea una pregunta) y decide si el
 * test queda completado. Si queda completado, se va a `/explorar`; si no, se
 * guarda el progreso y se indica cuántas preguntas faltan.
 */

export type QuestionnaireFormState = {
  fieldErrors?: FieldErrors;
  formError?: string;
  success?: string;
  /** Lo enviado (o lo guardado), para volver a marcar las respuestas. */
  values?: Record<string, string | string[]>;
};

const GENERIC_ERROR =
  "No hemos podido guardar tus respuestas. Vuelve a intentarlo en un momento.";
const CONFLICT_ERROR =
  "Tus respuestas han cambiado en otra pestaña. Recarga la página y vuelve a intentarlo.";
const CHECK_FIELDS_ERROR = "Revisa las preguntas marcadas.";

function pending(missing: number): string {
  return missing === 1
    ? "Progreso guardado. Te falta 1 pregunta para terminar."
    : `Progreso guardado. Te faltan ${missing} preguntas para terminar.`;
}

export async function submitQuestionnaire(
  _previous: QuestionnaireFormState,
  formData: FormData
): Promise<QuestionnaireFormState> {
  await requireCompleteProfile(TEST_PATH);

  const fields = questionnaireFormFields();
  const values = formDataValues(formData, fields);
  // Sin responder → no se envía (no borra lo ya guardado).
  const input = formDataToObject(formData, fields, { emptyAs: "omit" });

  const result = await saveQuestionnaireAnswers(await createClient(), input);
  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect(loginPath({ next: TEST_PATH }));
      case "deleted":
        redirect(DEACTIVATED_PATH);
      case "no_profile":
        redirect(ONBOARDING_PROFILE_PATH);
      case "forbidden":
        redirect(ONBOARDING_PREFERENCES_PATH);
      case "validation": {
        const fieldErrors = result.fieldErrors ?? {};
        const own: FieldErrors = {};
        const general: string[] = [];
        for (const [key, messages] of Object.entries(fieldErrors)) {
          if (key in fields) own[key] = messages;
          else general.push(...messages);
        }
        return {
          fieldErrors: own,
          formError: general.length > 0 ? general.join(" ") : CHECK_FIELDS_ERROR,
          values,
        };
      }
      case "conflict":
        return { formError: CONFLICT_ERROR, values };
      default:
        return { formError: GENERIC_ERROR, values };
    }
  }

  if (result.data.status === "completed") {
    revalidatePath(EXPLORE_PATH);
    redirect(EXPLORE_PATH);
  }

  const saved = Object.fromEntries(
    Object.entries(result.data.answers).map(([id, value]) => [id, String(value)])
  );
  const missing =
    currentQuestionnaireDefinition().questions.length -
    Object.keys(result.data.answers).length;
  revalidatePath(TEST_PATH);
  return { success: pending(missing), values: saved };
}
