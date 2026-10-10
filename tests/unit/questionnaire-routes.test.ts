import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  writePayloads,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";
import { TEST_USER, profileRow, type ProfileFixture } from "./helpers/profile-rows";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";

// Fase 3.5 — guards de /test y /explorar y Server Action del test.
// /test nunca redirige según el estado del test; /explorar sin test
// completado → /test; al completar → /explorar. Con la versión vigente (la
// v2); un test de la v1 es `outdated`.

const CURRENT = CURRENT_QUESTIONNAIRE_VERSION;
/** Los ocho ids de la v1 que la v2 sustituye (S1–S4). */
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

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const adminMock = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: adminMock.createAdminClient,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { requireCompletedQuestionnaire, requireQuestionnaire } from "@/lib/auth/session";
import { submitQuestionnaire } from "@/app/actions/compatibility";

type Row = {
  questionnaire_version: number;
  answers: unknown;
  completed_at: string | null;
};

const redirectsTo = (url: string) => expect.objectContaining({ url });

function as(
  fixture: ProfileFixture | "anonymous",
  row: Row | null = null,
  rowResponse?: FakeResponse
) {
  const user = createFakeSupabase({
    userId: fixture === "anonymous" ? null : TEST_USER,
    respond: (call: Call) => {
      if (call.table === "profiles")
        return {
          data:
            fixture === "anonymous" || fixture === "no_profile"
              ? null
              : profileRow(fixture),
          error: null,
        };
      if (call.table === "compatibility_responses")
        return rowResponse ?? { data: row, error: null };
      return { data: null, error: null };
    },
  });
  const admin = createFakeSupabase({
    userId: null,
    respond: (call) => ({
      data: {
        questionnaire_version: call.payload?.questionnaire_version ?? CURRENT,
        answers: call.payload?.answers ?? {},
        completed_at:
          call.payload && "completed_at" in call.payload
            ? call.payload.completed_at
            : "2026-10-02T10:00:00Z",
      },
      error: null,
    }),
  });
  serverMock.createClient.mockResolvedValue(user.client);
  adminMock.createAdminClient.mockReturnValue(admin.client);
  return { user, admin };
}

const allAnswers = () =>
  Object.fromEntries(getCurrentQuestionnaire().questions.map((q) => [q.id, 2]));
/** Un test v1 completo. */
const allV1Answers = () =>
  Object.fromEntries(QUESTIONNAIRE_V1.questions.map((q) => [q.id, 2]));

function form(values: Record<string, string | number>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, String(value));
  return data;
}

beforeEach(() => {
  serverMock.createClient.mockReset();
  adminMock.createAdminClient.mockReset();
});

