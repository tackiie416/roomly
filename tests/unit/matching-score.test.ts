import { describe, expect, it } from "vitest";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  getCurrentQuestionnaire,
  getQuestionnaire,
} from "@/lib/matching/questionnaire";
import { budgetGap, calculateCompatibility, r6, roundHalfUp } from "@/lib/matching/score";
import { renderReason } from "@/lib/matching/explanations";
import { CATEGORY_ORDER, MATCH_WEIGHTS } from "@/lib/matching/weights";
import type {
  Category,
  CompatibilityInput,
  CompatibilityResult,
  HousingInput,
  MatchWeights,
} from "@/lib/matching/types";

// Fase 3.2 — motor de compatibilidad. Casos de la especificación cerrada
// (2026-10-07): tabla de conducta/tolerancia (D1), presupuesto 0/75/150/151,
// barrios, renormalización (D3), dirección, umbrales con r6, simetría y
// determinismo.

const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const N3 = "33333333-3333-4333-8333-333333333333";
const N4 = "44444444-4444-4444-8444-444444444444";

/** Todas las respuestas a 1: cada pareja se cumple y todo es idéntico. */
function baseAnswers(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const question of QUESTIONNAIRE_V1.questions) answers[question.id] = 1;
  return { ...answers, ...overrides };
}

const NO_HOUSING: HousingInput = {
  neighborhoodIds: [],
  budgetMin: null,
  budgetMax: null,
};

function person(
  overrides: Record<string, unknown> = {},
  housing: Partial<HousingInput> = {},
  version = CURRENT_QUESTIONNAIRE_VERSION
): CompatibilityInput {
  return {
    questionnaireVersion: version,
    answers: baseAnswers(overrides),
    housing: { ...NO_HOUSING, ...housing },
  };
}

function ok(result: CompatibilityResult) {
  if (result.status !== "ok") throw new Error(`no comparable: ${result.reason}`);
  return result;
}

function score(a: CompatibilityInput, b: CompatibilityInput, weights = MATCH_WEIGHTS) {
  return ok(calculateCompatibility(a, b, weights));
}

