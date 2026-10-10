import { describe, expect, it } from "vitest";
import {
  getOwnQuestionnaire,
  saveQuestionnaireAnswers,
} from "@/lib/services/compatibility";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";
import {
  createFakeSupabase,
  dbError,
  writePayloads,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";

// Fase 3.1 — servicio del test propio. El cliente del usuario solo LEE
// (perfil y fila propia); el cliente admin (service_role) solo ESCRIBE.
// profile_id sale de la sesión; versión y completed_at los decide el servidor.
// Con la versión vigente (la v2 desde S1–S4); el paso desde la v1, en
// services-compatibility-versions.test.ts.

const USER = "11111111-2222-4333-8444-555555555555";
const CURRENT = CURRENT_QUESTIONNAIRE_VERSION;
/** Una versión que el código no conoce (anomalía). */
const LATER = CURRENT_QUESTIONNAIRE_VERSION + 1;
const ACTIVE = {
  id: USER,
  deleted_at: null,
  onboarding_completed_at: "2026-10-01T10:00:00Z",
};

function allAnswers(value = 1): Record<string, number> {
  return Object.fromEntries(
    getCurrentQuestionnaire().questions.map((q) => [q.id, value])
  );
}
function allButLast(value = 1): Record<string, number> {
  const answers = allAnswers(value);
  delete answers.rules_explicit;
  return answers;
}

type Row = {
  questionnaire_version: number;
  answers: unknown;
  completed_at: string | null;
};

/** Cliente del usuario: responde al perfil y a la fila propia. */
function userClient(options: {
  profile?: unknown;
  row?: Row | null;
  userId?: string | null;
  rowError?: FakeResponse;
}) {
  return createFakeSupabase({
    userId: options.userId === undefined ? USER : options.userId,
    respond: (call) => {
      if (call.table === "profiles")
        return { data: options.profile ?? ACTIVE, error: null };
      if (call.table === "compatibility_responses") {
        return options.rowError ?? { data: options.row ?? null, error: null };
      }
      return { data: null, error: null };
    },
  });
}

/** Cliente admin: devuelve lo que se escribió (o el error/null indicado). */
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
              completed_at:
                "completed_at" in (call.payload ?? {})
                  ? call.payload?.completed_at
                  : "2026-10-02T10:00:00Z",
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

describe("getOwnQuestionnaire (solo lectura, cliente del usuario)", () => {
  it("sin sesión → unauthenticated", async () => {
    const user = userClient({ userId: null });
    expect(await getOwnQuestionnaire(user.client)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it.each<[string, Row | null, string]>([
    ["sin fila → none", null, "none"],
    [
      "versión vigente sin completar → draft",
      { questionnaire_version: CURRENT, answers: {}, completed_at: null },
      "draft",
    ],
    [
      "versión vigente completada → completed",
      {
        questionnaire_version: CURRENT,
        answers: allAnswers(),
        completed_at: "2026-10-02T10:00:00Z",
      },
      "completed",
    ],
    [
      "versión posterior (anomalía) → unsupported",
      { questionnaire_version: LATER, answers: allAnswers(), completed_at: null },
      "unsupported",
    ],
  ])("%s", async (_label, row, status) => {
    const user = userClient({ row });
    const result = await getOwnQuestionnaire(user.client);
    expect(result.ok && result.data.status).toBe(status);
    expect(user.calls.every((c) => c.operation === "select")).toBe(true);
    const own = user.calls.find((c) => c.table === "compatibility_responses")!;
    expect(own.columns).toBe("questionnaire_version, answers, completed_at");
    expect(own.filters).toEqual([{ kind: "eq", column: "profile_id", value: USER }]);
  });

  it("devuelve solo respuestas válidas de ids conocidos", async () => {
    const user = userClient({
      row: {
        questionnaire_version: CURRENT,
        answers: {
          clean_frequency: 3,
          smoke_own: 9,
          desconocida: 2,
          rules_explicit: "4",
        },
        completed_at: null,
      },
    });
    const result = await getOwnQuestionnaire(user.client);
    expect(result.ok && result.data.answers).toEqual({ clean_frequency: 3 });
  });

  it("un error de la base de datos no se expone", async () => {
    const user = userClient({ rowError: dbError("XX000", "detalle interno") });
    expect(await getOwnQuestionnaire(user.client)).toEqual({
      ok: false,
      error: "unknown",
    });
  });
});

describe("saveQuestionnaireAnswers: comprobaciones antes de escribir", () => {
  it("sin sesión → unauthenticated, sin cliente admin", async () => {
    const user = userClient({ userId: null });
    const admin = adminClient();
    expect(await saveQuestionnaireAnswers(user.client, allAnswers(), admin.deps)).toEqual(
      {
        ok: false,
        error: "unauthenticated",
      }
    );
    expect(admin.created()).toBe(0);
  });

  it.each([
    ["profile_id", { profile_id: "99999999-9999-4999-8999-999999999999" }],
    ["questionnaire_version", { questionnaire_version: 7 }],
    ["completed_at", { completed_at: "2026-10-01T00:00:00Z" }],
    ["una pregunta inventada", { favorite_color: 2 }],
  ])("rechaza %s del cliente (estricto) sin escribir", async (_label, extra) => {
    const user = userClient({});
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { ...allAnswers(), ...extra },
      admin.deps
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("validation");
    expect(admin.created()).toBe(0);
  });

  it.each([0, 6, 2.5, "3", null])(
    "rechaza el valor %j fuera de escala o de tipo",
    async (value) => {
      const user = userClient({});
      const admin = adminClient();
      const result = await saveQuestionnaireAnswers(
        user.client,
        { clean_frequency: value },
        admin.deps
      );
      expect(!result.ok && result.error).toBe("validation");
      expect(!result.ok && result.fieldErrors?.clean_frequency).toBeTruthy();
      expect(admin.created()).toBe(0);
    }
  );

  it("4 en una escala 1–3 se rechaza", async () => {
    const user = userClient({});
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { smoke_own: 4 },
      admin.deps
    );
    expect(!result.ok && result.error).toBe("validation");
  });

  it.each<[string, unknown, string]>([
    ["sin perfil", null, "no_profile"],
    ["cuenta eliminada", { ...ACTIVE, deleted_at: "2026-10-03T10:00:00Z" }, "deleted"],
    [
      "onboarding sin completar",
      { ...ACTIVE, onboarding_completed_at: null },
      "forbidden",
    ],
  ])("%s → %s, sin escribir", async (_label, profile, error) => {
    const user = createFakeSupabase({
      userId: USER,
      respond: (call) =>
        call.table === "profiles"
          ? { data: profile, error: null }
          : { data: null, error: null },
    });
    const admin = adminClient();
    expect(await saveQuestionnaireAnswers(user.client, allAnswers(), admin.deps)).toEqual(
      {
        ok: false,
        error,
      }
    );
    expect(admin.created()).toBe(0);
  });

  it("una fila de una versión posterior (anomalía) no se toca → conflict", async () => {
    const user = userClient({
      row: { questionnaire_version: LATER, answers: allAnswers(), completed_at: null },
    });
    const admin = adminClient();
    expect(await saveQuestionnaireAnswers(user.client, allAnswers(), admin.deps)).toEqual(
      {
        ok: false,
        error: "conflict",
      }
    );
    expect(admin.created()).toBe(0);
  });
});

describe("saveQuestionnaireAnswers: escrituras (D7.1–D7.4)", () => {
  it("primer guardado parcial → INSERT de un borrador, con profile_id de la sesión y la versión vigente", async () => {
    const user = userClient({ row: null });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { clean_frequency: 3 },
      admin.deps
    );
    expect(result.ok && result.data.status).toBe("draft");
    const writes = writePayloads(admin.calls);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      table: "compatibility_responses",
      operation: "insert",
      payload: {
        profile_id: USER,
        questionnaire_version: CURRENT,
        answers: { clean_frequency: 3 },
        completed_at: null,
      },
    });
    // El cliente del usuario nunca escribe.
    expect(writePayloads(user.calls)).toHaveLength(0);
  });

  it("D7.1: primer guardado con las 29 → INSERT ya completado", async () => {
    const user = userClient({ row: null });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(user.client, allAnswers(2), admin.deps);
    expect(result.ok && result.data.status).toBe("completed");
    const insert = writePayloads(admin.calls)[0];
    expect(typeof insert.payload?.completed_at).toBe("string");
    expect(Object.keys(insert.payload?.answers as object)).toHaveLength(29);
  });

  it("borrador + las preguntas que faltan → UPDATE que completa (filtrado por versión y completed_at NULL)", async () => {
    const user = userClient({
      row: { questionnaire_version: CURRENT, answers: allButLast(), completed_at: null },
    });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { rules_explicit: 4 },
      admin.deps
    );
    expect(result.ok && result.data.status).toBe("completed");
    const update = writePayloads(admin.calls)[0];
    expect(update.operation).toBe("update");
    expect(update.payload).toMatchObject({ questionnaire_version: CURRENT });
    expect(typeof update.payload?.completed_at).toBe("string");
    expect((update.payload?.answers as Record<string, number>).rules_explicit).toBe(4);
    expect(update.filters).toEqual([
      { kind: "eq", column: "profile_id", value: USER },
      { kind: "eq", column: "questionnaire_version", value: CURRENT },
      { kind: "is", column: "completed_at", value: null },
    ]);
  });

  it("borrador que sigue incompleto → completed_at null", async () => {
    const user = userClient({
      row: { questionnaire_version: CURRENT, answers: {}, completed_at: null },
    });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { clean_dishes: 5 },
      admin.deps
    );
    expect(result.ok && result.data.status).toBe("draft");
    expect(writePayloads(admin.calls)[0].payload?.completed_at).toBeNull();
  });

  it("D7.2: rehacer un test completado → UPDATE sin completed_at (la fecha no cambia)", async () => {
    const user = userClient({
      row: {
        questionnaire_version: CURRENT,
        answers: allAnswers(),
        completed_at: "2026-10-02T10:00:00Z",
      },
    });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { clean_dishes: 5 },
      admin.deps
    );
    expect(result.ok && result.data.status).toBe("completed");
    const update = writePayloads(admin.calls)[0];
    expect(update.payload).not.toHaveProperty("completed_at");
    expect((update.payload?.answers as Record<string, number>).clean_dishes).toBe(5);
    expect(update.filters).toEqual([
      { kind: "eq", column: "profile_id", value: USER },
      { kind: "eq", column: "questionnaire_version", value: CURRENT },
    ]);
  });

  it("D7.2: un test completado con respuestas guardadas corruptas no vuelve a borrador", async () => {
    const corrupt = allAnswers();
    corrupt.rules_explicit = 99;
    const user = userClient({
      row: {
        questionnaire_version: CURRENT,
        answers: corrupt,
        completed_at: "2026-10-02T10:00:00Z",
      },
    });
    const admin = adminClient();
    const result = await saveQuestionnaireAnswers(
      user.client,
      { clean_dishes: 5 },
      admin.deps
    );
    expect(!result.ok && result.error).toBe("validation");
    expect(admin.created()).toBe(0);
  });

  it("si otra pestaña cambió la fila (0 filas actualizadas) → conflict", async () => {
    const user = userClient({
      row: { questionnaire_version: CURRENT, answers: {}, completed_at: null },
    });
    const admin = adminClient(() => ({ data: null, error: null }));
    expect(
      await saveQuestionnaireAnswers(user.client, { clean_dishes: 5 }, admin.deps)
    ).toEqual({
      ok: false,
      error: "conflict",
    });
  });
});

describe("saveQuestionnaireAnswers: errores del trigger, sin exponer el mensaje", () => {
  it.each<[string, FakeResponse, string]>([
    [
      "cuenta eliminada entre comprobar y escribir",
      dbError("23514", "account_deleted: x"),
      "deleted",
    ],
    ["S4", dbError("23514", "questionnaire_completed_locked: x"), "conflict"],
    ["S3", dbError("23514", "questionnaire_version_downgrade: x"), "conflict"],
    ["S6", dbError("23514", "compatibility_profile_locked: x"), "conflict"],
    ["INSERT duplicado", dbError("23505", "duplicate key"), "conflict"],
    ["RLS/GRANT", dbError("42501", "permission denied"), "forbidden"],
    ["otro", dbError("XX000", "detalle interno"), "unknown"],
  ])("%s → %s", async (_label, response, error) => {
    const user = userClient({ row: null });
    const admin = adminClient(() => response);
    expect(
      await saveQuestionnaireAnswers(user.client, { clean_dishes: 5 }, admin.deps)
    ).toEqual({
      ok: false,
      error,
    });
  });
});
