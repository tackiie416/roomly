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

  return (
    <form
      key={JSON.stringify(state.values ?? null)}
      action={action}
      className="flex flex-col gap-6"
    >
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
            aria-describedby={describedBy || undefined}
            className="flex flex-col gap-2"
          >
            <legend className="text-sm font-medium">
              {index + 1}. {question.text}
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
