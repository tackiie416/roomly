import { describe, expect, it, vi } from "vitest";
import type { Question, Questionnaire } from "@/lib/matching/types";

// Fase 3 (S1–S4) — la dirección de las diferencias de Ruido sale de la
// definición del cuestionario que se compara: `noise_tolerance` en la v1 y
// `noise_tolerance_v2` en la v2. Si falta una pregunta de la dirección, el
// motor devuelve `invalid_questionnaire`: nunca NaN ni una dirección calculada
// con un hueco. Para probarlo, el registro simulado añade versiones rotas
// (97–99) a la v1 y la v2 reales.

const broken = vi.hoisted(() => new Map<number, Questionnaire>());

vi.mock("@/lib/matching/questionnaire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/matching/questionnaire")>();
  return {
    ...actual,
    getQuestionnaire: (version: number) =>
      broken.get(version) ?? actual.getQuestionnaire(version),
  };
});

const { QUESTIONNAIRE_V1, QUESTIONNAIRE_V2 } =
  await import("@/lib/matching/questionnaire");
const { calculateCompatibility, directionQuestionIds } =
  await import("@/lib/matching/score");
const { MATCH_WEIGHTS } = await import("@/lib/matching/weights");

type Edit = (questions: Question[]) => Question[];

/** La v2 con un cambio, como versión `version`. */
function variant(version: number, edit: Edit): Questionnaire {
  return { version, questions: edit([...QUESTIONNAIRE_V2.questions]) };
}

const without =
  (id: string): Edit =>
  (questions) =>
    questions.filter((q) => q.id !== id);
const replacing =
  (id: string, change: Partial<Question>): Edit =>
  (questions) =>
    questions.map((q) => (q.id === id ? { ...q, ...change } : q));

function input(
  questionnaire: Questionnaire,
  overrides: Record<string, number> = {}
): Parameters<typeof calculateCompatibility>[0] {
  const answers: Record<string, number> = {};
  for (const q of questionnaire.questions) answers[q.id] = 1;
  return {
    questionnaireVersion: questionnaire.version,
    answers: { ...answers, ...overrides },
    housing: { neighborhoodIds: [], budgetMin: null, budgetMax: null },
  };
}

function noiseDirection(a: ReturnType<typeof input>, b: ReturnType<typeof input>) {
  const result = calculateCompatibility(a, b, MATCH_WEIGHTS);
  if (result.status !== "ok") throw new Error(`no comparable: ${result.reason}`);
  return result.reasons.find((r) => r.kind === "difference" && r.category === "noise")
    ?.direction;
}

describe("directionQuestionIds", () => {
  it("v1: la tolerancia de ruido es `noise_tolerance`", () => {
    expect(directionQuestionIds(QUESTIONNAIRE_V1)).toEqual({
      bedtime: "schedule_bedtime",
      wakeup: "schedule_wakeup",
      noiseTolerance: "noise_tolerance",
      quietHours: "rules_quiet_hours",
    });
  });

  it("v2: la tolerancia de ruido es `noise_tolerance_v2`", () => {
    expect(directionQuestionIds(QUESTIONNAIRE_V2)).toEqual({
      bedtime: "schedule_bedtime",
      wakeup: "schedule_wakeup",
      noiseTolerance: "noise_tolerance_v2",
      quietHours: "rules_quiet_hours",
    });
  });

  it.each<[string, Edit]>([
    ["sin la tolerancia de ruido", without("noise_tolerance_v2")],
    [
      "con dos tolerancias de ruido",
      (questions) => [
        ...questions,
        { ...questions.find((q) => q.id === "noise_tolerance_v2")!, id: "otra" },
      ],
    ],
    [
      "con la tolerancia apuntando a una conducta que no existe",
      replacing("noise_tolerance_v2", { toleranceOf: "noise_own" }),
    ],
    [
      "con una pareja no recíproca (la conducta apunta a otra tolerancia)",
      replacing("noise_own_v2", { pairedWith: "noise_tolerance" }),
    ],
    [
      "con la tolerancia apuntando a una pregunta de otra categoría",
      replacing("noise_tolerance_v2", { toleranceOf: "party_own_v2" }),
    ],
    ["sin las horas de silencio", without("rules_quiet_hours")],
    [
      "con las horas de silencio en otra categoría",
      replacing("rules_quiet_hours", { category: "study" }),
    ],
    [
      "con las horas de silencio como conducta",
      replacing("rules_quiet_hours", { comparison: "behavior" }),
    ],
    ["sin la hora de acostarse", without("schedule_bedtime")],
    ["sin la hora de levantarse", without("schedule_wakeup")],
  ])("%s → null", (_label, edit) => {
    expect(directionQuestionIds(variant(99, edit))).toBeNull();
  });
});

