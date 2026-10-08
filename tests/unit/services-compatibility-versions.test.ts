import { describe, expect, it, vi } from "vitest";
import type { Question, Questionnaire } from "@/lib/matching/types";
import {
  createFakeSupabase,
  writePayloads,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";

// Fase 3.1 — cambio de versión del cuestionario (D7.3, D7.4, D7.5, D15b).
// Se simula una versión 2 hipotética: la v1 sin `share_basics` y con una
// pregunta nueva. Con el código real CURRENT es 1 y no hay filas anteriores.

vi.mock("@/lib/matching/questionnaire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/matching/questionnaire")>();
  const extra: Question = {
    id: "new_question",
    text: "Pregunta nueva de la versión 2 (solo en este test)",
    category: "personality",
    comparison: "similarity",
    scale: { min: 1, max: 5 },
    labels: { 1: "Poco", 5: "Mucho" },
  };
  const v2: Questionnaire = {
    version: 2,
    questions: [
      ...actual.QUESTIONNAIRE_V1.questions.filter((q) => q.id !== "share_basics"),
      extra,
    ],
  };
  return {
    ...actual,
    CURRENT_QUESTIONNAIRE_VERSION: 2,
    getCurrentQuestionnaire: () => v2,
    getQuestionnaire: (version: number) =>
      version === 1 ? actual.QUESTIONNAIRE_V1 : version === 2 ? v2 : null,
  };
});

const { getOwnQuestionnaire, saveQuestionnaireAnswers } =
  await import("@/lib/services/compatibility");
const { QUESTIONNAIRE_V1 } = await import("@/lib/matching/questionnaire");

const USER = "11111111-2222-4333-8444-555555555555";
const ACTIVE = {
  id: USER,
  deleted_at: null,
  onboarding_completed_at: "2026-10-01T10:00:00Z",
};
const V1_ANSWERS = Object.fromEntries(QUESTIONNAIRE_V1.questions.map((q) => [q.id, 2]));

type Row = {
  questionnaire_version: number;
  answers: unknown;
  completed_at: string | null;
};

function userClient(row: Row | null) {
  return createFakeSupabase({
    userId: USER,
    respond: (call) =>
      call.table === "profiles"
        ? { data: ACTIVE, error: null }
        : { data: row, error: null },
  });
}

function adminClient(response?: (call: Call) => FakeResponse) {
  const fake = createFakeSupabase({
    userId: null,
    respond: (call) =>
      response
        ? response(call)
        : {
            data: {
              questionnaire_version: call.payload?.questionnaire_version,
              answers: call.payload?.answers,
              completed_at: call.payload?.completed_at ?? null,
            },
            error: null,
          },
  });
  return { ...fake, deps: { adminClient: () => fake.client } };
}

describe("cambio de versión (CURRENT = 2 simulada)", () => {
  it("una fila de la v1 completada es `outdated` y se rellena con las respuestas cuyo id sigue existiendo", async () => {
    const user = userClient({
      questionnaire_version: 1,
      answers: V1_ANSWERS,
      completed_at: "2026-10-02T10:00:00Z",
    });
    const result = await getOwnQuestionnaire(user.client);
    expect(result.ok && result.data.status).toBe("outdated");
    expect(result.ok && result.data.storedVersion).toBe(1);
    expect(result.ok && result.data.currentVersion).toBe(2);
    const answers = result.ok ? result.data.answers : {};
    expect(Object.keys(answers)).toHaveLength(28);
    expect(answers).not.toHaveProperty("share_basics");
    expect(answers).not.toHaveProperty("new_question");
  });

  it("D7.3: reutilizadas + la pregunta nueva = completo → sube de versión y completa en la misma escritura", async () => {
    const user = userClient({
      questionnaire_version: 1,
      answers: V1_ANSWERS,
      completed_at: "2026-10-02T10:00:00Z",
    });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { new_question: 3 },
      admin.deps
    );
    expect(result.ok && result.data.status).toBe("completed");
    const [update] = writePayloads(admin.calls);
    expect(update.operation).toBe("update");
    expect(update.payload?.questionnaire_version).toBe(2);
    expect(typeof update.payload?.completed_at).toBe("string");
    expect(update.payload?.answers).not.toHaveProperty("share_basics");
    expect((update.payload?.answers as Record<string, number>).new_question).toBe(3);
    expect(Object.keys(update.payload?.answers as object)).toHaveLength(29);
    // La fila se actualiza solo si sigue en la v1.
    expect(update.filters).toEqual([
      { kind: "eq", column: "profile_id", value: USER },
      { kind: "eq", column: "questionnaire_version", value: 1 },
    ]);
  });

  it("D7.4: si con lo nuevo sigue incompleto → borrador de la v2 (completed_at null)", async () => {
    const user = userClient({
      questionnaire_version: 1,
      answers: V1_ANSWERS,
      completed_at: "2026-10-02T10:00:00Z",
    });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { clean_dishes: 5 },
      admin.deps
    );
    expect(result.ok && result.data.status).toBe("draft");
    const [update] = writePayloads(admin.calls);
    expect(update.payload).toMatchObject({
      questionnaire_version: 2,
      completed_at: null,
    });
  });

  it("una respuesta a una pregunta que ya no existe se rechaza (estricto con la versión vigente)", async () => {
    const user = userClient(null);
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { share_basics: 3 },
      admin.deps
    );
    expect(!result.ok && result.error).toBe("validation");
  });

  it("D7.5: una fila de una versión posterior a la vigente no se toca", async () => {
    const user = userClient({
      questionnaire_version: 3,
      answers: {},
      completed_at: null,
    });
    const admin = adminClient();
    expect(
      await saveQuestionnaireAnswers(user.client, { new_question: 3 }, admin.deps)
    ).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(writePayloads(admin.calls)).toHaveLength(0);
  });
});
