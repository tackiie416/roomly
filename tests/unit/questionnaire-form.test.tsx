import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/compatibility", () => ({ submitQuestionnaire: async () => ({}) }));

import { QuestionnaireForm } from "@/components/questionnaire/questionnaire-form";
import { getCurrentQuestionnaire } from "@/lib/matching/questionnaire";

// Backlog de la Fase 3 (sesión 81): señalar las preguntas sin responder, con
// un enlace a la primera (ancla normal, sin JavaScript).

const QUESTIONS = getCurrentQuestionnaire().questions;
const render = (initialValues: Record<string, string>) =>
  renderToStaticMarkup(
    <QuestionnaireForm
      questions={QUESTIONS}
      initialValues={initialValues}
      submitLabel="Guardar respuestas"
    />
  );
const count = (html: string) => html.match(/data-testid="unanswered"/g)?.length ?? 0;

describe("preguntas sin responder", () => {
  it("sin ninguna respuesta no se señala nada (test sin empezar)", () => {
    const html = render({});
    expect(count(html)).toBe(0);
    expect(html).not.toContain('data-testid="unanswered-summary"');
  });

  it("con respuestas a medias, se señalan las que faltan y se enlaza la primera", () => {
    const initial = Object.fromEntries(QUESTIONS.slice(0, 3).map((q) => [q.id, "1"]));
    const html = render(initial);
    expect(count(html)).toBe(QUESTIONS.length - 3);
    expect(html).toContain(`Te quedan ${QUESTIONS.length - 3} preguntas sin responder`);
    expect(html).toContain(`href="#q-${QUESTIONS[3].id}"`);
    expect(html).toContain(`id="q-${QUESTIONS[3].id}"`);
  });

  it("con una sola pendiente, en singular; completo, nada", () => {
    const allButLast = Object.fromEntries(QUESTIONS.slice(0, -1).map((q) => [q.id, "1"]));
    expect(render(allButLast)).toContain("Te queda 1 pregunta sin responder");
    const all = Object.fromEntries(QUESTIONS.map((q) => [q.id, "1"]));
    expect(count(render(all))).toBe(0);
  });
});