describe("cuestionario v1", () => {
  // Lista exacta de la especificación cerrada: id, tipo, escala, categoría y pareja.
  const EXPECTED: Array<[string, string, number, string, string?]> = [
    ["clean_common_standard", "similarity", 5, "cleanliness"],
    ["clean_frequency", "similarity", 5, "cleanliness"],
    ["clean_dishes", "similarity", 5, "cleanliness"],
    ["kitchen_after_cooking", "similarity", 5, "cleanliness"],
    ["share_basics", "similarity", 5, "cleanliness"],
    ["rules_cleaning_rota", "similarity", 5, "cleanliness"],
    ["schedule_bedtime", "similarity", 5, "schedules"],
    ["schedule_wakeup", "similarity", 5, "schedules"],
    ["noise_own", "behavior", 5, "noise", "noise_tolerance"],
    ["noise_tolerance", "tolerance", 5, "noise", "noise_own"],
    ["rules_quiet_hours", "similarity", 5, "noise"],
    ["party_own", "behavior", 5, "parties", "party_tolerance"],
    ["party_tolerance", "tolerance", 5, "parties", "party_own"],
    ["guests_own", "behavior", 5, "guests", "guests_tolerance"],
    ["guests_tolerance", "tolerance", 5, "guests", "guests_own"],
    ["guests_overnight_own", "behavior", 5, "guests", "guests_overnight_tolerance"],
    ["guests_overnight_tolerance", "tolerance", 5, "guests", "guests_overnight_own"],
    ["smoke_own", "behavior", 3, "smoking", "smoke_tolerance"],
    ["smoke_tolerance", "tolerance", 3, "smoking", "smoke_own"],
    ["pets_own", "behavior", 3, "pets", "pets_tolerance"],
    ["pets_tolerance", "tolerance", 3, "pets", "pets_own"],
    ["study_at_home", "similarity", 5, "study"],
    ["remote_calls_common_own", "behavior", 5, "study", "remote_calls_common_tolerance"],
    ["remote_calls_common_tolerance", "tolerance", 5, "study", "remote_calls_common_own"],
    ["social_with_flatmates", "similarity", 5, "personality"],
    ["privacy_time_alone", "similarity", 5, "personality"],
    ["communication_style", "similarity", 5, "personality"],
    ["conflict_approach", "similarity", 5, "personality"],
    ["rules_explicit", "similarity", 5, "personality"],
  ];

  it("29 preguntas, exactamente las de la especificación y en su orden", () => {
    const actual = QUESTIONNAIRE_V1.questions.map((q) => {
      const row: [string, string, number, string, string?] = [
        q.id,
        q.comparison,
        q.scale.max,
        q.category,
      ];
      const pair = q.pairedWith ?? q.toleranceOf;
      if (pair) row.push(pair);
      return row;
    });
    expect(actual).toEqual(EXPECTED);
    expect(QUESTIONNAIRE_V1.questions.every((q) => q.scale.min === 1)).toBe(true);
    expect(new Set(QUESTIONNAIRE_V1.questions.map((q) => q.id)).size).toBe(29);
  });

  it("no incluye las preguntas eliminadas por D4", () => {
    const ids = QUESTIONNAIRE_V1.questions.map((q) => q.id);
    expect(ids).not.toContain("study_silence_need");
    expect(ids).not.toContain("remote_work_calls");
  });

  it("cada pareja es recíproca, de la misma categoría y con la misma escala y etiquetas", () => {
    const byId = new Map(QUESTIONNAIRE_V1.questions.map((q) => [q.id, q]));
    for (const q of QUESTIONNAIRE_V1.questions) {
      if (q.comparison === "behavior") {
        const t = byId.get(q.pairedWith!)!;
        expect(t.comparison).toBe("tolerance");
        expect(t.toleranceOf).toBe(q.id);
        expect(t.category).toBe(q.category);
        expect(t.scale).toEqual(q.scale);
        expect(Object.keys(t.labels)).toEqual(Object.keys(q.labels));
      }
      if (q.comparison === "similarity") {
        expect(q.pairedWith).toBeUndefined();
        expect(q.toleranceOf).toBeUndefined();
      }
    }
  });

  it("22 unidades que puntúan: Limpieza 6, Horarios 2, Ruido 2, Fiestas 1, Visitas 2, Fumar 1, Mascotas 1, Estudio 2, Personalidad 5", () => {
    const units: Record<string, number> = {};
    for (const q of QUESTIONNAIRE_V1.questions) {
      if (q.comparison === "tolerance") continue;
      units[q.category] = (units[q.category] ?? 0) + 1;
    }
    expect(units).toEqual({
      cleanliness: 6,
      schedules: 2,
      noise: 2,
      parties: 1,
      guests: 2,
      smoking: 1,
      pets: 1,
      study: 2,
      personality: 5,
    });
  });

  it("toda pregunta tiene texto y etiquetas dentro de su escala, sin datos de salud", () => {
    for (const q of QUESTIONNAIRE_V1.questions) {
      expect(q.text.length).toBeGreaterThan(10);
      expect(q.labels[q.scale.min]).toBeTruthy();
      expect(q.labels[q.scale.max]).toBeTruthy();
      for (const key of Object.keys(q.labels)) {
        const value = Number(key);
        expect(value).toBeGreaterThanOrEqual(q.scale.min);
        expect(value).toBeLessThanOrEqual(q.scale.max);
      }
      expect(q.text.toLowerCase()).not.toMatch(/alergi|salud|enfermedad/);
    }
  });

  it("versión vigente 1; versiones desconocidas no existen", () => {
    expect(CURRENT_QUESTIONNAIRE_VERSION).toBe(1);
    expect(getCurrentQuestionnaire()).toBe(QUESTIONNAIRE_V1);
    expect(getQuestionnaire(2)).toBeNull();
    expect(getQuestionnaire(0)).toBeNull();
  });
});

describe("pesos", () => {
  it("los de §9, en su orden, suman 100", () => {
    expect(CATEGORY_ORDER).toEqual([
      "location",
      "budget",
      "cleanliness",
      "schedules",
      "noise",
      "parties",
      "guests",
      "smoking",
      "pets",
      "study",
      "personality",
    ]);
    expect(CATEGORY_ORDER.map((c) => MATCH_WEIGHTS.byCategory[c])).toEqual([
      15, 15, 12, 10, 10, 8, 8, 7, 5, 5, 5,
    ]);
    expect(Object.values(MATCH_WEIGHTS.byCategory).reduce((s, w) => s + w, 0)).toBe(100);
    expect(MATCH_WEIGHTS).toMatchObject({
      version: 1,
      budgetGapRef: 150,
      strengthMin: 0.8,
      differenceMax: 0.5,
    });
  });
});