describe("requireQuestionnaire (/test)", () => {
  it("sin sesión → /login?next=/test", async () => {
    as("anonymous");
    await expect(requireQuestionnaire("/test")).rejects.toEqual(
      redirectsTo("/login?next=%2Ftest")
    );
  });

  it.each([
    ["no_profile", "/bienvenida/perfil"],
    ["incomplete", "/bienvenida/preferencias"],
    ["deleted", "/cuenta-desactivada"],
  ] as const)("%s → %s", async (fixture, expected) => {
    as(fixture);
    await expect(requireQuestionnaire("/test")).rejects.toEqual(redirectsTo(expected));
  });

  it.each<[string, Row | null, string]>([
    ["sin test", null, "none"],
    [
      "borrador",
      {
        questionnaire_version: CURRENT,
        answers: { clean_frequency: 3 },
        completed_at: null,
      },
      "draft",
    ],
    [
      "completado",
      {
        questionnaire_version: CURRENT,
        answers: allAnswers(),
        completed_at: "2026-10-02T10:00:00Z",
      },
      "completed",
    ],
  ])("%s → no redirige (estado %s)", async (_label, row, status) => {
    as("complete", row);
    await expect(requireQuestionnaire("/test")).resolves.toMatchObject({ status });
  });

  it("completado en la v1 → no redirige (outdated) y solo trae las 21 respuestas comunes", async () => {
    as("complete", {
      questionnaire_version: 1,
      answers: allV1Answers(),
      completed_at: "2026-10-02T10:00:00Z",
    });
    const questionnaire = await requireQuestionnaire("/test");
    expect(questionnaire).toMatchObject({
      status: "outdated",
      storedVersion: 1,
      currentVersion: CURRENT,
    });
    expect(Object.keys(questionnaire.answers)).toHaveLength(21);
    for (const id of REPLACED_V1_IDS) {
      expect(questionnaire.answers).not.toHaveProperty(id);
      expect(questionnaire.answers).not.toHaveProperty(`${id}_v2`);
    }
  });

  it("versión posterior a la vigente (anomalía) → error genérico, sin redirigir", async () => {
    as("complete", { questionnaire_version: 9, answers: {}, completed_at: null });
    const error = await requireQuestionnaire("/test").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("url");
  });

  it("error de base de datos → error genérico sin el mensaje", async () => {
    as("complete", null, {
      data: null,
      error: { code: "XX000", message: "detalle interno" },
    });
    const error = await requireQuestionnaire("/test").catch((e: unknown) => e);
    expect((error as Error).message).not.toContain("detalle interno");
    expect(error).not.toHaveProperty("url");
  });

  it("nunca usa service_role para leer el estado propio", async () => {
    as("complete", null);
    await requireQuestionnaire("/test");
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("requireCompletedQuestionnaire (/explorar)", () => {
  it.each<[string, Row | null]>([
    ["sin test", null],
    ["borrador", { questionnaire_version: CURRENT, answers: {}, completed_at: null }],
  ])("%s → 307 a /test", async (_label, row) => {
    as("complete", row);
    await expect(requireCompletedQuestionnaire()).rejects.toEqual(redirectsTo("/test"));
  });

  it("onboarding incompleto → al onboarding, no a /test", async () => {
    as("incomplete");
    await expect(requireCompletedQuestionnaire()).rejects.toEqual(
      redirectsTo("/bienvenida/preferencias")
    );
  });

  it("sin sesión → /login?next=/explorar", async () => {
    as("anonymous");
    await expect(requireCompletedQuestionnaire()).rejects.toEqual(
      redirectsTo("/login?next=%2Fexplorar")
    );
  });

  it("completado en la versión vigente → pasa", async () => {
    as("complete", {
      questionnaire_version: CURRENT,
      answers: allAnswers(),
      completed_at: "2026-10-02T10:00:00Z",
    });
    await expect(requireCompletedQuestionnaire()).resolves.toMatchObject({
      status: "completed",
    });
  });
});

describe("submitQuestionnaire", () => {
  it("guarda a medias: no redirige y dice cuántas faltan", async () => {
    const { admin, user } = as("complete", null);
    const state = await submitQuestionnaire(
      {},
      form({ clean_frequency: 3, smoke_own: 1 })
    );
    expect(state.success).toBe(
      "Progreso guardado. Te faltan 27 preguntas para terminar."
    );
    expect(state.values).toEqual({ clean_frequency: "3", smoke_own: "1" });
    expect(writePayloads(admin.calls)[0].payload).toMatchObject({
      profile_id: TEST_USER,
      questionnaire_version: CURRENT,
      completed_at: null,
    });
    expect(writePayloads(user.calls)).toHaveLength(0);
  });

  it("con las 29 respuestas → completado y redirige a /explorar", async () => {
    as("complete", null);
    await expect(submitQuestionnaire({}, form(allAnswers()))).rejects.toEqual(
      redirectsTo("/explorar")
    );
  });

  it("una sola pregunta pendiente: singular", async () => {
    const answers = allAnswers();
    delete (answers as Record<string, number>).rules_explicit;
    as("complete", null);
    const state = await submitQuestionnaire({}, form(answers));
    expect(state.success).toBe("Progreso guardado. Te falta 1 pregunta para terminar.");
  });

  it("test v1 completado + un formulario antiguo con los ids de la v1 → se rechaza sin escribir", async () => {
    const { admin } = as("complete", {
      questionnaire_version: 1,
      answers: allV1Answers(),
      completed_at: "2026-10-02T10:00:00Z",
    });
    const state = await submitQuestionnaire({}, form(allV1Answers()));
    expect(state.formError).toContain("Campo no permitido");
    expect(state.success).toBeUndefined();
    expect(admin.calls).toHaveLength(0);
  });

  it("test v1 completado + solo respuestas comunes → borrador de la v2 al que le faltan los ocho ids nuevos", async () => {
    const { admin } = as("complete", {
      questionnaire_version: 1,
      answers: allV1Answers(),
      completed_at: "2026-10-02T10:00:00Z",
    });
    const state = await submitQuestionnaire({}, form({ clean_frequency: 4 }));
    expect(state.success).toBe("Progreso guardado. Te faltan 8 preguntas para terminar.");
    const [write] = writePayloads(admin.calls);
    expect(write.payload).toMatchObject({
      questionnaire_version: CURRENT,
      completed_at: null,
    });
    const saved = write.payload?.answers as Record<string, number>;
    expect(Object.keys(saved)).toHaveLength(21);
    expect(saved.clean_frequency).toBe(4);
    for (const id of REPLACED_V1_IDS) {
      expect(saved).not.toHaveProperty(id);
      expect(saved).not.toHaveProperty(`${id}_v2`);
    }
  });

  it("test v1 completado + las 29 de la v2 → completado en la v2 y redirige a /explorar", async () => {
    const { admin } = as("complete", {
      questionnaire_version: 1,
      answers: allV1Answers(),
      completed_at: "2026-10-02T10:00:00Z",
    });
    await expect(submitQuestionnaire({}, form(allAnswers()))).rejects.toEqual(
      redirectsTo("/explorar")
    );
    const [write] = writePayloads(admin.calls);
    expect(write.payload?.questionnaire_version).toBe(CURRENT);
    expect(typeof write.payload?.completed_at).toBe("string");
  });

  it.each(["profile_id", "questionnaire_version", "completed_at"])(
    "un campo %s inyectado se rechaza sin escribir",
    async (field) => {
      const { admin } = as("complete", null);
      const state = await submitQuestionnaire(
        {},
        form({ clean_frequency: 3, [field]: "x" })
      );
      expect(state.formError).toContain("Campo no permitido");
      expect(admin.calls).toHaveLength(0);
    }
  );

  it("valor fuera de escala → error en esa pregunta", async () => {
    as("complete", null);
    const state = await submitQuestionnaire({}, form({ clean_frequency: 9 }));
    expect(state.fieldErrors?.clean_frequency).toBeTruthy();
  });

  it("onboarding sin completar → al onboarding, sin escribir", async () => {
    const { admin } = as("incomplete");
    await expect(submitQuestionnaire({}, form({ clean_frequency: 3 }))).rejects.toEqual(
      redirectsTo("/bienvenida/preferencias")
    );
    expect(admin.calls).toHaveLength(0);
  });

  it("cuenta eliminada → /cuenta-desactivada", async () => {
    as("deleted");
    await expect(submitQuestionnaire({}, form({ clean_frequency: 3 }))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
  });

  it("conflicto (otra pestaña) → mensaje, sin detalles técnicos", async () => {
    const { admin } = as("complete", {
      questionnaire_version: CURRENT,
      answers: {},
      completed_at: null,
    });
    // La fila cambió: 0 filas actualizadas.
    adminMock.createAdminClient.mockReturnValue(
      createFakeSupabase({ userId: null, respond: () => ({ data: null, error: null }) })
        .client
    );
    const state = await submitQuestionnaire({}, form({ clean_frequency: 3 }));
    expect(state.formError).toContain("otra pestaña");
    expect(admin.calls).toHaveLength(0);
  });
});
