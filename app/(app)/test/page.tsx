import Link from "next/link";
import { requireQuestionnaire } from "@/lib/auth/session";
import { EXPLORE_PATH, TEST_PATH } from "@/lib/auth/destination";
import { getCurrentQuestionnaire } from "@/lib/matching/questionnaire";
import { QuestionnaireForm } from "@/components/questionnaire/questionnaire-form";
import { Card } from "@/components/ui/card";

/**
 * Test de compatibilidad (`/test`, Fase 3.5). Guard en la propia página
 * (onboarding completo; si no, a donde toque). Nunca redirige según el estado
 * del test: se abre sin test, con un borrador, desactualizado o completado
 * (para editarlo). El estado lo da `questionnaireStatus` a través del
 * servicio, leyendo la fila propia con el cliente del usuario. Si el test se
 * actualizó (`outdated`), se avisa y se rellenan las respuestas cuyas
 * preguntas siguen existiendo.
 */
export default async function TestPage() {
  const questionnaire = await requireQuestionnaire(TEST_PATH);
  const definition = getCurrentQuestionnaire();
  const initialValues = Object.fromEntries(
    Object.entries(questionnaire.answers).map(([id, value]) => [id, String(value)])
  );
  const answered = Object.keys(questionnaire.answers).length;
  const total = definition.questions.length;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Card className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-medium">Test de convivencia</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {total} preguntas sobre cómo te gusta vivir en casa. No hay respuestas buenas
            ni malas: contesta según cómo eres, no según lo que crees que se espera. Con
            tus respuestas calculamos una compatibilidad orientativa, que no garantiza
            cómo irá la convivencia. Las demás personas no ven tus respuestas: solo un
            porcentaje y frases generales sobre en qué coincidís o en qué podéis diferir.
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Responde todas las preguntas para ver tus compañeros compatibles. Puedes
            guardar a medias y seguir más tarde. En las escalas del 1 al 5 solo se nombran
            los extremos: elige el número que más se acerque a ti. Si aún no vives en el
            piso, responde pensando en cómo vivirás allí.
          </p>
        </div>

        {questionnaire.status === "outdated" ? (
          <p
            role="status"
            className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
          >
            Hemos actualizado el test. Conservamos las respuestas que siguen valiendo;
            responde las preguntas nuevas para volver a ver tus compañeros compatibles.
          </p>
        ) : null}
        {questionnaire.status === "draft" ? (
          <p className="text-sm text-[var(--muted)]">
            Llevas {answered} de {total} preguntas. Puedes guardar y seguir más tarde.
          </p>
        ) : null}
        {questionnaire.status === "completed" ? (
          <p className="text-sm text-[var(--muted)]">
            Ya has completado el test. Puedes cambiar tus respuestas cuando quieras o{" "}
            <Link href={EXPLORE_PATH} className="underline">
              ver tus compañeros compatibles
            </Link>
            .
          </p>
        ) : null}

        <QuestionnaireForm
          questions={definition.questions}
          initialValues={initialValues}
          submitLabel={
            questionnaire.status === "completed"
              ? "Guardar cambios"
              : "Guardar respuestas"
          }
        />
      </Card>
    </main>
  );
}