describe("dirección de Ruido con los ids de cada versión", () => {
  it("v1: A tolera menos (`noise_tolerance`) y quiere más silencio → a_more; al revés → b_more", () => {
    const quiet = input(QUESTIONNAIRE_V1, { noise_tolerance: 1, rules_quiet_hours: 5 });
    const loud = input(QUESTIONNAIRE_V1, { noise_tolerance: 5, rules_quiet_hours: 1 });
    expect(noiseDirection(quiet, loud)).toBe("a_more");
    expect(noiseDirection(loud, quiet)).toBe("b_more");
  });

  it("v2: A tolera menos (`noise_tolerance_v2`) y quiere más silencio → a_more; al revés → b_more", () => {
    const quiet = input(QUESTIONNAIRE_V2, {
      noise_tolerance_v2: 1,
      rules_quiet_hours: 5,
    });
    const loud = input(QUESTIONNAIRE_V2, { noise_tolerance_v2: 5, rules_quiet_hours: 1 });
    expect(noiseDirection(quiet, loud)).toBe("a_more");
    expect(noiseDirection(loud, quiet)).toBe("b_more");
  });

  it("v2: solo la tolerancia de ruido, con las horas de silencio iguales, también da la dirección", () => {
    // Con el id fijo de la v1, Δ tolerancia saldría NaN → 0, y aquí habría null.
    const quiet = input(QUESTIONNAIRE_V2, { noise_tolerance_v2: 1, noise_own_v2: 1 });
    const loud = input(QUESTIONNAIRE_V2, { noise_tolerance_v2: 5, noise_own_v2: 5 });
    expect(noiseDirection(quiet, loud)).toBe("a_more");
  });
});

describe("cuestionario sin las preguntas de la dirección → invalid_questionnaire", () => {
  it.each<[string, number, Edit]>([
    ["sin la tolerancia de ruido", 97, without("noise_tolerance_v2")],
    ["sin las horas de silencio", 98, without("rules_quiet_hours")],
    [
      "con una pareja de ruido no recíproca",
      99,
      replacing("noise_own_v2", { pairedWith: "noise_tolerance" }),
    ],
  ])(
    "%s: nunca un resultado `ok`, ni con diferencias de ruido",
    (_label, version, edit) => {
      const questionnaire = variant(version, edit);
      broken.set(version, questionnaire);
      try {
        const same = input(questionnaire);
        const quiet = input(questionnaire, {
          noise_tolerance_v2: 1,
          rules_quiet_hours: 5,
        });
        const loud = input(questionnaire, {
          noise_own_v2: 5,
          noise_tolerance_v2: 5,
          rules_quiet_hours: 1,
        });
        for (const [a, b] of [
          [same, same],
          [quiet, loud],
          [loud, quiet],
        ]) {
          expect(() => calculateCompatibility(a, b, MATCH_WEIGHTS)).not.toThrow();
          expect(calculateCompatibility(a, b, MATCH_WEIGHTS)).toEqual({
            status: "not_comparable",
            reason: "invalid_questionnaire",
          });
        }
      } finally {
        broken.delete(version);
      }
    }
  );

  it("las versiones reales siguen dando un resultado `ok`", () => {
    for (const questionnaire of [QUESTIONNAIRE_V1, QUESTIONNAIRE_V2]) {
      const a = input(questionnaire);
      expect(calculateCompatibility(a, a, MATCH_WEIGHTS).status).toBe("ok");
    }
  });
});