describe("igualdad y similitud", () => {
  it("respuestas idénticas y vivienda compatible → 100", () => {
    const housing = { neighborhoodIds: [N1, N2], budgetMin: 400, budgetMax: 600 };
    const result = score(person({}, housing), person({}, housing));
    expect(result.overallScore).toBe(100);
    expect(Object.values(result.categoryScores).every((v) => v === 1)).toBe(true);
    expect(Object.keys(result.categoryScores)).toEqual([...CATEGORY_ORDER]);
  });

  it("respuestas idénticas sin barrios ni presupuesto → 100, sin esas dos categorías", () => {
    const result = score(person(), person());
    expect(result.overallScore).toBe(100);
    expect(result.categoryScores.location).toBeUndefined();
    expect(result.categoryScores.budget).toBeUndefined();
  });

  it("similitud 1–5: extremos opuestos 0; un escalón 0,75 (media de la categoría)", () => {
    // Horarios: acostarse 1 vs 5 (0) y levantarse igual (1) → 0,5.
    expect(
      score(person({ schedule_bedtime: 1 }), person({ schedule_bedtime: 5 }))
        .categoryScores.schedules
    ).toBe(0.5);
    // Un escalón en las dos: 0,75 y 0,75.
    expect(
      score(
        person({ schedule_bedtime: 2, schedule_wakeup: 2 }),
        person({ schedule_bedtime: 3, schedule_wakeup: 3 })
      ).categoryScores.schedules
    ).toBe(0.75);
  });
});

describe("conducta–tolerancia: min(d(A→B), d(B→A)) (D1)", () => {
  // Tabla de la especificación: el sentido inverso se cumple (B no hace nada
  // que A no tolere), así que con la media saldría el doble de lo que sale.
  it.each<[string, Record<string, unknown>, Record<string, unknown>, Category, number]>([
    [
      "fumar: A fuma dentro (3), B no lo acepta (1) → 0 (con la media sería 0,5)",
      { smoke_own: 3, smoke_tolerance: 3 },
      { smoke_own: 1, smoke_tolerance: 1 },
      "smoking",
      0,
    ],
    [
      "mascotas: A trae gato o perro (3), B solo pequeñas (2) → 0,5",
      { pets_own: 3, pets_tolerance: 3 },
      { pets_own: 1, pets_tolerance: 2 },
      "pets",
      0.5,
    ],
    [
      "fiestas: A cada semana (5), B alguna vez al año (2) → 0,25",
      { party_own: 5, party_tolerance: 5 },
      { party_own: 1, party_tolerance: 2 },
      "parties",
      0.25,
    ],
    [
      "visitas: A trae a menudo (4), B tolera 3 → pareja 0,75, Visitas 0,875",
      { guests_own: 4, guests_tolerance: 5 },
      { guests_own: 1, guests_tolerance: 3 },
      "guests",
      0.875,
    ],
    [
      "visitas nocturnas: A casi a diario (5), B nunca (1) → pareja 0, Visitas 0,5",
      { guests_overnight_own: 5, guests_overnight_tolerance: 5 },
      { guests_overnight_own: 1, guests_overnight_tolerance: 1 },
      "guests",
      0.5,
    ],
    [
      "ruido: A bastante (4), B tolera poco (2) → pareja 0,5, Ruido 0,75",
      { noise_own: 4, noise_tolerance: 4 },
      { noise_own: 2, noise_tolerance: 2 },
      "noise",
      0.75,
    ],
    [
      "estudio: A llamadas a diario en zonas comunes (5), B nunca (1) → pareja 0, Estudio 0,5",
      { remote_calls_common_own: 5, remote_calls_common_tolerance: 5 },
      { remote_calls_common_own: 1, remote_calls_common_tolerance: 1 },
      "study",
      0.5,
    ],
  ])("%s", (_label, a, b, category, expected) => {
    expect(score(person(a), person(b)).categoryScores[category]).toBe(expected);
    expect(score(person(b), person(a)).categoryScores[category]).toBe(expected);
  });

  it("conflicto en los dos sentidos → 0; compatibilidad total → 1", () => {
    expect(
      score(
        person({ smoke_own: 3, smoke_tolerance: 1 }),
        person({ smoke_own: 3, smoke_tolerance: 1 })
      ).categoryScores.smoking
    ).toBe(0);
    expect(
      score(
        person({ smoke_own: 2, smoke_tolerance: 3 }),
        person({ smoke_own: 1, smoke_tolerance: 2 })
      ).categoryScores.smoking
    ).toBe(1);
  });

  it("una conducta que no supera la tolerancia del otro no penaliza", () => {
    // A → B: 1 ≤ 1 → 1; B → A: 3 ≤ 5 → 1. Que B tolere poco no importa si A no organiza nada.
    expect(
      score(
        person({ party_own: 1, party_tolerance: 5 }),
        person({ party_own: 3, party_tolerance: 1 })
      ).categoryScores.parties
    ).toBe(1);
  });
});

