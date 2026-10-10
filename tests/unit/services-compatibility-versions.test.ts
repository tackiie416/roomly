import { describe, expect, it } from "vitest";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  QUESTIONNAIRE_V2,
} from "@/lib/matching/questionnaire";
import {
  getOwnQuestionnaire,
  saveQuestionnaireAnswers,
} from "@/lib/services/compatibility";
import {
  createFakeSupabase,
  writePayloads,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";

// Fase 3 (S1–S4) — paso real de la v1 a la v2 (D7.3, D7.4, D7.5, D15b). Las 21
// respuestas cuyo id sigue en la v2 se reutilizan; las de los ocho ids que la
// v2 sustituye (lectura estricta de D15a) no se copian ni se reinterpretan
// bajo sus ids `_v2`.

/** Los ocho ids de la v1 que la v2 sustituye. */
const REPLACED_V1_IDS = [
  "noise_own",
  "noise_tolerance",
  "party_own",
  "party_tolerance",
  "guests_overnight_own",
  "guests_overnight_tolerance",
  "pets_own",
  "pets_tolerance",
];
const NEW_V2_IDS = REPLACED_V1_IDS.map((id) => `${id}_v2`);
const SHARED_IDS = QUESTIONNAIRE_V1.questions
  .map((q) => q.id)
  .filter((id) => !REPLACED_V1_IDS.includes(id));

const USER = "11111111-2222-4333-8444-555555555555";
const ACTIVE = {
  id: USER,
  deleted_at: null,
  onboarding_completed_at: "2026-10-01T10:00:00Z",
};
/** Un test v1 completo, todo a 2 (válido en las escalas 1–3 y 1–5). */
const V1_ANSWERS = Object.fromEntries(QUESTIONNAIRE_V1.questions.map((q) => [q.id, 2]));
/** Respuestas a los ocho ids nuevos, a 1: distintas de las de la v1. */
const NEW_ANSWERS = Object.fromEntries(NEW_V2_IDS.map((id) => [id, 1]));

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
  let created = 0;
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
  return {
    ...fake,
    deps: {
      adminClient: () => {
        created += 1;
        return fake.client;
      },
    },
    created: () => created,
  };
}

const sorted = (ids: string[]) => [...ids].sort();

