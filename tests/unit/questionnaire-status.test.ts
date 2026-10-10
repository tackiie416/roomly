import { describe, expect, it } from "vitest";
import {
  isQuestionnaireComplete,
  questionnaireStatus,
  reusableAnswers,
} from "@/lib/matching/questionnaire-status";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  QUESTIONNAIRE_V2,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";
import {
  questionnaireAnswersSchema,
  questionnaireFormFields,
} from "@/lib/validation/compatibility";

// Fase 3.5 — función única del estado del test, reutilización de respuestas
// por id (D15b) y esquema estricto de entrada.

describe("questionnaireStatus", () => {
  it.each<
    [
      string,
      { questionnaire_version: number; completed_at: string | null } | null,
      string,
    ]
  >([
    ["sin fila", null, "none"],
    ["vigente sin completar", { questionnaire_version: 1, completed_at: null }, "draft"],
    [
      "vigente completado",
      { questionnaire_version: 1, completed_at: "2026-10-02T10:00:00Z" },
      "completed",
    ],
    [
      "anterior completado",
      { questionnaire_version: 1, completed_at: "2026-10-02T10:00:00Z" },
      "outdated",
    ],
    [
      "anterior en borrador",
      { questionnaire_version: 1, completed_at: null },
      "outdated",
    ],
    [
      "posterior (anomalía)",
      { questionnaire_version: 3, completed_at: null },
      "unsupported",
    ],
  ])("%s → %s", (label, row, expected) => {
    const current = label.startsWith("anterior")
      ? 2
      : label.startsWith("posterior")
        ? 2
        : 1;
    expect(questionnaireStatus(row, current)).toBe(expected);
  });

  it("con la versión vigente real (2), un test v1 completado o en borrador es `outdated`", () => {
    expect(CURRENT_QUESTIONNAIRE_VERSION).toBe(2);
    expect(
      questionnaireStatus(
        { questionnaire_version: 1, completed_at: "2026-10-02T10:00:00Z" },
        CURRENT_QUESTIONNAIRE_VERSION
      )
    ).toBe("outdated");
    expect(
      questionnaireStatus(
        { questionnaire_version: 1, completed_at: null },
        CURRENT_QUESTIONNAIRE_VERSION
      )
    ).toBe("outdated");
    expect(
      questionnaireStatus(
        { questionnaire_version: 2, completed_at: "2026-10-10T10:00:00Z" },
        CURRENT_QUESTIONNAIRE_VERSION
      )
    ).toBe("completed");
  });
});

describe("reusableAnswers", () => {
  it("conserva solo ids existentes con valores válidos de su escala", () => {
    expect(
      reusableAnswers(
        {
          clean_frequency: 3,
          smoke_own: 3,
          pets_own: 4,
          borrada: 2,
          rules_explicit: "5",
          noise_own: 2.5,
        },
        QUESTIONNAIRE_V1
      )
    ).toEqual({ clean_frequency: 3, smoke_own: 3 });
  });

  it("de la v1 a la v2: conserva las 21 respuestas comunes y ninguna de los ocho ids sustituidos", () => {
    const v1 = Object.fromEntries(QUESTIONNAIRE_V1.questions.map((q) => [q.id, 2]));
    const reused = reusableAnswers(v1, QUESTIONNAIRE_V2);
    const v2Ids = new Set(QUESTIONNAIRE_V2.questions.map((q) => q.id));
    const shared = QUESTIONNAIRE_V1.questions
      .map((q) => q.id)
      .filter((id) => v2Ids.has(id));
    expect(shared).toHaveLength(21);
    expect(Object.keys(reused).sort()).toEqual([...shared].sort());
    for (const id of [
      "noise_own",
      "noise_tolerance",
      "party_own",
      "party_tolerance",
      "guests_overnight_own",
      "guests_overnight_tolerance",
      "pets_own",
      "pets_tolerance",
    ]) {
      expect(reused).not.toHaveProperty(id);
      expect(reused).not.toHaveProperty(`${id}_v2`);
    }
    expect(isQuestionnaireComplete(reused, QUESTIONNAIRE_V2)).toBe(false);
  });

  it.each([null, [], "x", 5])("con %j devuelve {}", (stored) => {
    expect(reusableAnswers(stored, QUESTIONNAIRE_V1)).toEqual({});
  });
});

describe("isQuestionnaireComplete", () => {
  const all = Object.fromEntries(QUESTIONNAIRE_V1.questions.map((q) => [q.id, 1]));
  it("las 29 → completo; 28 → no", () => {
    expect(isQuestionnaireComplete(all, QUESTIONNAIRE_V1)).toBe(true);
    const missing = { ...all };
    delete missing.pets_tolerance;
    expect(isQuestionnaireComplete(missing, QUESTIONNAIRE_V1)).toBe(false);
  });

  it("las 29 de la v2 → completo; un test v1 completo no completa la v2", () => {
    const allV2 = Object.fromEntries(QUESTIONNAIRE_V2.questions.map((q) => [q.id, 1]));
    expect(isQuestionnaireComplete(allV2, QUESTIONNAIRE_V2)).toBe(true);
    const missing = { ...allV2 };
    delete missing.pets_tolerance_v2;
    expect(isQuestionnaireComplete(missing, QUESTIONNAIRE_V2)).toBe(false);
    expect(isQuestionnaireComplete(all, QUESTIONNAIRE_V2)).toBe(false);
  });
});

describe("questionnaireAnswersSchema (estricto)", () => {
  const schema = questionnaireAnswersSchema();

  it("acepta respuestas parciales con valores de su escala", () => {
    expect(schema.safeParse({ clean_frequency: 5, smoke_own: 2 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it.each([
    ["profile_id", { profile_id: "x" }],
    ["questionnaire_version", { questionnaire_version: 1 }],
    ["completed_at", { completed_at: "2026-10-01" }],
  ])("rechaza %s como campo no permitido", (_label, input) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Campo no permitido");
  });

  it.each([0, 6, 3.5, "3"])("rechaza %j en una escala 1–5", (value) => {
    expect(schema.safeParse({ clean_frequency: value }).success).toBe(false);
  });

  it("rechaza 4 en una escala 1–3", () => {
    expect(schema.safeParse({ smoke_own: 4 }).success).toBe(false);
    expect(schema.safeParse({ smoke_own: 3 }).success).toBe(true);
    expect(schema.safeParse({ pets_own_v2: 4 }).success).toBe(false);
    expect(schema.safeParse({ pets_own_v2: 3 }).success).toBe(true);
  });

  it("es el de la versión vigente: acepta los ids nuevos y rechaza los ocho que la v2 sustituye", () => {
    expect(
      schema.safeParse({ noise_tolerance_v2: 5, party_tolerance_v2: 1 }).success
    ).toBe(true);
    for (const id of [
      "noise_own",
      "noise_tolerance",
      "party_own",
      "party_tolerance",
      "guests_overnight_own",
      "guests_overnight_tolerance",
      "pets_own",
      "pets_tolerance",
    ]) {
      const result = schema.safeParse({ [id]: 1 });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("Campo no permitido");
    }
  });

  it("el formulario tiene un campo numérico por pregunta", () => {
    const fields = questionnaireFormFields();
    expect(getCurrentQuestionnaire()).toBe(QUESTIONNAIRE_V2);
    expect(Object.keys(fields)).toEqual(QUESTIONNAIRE_V2.questions.map((q) => q.id));
    expect(new Set(Object.values(fields))).toEqual(new Set(["number"]));
  });
});