describe("presupuesto (BUDGET_GAP_REF = 150)", () => {
  const A = { budgetMin: 300, budgetMax: 400 };
  it.each<
    [string, { budgetMin: number | null; budgetMax: number | null }, number, number]
  >([
    ["solapados → hueco 0 → 1", { budgetMin: 400, budgetMax: 500 }, 0, 1],
    ["hueco 75 → 0,5", { budgetMin: 475, budgetMax: 600 }, 75, 0.5],
    ["hueco 150 exactos → 0", { budgetMin: 550, budgetMax: 700 }, 150, 0],
    [
      "hueco 151 → 0 (el filtro duro lo excluye antes)",
      { budgetMin: 551, budgetMax: 700 },
      151,
      0,
    ],
  ])("%s", (_label, b, gap, expected) => {
    expect(budgetGap(A, b)).toBe(gap);
    expect(
      score(person({}, { ...NO_HOUSING, ...A }), person({}, { ...NO_HOUSING, ...b }))
        .categoryScores.budget
    ).toBe(expected);
  });

  it("extremos abiertos: «hasta 500» y «desde 530» → hueco 30 → 0,8", () => {
    const a = { budgetMin: null, budgetMax: 500 };
    const b = { budgetMin: 530, budgetMax: null };
    expect(budgetGap(a, b)).toBe(30);
    expect(score(person({}, a), person({}, b)).categoryScores.budget).toBe(0.8);
  });

  it("«hasta» con «hasta», o «desde» con «desde», siempre se solapan", () => {
    expect(
      budgetGap({ budgetMin: null, budgetMax: 300 }, { budgetMin: null, budgetMax: 1000 })
    ).toBe(0);
    expect(
      budgetGap({ budgetMin: 300, budgetMax: null }, { budgetMin: 1000, budgetMax: null })
    ).toBe(0);
  });

  it("sin presupuesto en uno o en los dos → categoría ausente", () => {
    expect(
      score(person({}, { budgetMin: 300, budgetMax: 400 }), person()).categoryScores
        .budget
    ).toBeUndefined();
    expect(score(person(), person()).categoryScores.budget).toBeUndefined();
  });
});

describe("barrios: coeficiente de solapamiento", () => {
  const loc = (a: string[], b: string[]) =>
    score(person({}, { neighborhoodIds: a }), person({}, { neighborhoodIds: b }))
      .categoryScores.location;
  it("{1,2} y {2,3} → 0,5", () => expect(loc([N1, N2], [N2, N3])).toBe(0.5));
  it("{1} y {2} → 0 (presente sin coincidencia)", () => expect(loc([N1], [N2])).toBe(0));
  it("{1,2,3} y {1,2,3} → 1", () => expect(loc([N1, N2, N3], [N1, N2, N3])).toBe(1));
  it("{1} y {1,2,3,4} → 1 (no penaliza a quien marca más barrios)", () =>
    expect(loc([N1], [N1, N2, N3, N4])).toBe(1));
  it("duplicados y mayúsculas no cuentan dos veces", () =>
    expect(loc([N1, N1.toUpperCase()], [N1, N2])).toBe(1));
  it("lista vacía en uno o en los dos → ausente", () => {
    expect(loc([], [N1])).toBeUndefined();
    expect(loc([], [])).toBeUndefined();
  });
});

describe("renormalización y total", () => {
  it("con todas las categorías: Ubicación 0 y el resto 1 → 85", () => {
    const r = score(
      person({}, { neighborhoodIds: [N1], budgetMin: 400, budgetMax: 500 }),
      person({}, { neighborhoodIds: [N2], budgetMin: 400, budgetMax: 500 })
    );
    expect(r.categoryScores.location).toBe(0);
    expect(r.overallScore).toBe(85);
  });

  it("sin Ubicación ni Presupuesto, Fumar 0 y el resto 1 → round(100·63/70) = 90", () => {
    const r = score(
      person({ smoke_own: 3, smoke_tolerance: 3 }),
      person({ smoke_own: 1, smoke_tolerance: 1 })
    );
    expect(r.overallScore).toBe(90);
  });

  it("lo mismo con Ubicación y Presupuesto a 1 → 93 (denominador 100)", () => {
    const housing = { neighborhoodIds: [N1], budgetMin: 400, budgetMax: 500 };
    const r = score(
      person({ smoke_own: 3, smoke_tolerance: 3 }, housing),
      person({ smoke_own: 1, smoke_tolerance: 1 }, housing)
    );
    expect(r.overallScore).toBe(93);
  });

  it("solo falta el presupuesto → denominador 85", () => {
    const r = score(
      person({ smoke_own: 3, smoke_tolerance: 3 }, { neighborhoodIds: [N1] }),
      person({ smoke_own: 1, smoke_tolerance: 1 }, { neighborhoodIds: [N1] })
    );
    // 100 · (85 − 7) / 85 = 91,76… → 92
    expect(r.overallScore).toBe(92);
  });

  it("el total es un entero entre 0 y 100; en el peor caso, 0", () => {
    const worst = score(
      person(
        Object.fromEntries(
          QUESTIONNAIRE_V1.questions.map((q) => [
            q.id,
            q.comparison === "tolerance" ? q.scale.min : q.scale.max,
          ])
        ),
        { neighborhoodIds: [N1], budgetMin: 0, budgetMax: 100 }
      ),
      person(
        Object.fromEntries(
          QUESTIONNAIRE_V1.questions.map((q) => [
            q.id,
            q.comparison === "similarity" ? q.scale.min : q.scale.max,
          ])
        ),
        { neighborhoodIds: [N2], budgetMin: 300, budgetMax: 400 }
      )
    );
    expect(worst.overallScore).toBe(0);
    expect(Number.isInteger(worst.overallScore)).toBe(true);
  });
});

