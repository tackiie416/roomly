"use client";

import { useActionState } from "react";
import {
  submitQuestionnaire,
  type QuestionnaireFormState,
} from "@/app/actions/compatibility";
import type { Question } from "@/lib/matching/types";
import {
  FieldError,
  FormError,
  SubmitButton,
  hintClass,
} from "@/components/onboarding/form-controls";

/**
 * Formulario del test de compatibilidad (`/test`, Fase 3.5). Una pregunta
 * por `fieldset` con botones de opción: funciona también sin JavaScript.
 * Se puede guardar a medias (el servidor guarda el progreso); con las 29
 * respondidas, el servidor marca el test como completado y lleva a
 * `/explorar`. En las escalas de valoración solo se etiquetan los extremos.
 *
 * Backlog de la Fase 3 (sesión 81): con alguna respuesta ya marcada, cada
 * pregunta sin responder lo indica («Sin responder») y un enlace lleva a la
 * primera. Son anclas normales (`#q-<id>`): funcionan sin JavaScript.
 */

const initialState: QuestionnaireFormState = {};

export function QuestionnaireForm({
  questions,
  initialValues,
  submitLabel,
}: {
  questions: readonly Question[];
  initialValues: Record<string, string>;
  submitLabel: string;
}) {
  const [state, action] = useActionState(submitQuestionnaire, initialState);
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};
  const isAnswered = (id: string) => {
    const value = values[id];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };
  const started = questions.some((question) => isAnswered(question.id));
  const unanswered = started ? questions.filter((q) => !isAnswered(q.id)) : [];

  return (
    <form
      key={JSON.stringify(state.values ?? null)}
      action={action}
      className="flex flex-col gap-6"
    >
      {unanswered.length > 0 ? (
        <p className="text-sm" data-testid="unanswered-summary">
          {unanswered.length === 1
            ? "Te queda 1 pregunta sin responder: "
            : `Te quedan ${unanswered.length} preguntas sin responder: `}
          <a href={`#q-${unanswered[0].id}`} className="underline">
            ir a la primera
          </a>
          .
        </p>
      ) : null}
      {questions.map((question, index) => {
        const options: number[] = [];
        for (let value = question.scale.min; value <= question.scale.max; value++)
          options.push(value);
        const allLabelled = options.every((value) => question.labels[value]);
        const errorId = `${question.id}-error`;
        const helpId = `${question.id}-help`;
        const describedBy = [
          question.help ? helpId : null,
          errors[question.id] ? errorId : null,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <fieldset
            key={question.id}
            id={`q-${question.id}`}
            aria-describedby={describedBy || undefined}
            className="flex scroll-mt-20 flex-col gap-2"
          >
            <legend className="text-sm font-medium">
              {index + 1}. {question.text}
              {started && !isAnswered(question.id) ? (
                <span
                  className="ml-2 rounded-[var(--radius)] border border-[var(--border)] px-1.5 py-0.5 text-xs font-normal text-[var(--muted)]"
                  data-testid="unanswered"
                >
                  Sin responder
                </span>
              ) : null}
            </legend>
            {question.help ? (
              <p id={helpId} className={hintClass}>
                {question.help}
              </p>
            ) : null}
            <div
              className={
                allLabelled ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-3"
              }
            >
              {!allLabelled ? (
                <span className={hintClass}>{question.labels[question.scale.min]}</span>
              ) : null}
              {options.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={question.id}
                    value={value}
                    defaultChecked={values[question.id] === String(value)}
                  />
                  {allLabelled ? question.labels[value] : <span>{value}</span>}
                </label>
              ))}
              {!allLabelled ? (
                <span className={hintClass}>{question.labels[question.scale.max]}</span>
              ) : null}
            </div>
            <FieldError id={errorId} messages={errors[question.id]} />
          </fieldset>
        );
      })}

      <FormError message={state.formError} />
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {state.success}
        </p>
      ) : null}
      <SubmitButton label={submitLabel} pendingLabel="Guardando…" />
    </form>
  );
}