describe("paso de la v1 a la v2", () => {
  it("precondición: la v2 es la vigente y sustituye exactamente esos ocho ids", () => {
    expect(CURRENT_QUESTIONNAIRE_VERSION).toBe(2);
    expect(SHARED_IDS).toHaveLength(21);
    const v2Ids = QUESTIONNAIRE_V2.questions.map((q) => q.id);
    expect(sorted(v2Ids)).toEqual(sorted([...SHARED_IDS, ...NEW_V2_IDS]));
    for (const id of REPLACED_V1_IDS) expect(v2Ids).not.toContain(id);
  });

  it("un test v1 completado es `outdated` y se rellena solo con las 21 respuestas comunes", async () => {
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
    expect(sorted(Object.keys(answers))).toEqual(sorted(SHARED_IDS));
    expect(Object.values(answers).every((value) => value === 2)).toBe(true);
    // Ni los ocho ids de la v1 ni sus `_v2`: una respuesta de la v1 no se
    // presenta como respuesta a la pregunta nueva.
    for (const id of [...REPLACED_V1_IDS, ...NEW_V2_IDS]) {
      expect(answers).not.toHaveProperty(id);
    }
    expect(user.calls.every((c) => c.operation === "select")).toBe(true);
  });

  it("un borrador de la v1 también es `outdated` y conserva solo lo común", async () => {
    const user = userClient({
      questionnaire_version: 1,
      answers: { clean_dishes: 4, noise_tolerance: 1, pets_own: 3 },
      completed_at: null,
    });
    const result = await getOwnQuestionnaire(user.client);
    expect(result.ok && result.data.status).toBe("outdated");
    expect(result.ok && result.data.answers).toEqual({ clean_dishes: 4 });
  });

  it("D7.3: las 21 reutilizadas + los ocho ids nuevos → sube a la v2 y completa en la misma escritura", async () => {
    const user = userClient({
      questionnaire_version: 1,
      answers: V1_ANSWERS,
      completed_at: "2026-10-02T10:00:00Z",
    });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(user.client, NEW_ANSWERS, admin.deps);
    expect(result.ok && result.data.status).toBe("completed");
    const writes = writePayloads(admin.calls);
    expect(writes).toHaveLength(1);
    const [update] = writes;
    expect(update.operation).toBe("update");
    expect(update.payload?.questionnaire_version).toBe(2);
    expect(typeof update.payload?.completed_at).toBe("string");
    const saved = update.payload?.answers as Record<string, number>;
    expect(sorted(Object.keys(saved))).toEqual(
      sorted(QUESTIONNAIRE_V2.questions.map((q) => q.id))
    );
    for (const id of REPLACED_V1_IDS) expect(saved).not.toHaveProperty(id);
    for (const id of NEW_V2_IDS) expect(saved[id]).toBe(1);
    for (const id of SHARED_IDS) expect(saved[id]).toBe(2);
    // La fila se actualiza solo si sigue en la v1.
    expect(update.filters).toEqual([
      { kind: "eq", column: "profile_id", value: USER },
      { kind: "eq", column: "questionnaire_version", value: 1 },
    ]);
  });

  it("D7.4: sin los ocho ids nuevos, la primera escritura de la v2 es un borrador y faltan exactamente esos ocho", async () => {
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
    const saved = update.payload?.answers as Record<string, number>;
    expect(sorted(Object.keys(saved))).toEqual(sorted(SHARED_IDS));
    expect(saved.clean_dishes).toBe(5);
    const answers = result.ok ? result.data.answers : {};
    const missing = QUESTIONNAIRE_V2.questions
      .map((q) => q.id)
      .filter((id) => !(id in answers));
    expect(sorted(missing)).toEqual(sorted(NEW_V2_IDS));
  });

  it("D7.4: con solo siete de los ocho ids nuevos, sigue en borrador", async () => {
    const user = userClient({
      questionnaire_version: 1,
      answers: V1_ANSWERS,
      completed_at: "2026-10-02T10:00:00Z",
    });
    const admin = adminClient();
    const partial = { ...NEW_ANSWERS };
    delete partial.pets_tolerance_v2;
    const result = await saveQuestionnaireAnswers(user.client, partial, admin.deps);
    expect(result.ok && result.data.status).toBe("draft");
    expect(writePayloads(admin.calls)[0].payload?.completed_at).toBeNull();
  });

  it.each(REPLACED_V1_IDS)(
    "una respuesta al id de la v1 %s se rechaza: no se guarda con su significado antiguo",
    async (id) => {
      const user = userClient({
        questionnaire_version: 1,
        answers: V1_ANSWERS,
        completed_at: "2026-10-02T10:00:00Z",
      });
      const admin = adminClient();
      const result = await saveQuestionnaireAnswers(user.client, { [id]: 1 }, admin.deps);
      expect(!result.ok && result.error).toBe("validation");
      expect(admin.created()).toBe(0);
    }
  );

  it("los ids nuevos se validan con la escala de la v2", async () => {
    const user = userClient(null);
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { pets_own_v2: 4 },
      admin.deps
    );
    expect(!result.ok && result.error).toBe("validation");
    expect(admin.created()).toBe(0);
  });

  it("D7.5: de una fila de una versión posterior a la vigente no se usan las respuestas ni se escribe nada", async () => {
    const later: Row = {
      questionnaire_version: 3,
      answers: { clean_dishes: 4 },
      completed_at: null,
    };
    const read = await getOwnQuestionnaire(userClient(later).client);
    expect(read.ok && read.data.status).toBe("unsupported");
    expect(read.ok && read.data.answers).toEqual({});
    const admin = adminClient();
    expect(
      await saveQuestionnaireAnswers(userClient(later).client, NEW_ANSWERS, admin.deps)
    ).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(writePayloads(admin.calls)).toHaveLength(0);
  });
});