describe("redondeo", () => {
  it("r6: 6 decimales, mitad hacia arriba", () => {
    expect(r6(0.1234565)).toBe(0.123457);
    expect(r6(0.1234564)).toBe(0.123456);
    expect(r6(2 / 3)).toBe(0.666667);
    expect(r6(0.8)).toBe(0.8);
    expect(r6(0)).toBe(0);
    expect(r6(1)).toBe(1);
  });

  it("roundHalfUp: x,5 sube; x,4999 baja", () => {
    expect(roundHalfUp(84.5)).toBe(85);
    expect(roundHalfUp(84.4999)).toBe(84);
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it("las categorías se guardan redondeadas a 6 decimales", () => {
    // Limpieza con un escalón en 1 de 6 preguntas: (5 + 0,75) / 6 = 0,958333…
    const r = score(person({ clean_dishes: 2 }), person({ clean_dishes: 1 }));
    expect(r.categoryScores.cleanliness).toBe(0.958333);
  });
});

describe("explicaciones", () => {
  const kinds = (
    r: { reasons: Array<{ kind: string; category: Category }> },
    kind: string
  ) => r.reasons.filter((x) => x.kind === kind).map((x) => x.category);

  it("como mucho 3 fortalezas, por peso y luego en el orden fijo", () => {
    const housing = { neighborhoodIds: [N1], budgetMin: 400, budgetMax: 500 };
    const r = score(person({}, housing), person({}, housing));
    expect(kinds(r, "strength")).toEqual(["location", "budget", "cleanliness"]);
    expect(kinds(r, "difference")).toEqual([]);
  });

  it("a igual peso, el orden fijo (Fiestas antes que Visitas, 8 y 8)", () => {
    const r = score(person(), person());
    expect(kinds(r, "strength")).toEqual(["cleanliness", "schedules", "noise"]);
  });

  it("como mucho 3 diferencias, por peso y luego en el orden fijo", () => {
    const a = {
      party_own: 5,
      party_tolerance: 5,
      guests_overnight_own: 5,
      guests_overnight_tolerance: 5,
      smoke_own: 3,
      smoke_tolerance: 3,
      pets_own: 3,
      pets_tolerance: 3,
    };
    const b = {
      party_own: 1,
      party_tolerance: 1,
      guests_overnight_own: 1,
      guests_overnight_tolerance: 1,
      smoke_own: 1,
      smoke_tolerance: 1,
      pets_own: 1,
      pets_tolerance: 1,
    };
    const r = score(person(a), person(b));
    // Fiestas 0, Visitas 0,5, Fumar 0, Mascotas 0: cuatro diferencias, salen 3.
    expect(kinds(r, "difference")).toEqual(["parties", "guests", "smoking"]);
    expect(
      r.reasons.filter((x) => x.kind === "difference").every((x) => x.direction === null)
    ).toBe(true);
  });

  it("umbral 0,80 inclusivo: Ubicación 4/5 = 0,8 → fortaleza; Personalidad 0,8 queda fuera por el tope de 3", () => {
    const N5 = "55555555-5555-4555-8555-555555555555";
    const N6 = "66666666-6666-4666-8666-666666666666";
    const r = score(
      person({ conflict_approach: 5 }, { neighborhoodIds: [N1, N2, N3, N4, N5] }),
      person({ conflict_approach: 1 }, { neighborhoodIds: [N1, N2, N3, N4, N6] })
    );
    expect(r.categoryScores.location).toBe(0.8);
    expect(r.categoryScores.personality).toBe(0.8);
    expect(kinds(r, "strength")).toEqual(["location", "cleanliness", "schedules"]);
  });

  it("una categoría justo por debajo de 0,80 no es fortaleza", () => {
    const N5 = "55555555-5555-4555-8555-555555555555";
    const r = score(
      person({}, { neighborhoodIds: [N1, N2, N3, N4, N5] }),
      person(
        {},
        {
          neighborhoodIds: [
            N1,
            N2,
            N3,
            "77777777-7777-4777-8777-777777777777",
            "88888888-8888-4888-8888-888888888888",
          ],
        }
      )
    );
    expect(r.categoryScores.location).toBe(0.6);
    expect(kinds(r, "strength")).not.toContain("location");
  });

  it("umbral 0,50 inclusivo: Mascotas 0,5 → diferencia; Fiestas 0,75 → nada", () => {
    const pets = score(
      person({ pets_own: 3, pets_tolerance: 3 }),
      person({ pets_own: 1, pets_tolerance: 2 })
    );
    expect(pets.reasons).toContainEqual({
      kind: "difference",
      category: "pets",
      direction: null,
    });
    const parties = score(
      person({ party_own: 3, party_tolerance: 3 }),
      person({ party_own: 1, party_tolerance: 2 })
    );
    expect(parties.categoryScores.parties).toBe(0.75);
    expect(parties.reasons.some((x) => x.category === "parties")).toBe(false);
  });

  it("las razones solo llevan tipo, categoría y dirección (sin cifras ni scores)", () => {
    const r = score(person({ smoke_own: 3, smoke_tolerance: 3 }), person());
    for (const reason of r.reasons) {
      expect(Object.keys(reason).sort()).toEqual(["category", "direction", "kind"]);
    }
  });
});

describe("dirección: solo Horarios y Ruido, solo si los dos componentes coinciden", () => {
  const diff = (
    r: { reasons: Array<{ kind: string; category: Category; direction: unknown }> },
    c: Category
  ) => r.reasons.find((x) => x.kind === "difference" && x.category === c);

  it("Horarios: A se acuesta y se levanta más tarde → a_more; al revés → b_more", () => {
    const late = { schedule_bedtime: 5, schedule_wakeup: 5 };
    const early = { schedule_bedtime: 1, schedule_wakeup: 1 };
    expect(diff(score(person(late), person(early)), "schedules")?.direction).toBe(
      "a_more"
    );
    expect(diff(score(person(early), person(late)), "schedules")?.direction).toBe(
      "b_more"
    );
  });

  it("Horarios: un componente a 0 y el otro positivo → a_more", () => {
    expect(
      diff(
        score(
          person({ schedule_bedtime: 5, schedule_wakeup: 1 }),
          person({ schedule_bedtime: 1, schedule_wakeup: 1 })
        ),
        "schedules"
      )?.direction
    ).toBe("a_more");
  });

  it("Horarios: componentes en sentidos opuestos → null (frase neutra)", () => {
    const r = score(
      person({ schedule_bedtime: 5, schedule_wakeup: 1 }),
      person({ schedule_bedtime: 1, schedule_wakeup: 5 })
    );
    expect(diff(r, "schedules")?.direction).toBeNull();
  });

  it("Horarios: sentidos opuestos aunque la suma no sea 0 → null (A se acuesta más tarde pero se levanta antes)", () => {
    const r = score(
      person({ schedule_bedtime: 5, schedule_wakeup: 1 }),
      person({ schedule_bedtime: 1, schedule_wakeup: 2 })
    );
    expect(r.categoryScores.schedules).toBe(0.375);
    expect(diff(r, "schedules")?.direction).toBeNull();
  });

  it("Ruido: A tolera menos y quiere más horas de silencio → a_more", () => {
    const r = score(
      person({ noise_tolerance: 1, rules_quiet_hours: 5 }),
      person({ noise_tolerance: 5, rules_quiet_hours: 1 })
    );
    expect(r.categoryScores.noise).toBe(0.5);
    expect(diff(r, "noise")?.direction).toBe("a_more");
  });

  it("Ruido: componentes contradictorios → null", () => {
    const r = score(
      person({ noise_tolerance: 1, rules_quiet_hours: 1 }),
      person({ noise_tolerance: 5, rules_quiet_hours: 5 })
    );
    expect(diff(r, "noise")?.direction).toBeNull();
  });

  it("noise_own no interviene en la dirección", () => {
    const r = score(
      person({ noise_own: 5, noise_tolerance: 5, rules_quiet_hours: 1 }),
      person({ noise_own: 1, noise_tolerance: 5, rules_quiet_hours: 5 })
    );
    // Δ tolerancia 0, Δ horas de silencio −4 → b_more (B prefiere tranquilidad).
    expect(diff(r, "noise")?.direction).toBe("b_more");
  });
});

/** Generador determinista (mulberry32) para las pruebas de propiedades. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPerson(next: () => number): CompatibilityInput {
  const answers: Record<string, number> = {};
  for (const q of QUESTIONNAIRE_V1.questions) {
    answers[q.id] = q.scale.min + Math.floor(next() * (q.scale.max - q.scale.min + 1));
  }
  const pool = [N1, N2, N3, N4];
  const neighborhoodIds = pool.filter(() => next() < 0.4);
  const hasMin = next() < 0.6;
  const hasMax = next() < 0.6;
  const min = Math.floor(next() * 600);
  const max = min + Math.floor(next() * 400);
  return {
    questionnaireVersion: 1,
    answers,
    housing: {
      neighborhoodIds,
      budgetMin: hasMin ? min : null,
      budgetMax: hasMax ? max : null,
    },
  };
}

describe("propiedades", () => {
  it("simetría: mismo total y mismas categorías; las direcciones se invierten (500 pares)", () => {
    const next = rng(20261007);
    const flip = (d: string | null) =>
      d === "a_more" ? "b_more" : d === "b_more" ? "a_more" : null;
    for (let i = 0; i < 500; i++) {
      const a = randomPerson(next);
      const b = randomPerson(next);
      const ab = score(a, b);
      const ba = score(b, a);
      expect(ba.overallScore).toBe(ab.overallScore);
      expect(ba.categoryScores).toEqual(ab.categoryScores);
      expect(ba.reasons.map((r) => [r.kind, r.category, r.direction])).toEqual(
        ab.reasons.map((r) => [r.kind, r.category, flip(r.direction)])
      );
      expect(ab.overallScore).toBeGreaterThanOrEqual(0);
      expect(ab.overallScore).toBeLessThanOrEqual(100);
      expect(Number.isInteger(ab.overallScore)).toBe(true);
    }
  });

  it("determinismo: mismas entradas → mismo resultado, aunque cambie el orden de las claves", () => {
    const next = rng(42);
    for (let i = 0; i < 100; i++) {
      const a = randomPerson(next);
      const b = randomPerson(next);
      const reversed: CompatibilityInput = {
        ...a,
        answers: Object.fromEntries(Object.entries(a.answers).reverse()),
        housing: {
          ...a.housing,
          neighborhoodIds: [...a.housing.neighborhoodIds].reverse(),
        },
      };
      expect(calculateCompatibility(a, b, MATCH_WEIGHTS)).toEqual(
        calculateCompatibility(a, b, MATCH_WEIGHTS)
      );
      expect(calculateCompatibility(reversed, b, MATCH_WEIGHTS)).toEqual(
        calculateCompatibility(a, b, MATCH_WEIGHTS)
      );
    }
  });

  it("consigo mismo: 100 si su conducta cabe en su propia tolerancia", () => {
    const next = rng(7);
    const byId = new Map(QUESTIONNAIRE_V1.questions.map((q) => [q.id, q]));
    for (let i = 0; i < 100; i++) {
      const a = randomPerson(next);
      const answers = { ...(a.answers as Record<string, number>) };
      for (const q of QUESTIONNAIRE_V1.questions) {
        if (q.comparison === "behavior") {
          const t = byId.get(q.pairedWith!)!;
          answers[t.id] = Math.max(answers[t.id], answers[q.id]);
        }
      }
      const consistent = { ...a, answers };
      expect(score(consistent, consistent).overallScore).toBe(100);
    }
  });

  it("consigo mismo, con una conducta por encima de su propia tolerancia, menos de 100", () => {
    const a = person({ smoke_own: 3, smoke_tolerance: 1 });
    expect(score(a, a).categoryScores.smoking).toBe(0);
    expect(score(a, a).overallScore).toBeLessThan(100);
  });
});

describe("entradas inválidas: not_comparable, nunca una excepción", () => {
  const reason = (a: unknown, b: unknown, weights: unknown = MATCH_WEIGHTS) => {
    const result = calculateCompatibility(
      a as CompatibilityInput,
      b as CompatibilityInput,
      weights as MatchWeights
    );
    return result.status === "not_comparable" ? result.reason : "ok";
  };

  it("versiones distintas o desconocidas → version_mismatch", () => {
    expect(reason(person(), person({}, {}, 2))).toBe("version_mismatch");
    expect(reason(person({}, {}, 2), person({}, {}, 2))).toBe("version_mismatch");
    expect(reason(person({}, {}, 1.5), person({}, {}, 1.5))).toBe("version_mismatch");
  });

  it("falta una respuesta → incomplete_answers", () => {
    const incomplete = person();
    delete (incomplete.answers as Record<string, unknown>).rules_explicit;
    expect(reason(incomplete, person())).toBe("incomplete_answers");
    expect(reason(person(), person({ smoke_own: null }))).toBe("incomplete_answers");
  });

  it.each([6, 0, 2.5, "3", true, -1, Number.NaN])(
    "respuesta %j → invalid_answer",
    (value) => {
      expect(reason(person({ clean_frequency: value }), person())).toBe("invalid_answer");
    }
  );

  it("4 en una escala 1–3 → invalid_answer", () => {
    expect(reason(person({ smoke_own: 4 }), person())).toBe("invalid_answer");
  });

  it("claves desconocidas se ignoran al puntuar", () => {
    expect(reason(person({ extra_key: 99 }), person())).toBe("ok");
    expect(score(person({ extra_key: 99 }), person()).overallScore).toBe(100);
  });

  it.each<[string, unknown]>([
    [
      "suman 99",
      { ...MATCH_WEIGHTS, byCategory: { ...MATCH_WEIGHTS.byCategory, pets: 4 } },
    ],
    [
      "falta una categoría",
      {
        ...MATCH_WEIGHTS,
        byCategory: Object.fromEntries(
          Object.entries(MATCH_WEIGHTS.byCategory).filter(([c]) => c !== "pets")
        ),
      },
    ],
    [
      "sobra una categoría",
      { ...MATCH_WEIGHTS, byCategory: { ...MATCH_WEIGHTS.byCategory, extra: 0 } },
    ],
    [
      "peso negativo",
      {
        ...MATCH_WEIGHTS,
        byCategory: { ...MATCH_WEIGHTS.byCategory, pets: -5, study: 15 },
      },
    ],
    ["budgetGapRef 0", { ...MATCH_WEIGHTS, budgetGapRef: 0 }],
    ["umbrales al revés", { ...MATCH_WEIGHTS, strengthMin: 0.4, differenceMax: 0.6 }],
    ["sin versión", { ...MATCH_WEIGHTS, version: 0 }],
    ["null", null],
  ])("pesos inválidos (%s) → invalid_weights", (_label, weights) => {
    expect(reason(person(), person(), weights)).toBe("invalid_weights");
  });

  it.each<[string, Partial<HousingInput> | unknown]>([
    ["barrio que no es un UUID", { neighborhoodIds: ["no-es-uuid"] }],
    ["presupuesto negativo", { budgetMin: -1 }],
    ["mínimo mayor que máximo", { budgetMin: 500, budgetMax: 400 }],
    ["presupuesto no entero", { budgetMax: 400.5 }],
  ])("vivienda inválida (%s) → invalid_housing", (_label, housing) => {
    expect(reason(person({}, housing as Partial<HousingInput>), person())).toBe(
      "invalid_housing"
    );
  });

  it("estructuras rotas no lanzan", () => {
    expect(() => reason(null, person())).not.toThrow();
    expect(reason(null, person())).toBe("invalid_answer");
    expect(reason({ ...person(), answers: null }, person())).toBe("invalid_answer");
    expect(reason({ ...person(), answers: [1, 2, 3] }, person())).toBe("invalid_answer");
    expect(reason({ ...person(), housing: undefined }, person())).toBe("invalid_housing");
    expect(reason({ ...person(), housing: { neighborhoodIds: "x" } }, person())).toBe(
      "invalid_housing"
    );
  });
});

describe("texto de las explicaciones", () => {
  const all: Array<Parameters<typeof renderReason>[0]> = [];
  for (const category of CATEGORY_ORDER) {
    all.push({ kind: "strength", category, direction: null });
    all.push({ kind: "difference", category, direction: null });
    all.push({ kind: "difference", category, direction: "a_more" });
    all.push({ kind: "difference", category, direction: "b_more" });
  }

  it("ningún texto lleva cifras", () => {
    for (const reason of all) {
      for (const viewer of ["a", "b"] as const) {
        expect(renderReason(reason, viewer, "Laura")).not.toMatch(/\d/);
      }
    }
  });

  it("Horarios y Ruido: la frase depende de quién mira", () => {
    const noise = { kind: "difference", category: "noise", direction: "a_more" } as const;
    expect(renderReason(noise, "a", "Laura")).toBe(
      "Tú prefieres más tranquilidad en casa."
    );
    expect(renderReason(noise, "b", "Laura")).toBe(
      "Laura prefiere más tranquilidad en casa."
    );
    const schedules = {
      kind: "difference",
      category: "schedules",
      direction: "b_more",
    } as const;
    expect(renderReason(schedules, "a", "Laura")).toBe(
      "Laura tiene un horario más tardío entre semana."
    );
    expect(renderReason(schedules, "b", "Laura")).toBe(
      "Tú tienes un horario más tardío entre semana."
    );
  });

  it("sin dirección, frase neutra; en las demás categorías la dirección se ignora", () => {
    expect(
      renderReason(
        { kind: "difference", category: "schedules", direction: null },
        "a",
        "Laura"
      )
    ).toBe("Tenéis horarios distintos entre semana; conviene hablarlo.");
    expect(
      renderReason(
        { kind: "difference", category: "noise", direction: null },
        "a",
        "Laura"
      )
    ).toBe("Tenéis expectativas distintas sobre el ruido en casa.");
    expect(
      renderReason(
        { kind: "difference", category: "smoking", direction: "a_more" },
        "a",
        "Laura"
      )
    ).toBe("Conviene que habléis de si se puede fumar en casa.");
  });

  it("Limpieza habla de limpieza y espacios comunes", () => {
    expect(
      renderReason(
        { kind: "strength", category: "cleanliness", direction: null },
        "a",
        "Laura"
      )
    ).toContain("limpieza y espacios comunes");
  });
});
