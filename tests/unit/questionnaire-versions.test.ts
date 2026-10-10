import { describe, expect, it } from "vitest";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  QUESTIONNAIRE_V2,
  getQuestionnaire,
} from "@/lib/matching/questionnaire";
import { directionQuestionIds } from "@/lib/matching/score";
import type { Question, Questionnaire } from "@/lib/matching/types";

// Fase 3 (S1–S4) — versiones del cuestionario. La v1 queda como histórica y la
// v2 es la vigente. Con la lectura estricta de D15a, la v2 sustituye ocho ids
// (las cuatro parejas de S1–S4) por ids nuevos con sufijo `_v2`. Un id que está
// en dos versiones significa lo mismo en las dos.

/** Los ocho ids de la v1 que la v2 sustituye, en el orden del cuestionario. */
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
const NEW_V2_IDS = [
  "noise_own_v2",
  "noise_tolerance_v2",
  "party_own_v2",
  "party_tolerance_v2",
  "guests_overnight_own_v2",
  "guests_overnight_tolerance_v2",
  "pets_own_v2",
  "pets_tolerance_v2",
];

const ids = (questionnaire: Questionnaire) => questionnaire.questions.map((q) => q.id);
const byId = (questionnaire: Questionnaire, id: string): Question => {
  const question = questionnaire.questions.find((q) => q.id === id);
  if (!question) throw new Error(`falta ${id} en la v${questionnaire.version}`);
  return question;
};

/** Todas las versiones registradas: de la 1 a la vigente, sin huecos. */
const REGISTERED: Questionnaire[] = Array.from(
  { length: CURRENT_QUESTIONNAIRE_VERSION },
  (_, index) => getQuestionnaire(index + 1) as Questionnaire
);

describe("registro de versiones", () => {
  it("de la 1 a la vigente (2), sin huecos, cada una con su número", () => {
    expect(CURRENT_QUESTIONNAIRE_VERSION).toBe(2);
    expect(REGISTERED.map((q) => q?.version)).toEqual([1, 2]);
    expect(REGISTERED).toEqual([QUESTIONNAIRE_V1, QUESTIONNAIRE_V2]);
  });

  it("cada versión registrada tiene las preguntas que dan la dirección (Horarios y Ruido)", () => {
    for (const questionnaire of REGISTERED) {
      expect(directionQuestionIds(questionnaire)).not.toBeNull();
    }
  });

  it("un id que está en dos versiones es la misma pregunta: enunciado, ayuda, escala, etiquetas, tipo, categoría y pareja", () => {
    for (const older of REGISTERED) {
      for (const newer of REGISTERED) {
        if (newer.version <= older.version) continue;
        const newerIds = new Set(ids(newer));
        for (const question of older.questions) {
          if (!newerIds.has(question.id)) continue;
          expect(byId(newer, question.id)).toStrictEqual(question);
        }
      }
    }
  });
});

describe("la v2 frente a la v1", () => {
  it("29 preguntas en las dos, con ids únicos", () => {
    for (const questionnaire of [QUESTIONNAIRE_V1, QUESTIONNAIRE_V2]) {
      expect(questionnaire.questions).toHaveLength(29);
      expect(new Set(ids(questionnaire)).size).toBe(29);
    }
  });

  it("sustituye exactamente ocho ids, en su misma posición, por su versión `_v2`", () => {
    const v1 = ids(QUESTIONNAIRE_V1);
    const v2 = ids(QUESTIONNAIRE_V2);
    expect(v1.filter((id) => !v2.includes(id))).toEqual(REPLACED_V1_IDS);
    expect(v2.filter((id) => !v1.includes(id))).toEqual(NEW_V2_IDS);
    for (const [index, id] of v1.entries()) {
      expect(v2[index]).toBe(REPLACED_V1_IDS.includes(id) ? `${id}_v2` : id);
    }
  });

  it("los ids nuevos no chocan con ningún id histórico y los sustituidos no vuelven", () => {
    const v1 = new Set(ids(QUESTIONNAIRE_V1));
    const v2 = new Set(ids(QUESTIONNAIRE_V2));
    for (const id of NEW_V2_IDS) {
      expect(v1.has(id)).toBe(false);
      expect(id).toMatch(/^[a-z][a-z_]*_v2$/);
    }
    for (const id of REPLACED_V1_IDS) expect(v2.has(id)).toBe(false);
  });

  it("las 21 preguntas comunes son las mismas (también el mismo objeto)", () => {
    const v2 = new Map(QUESTIONNAIRE_V2.questions.map((q) => [q.id, q]));
    const shared = QUESTIONNAIRE_V1.questions.filter((q) => v2.has(q.id));
    expect(shared).toHaveLength(21);
    for (const question of shared) expect(v2.get(question.id)).toBe(question);
  });

  it("misma estructura en cada posición: categoría, tipo, escala y valores de las etiquetas", () => {
    for (const [index, old] of QUESTIONNAIRE_V1.questions.entries()) {
      const next = QUESTIONNAIRE_V2.questions[index];
      expect(next.category).toBe(old.category);
      expect(next.comparison).toBe(old.comparison);
      expect(next.scale).toEqual(old.scale);
      expect(Object.keys(next.labels)).toEqual(Object.keys(old.labels));
    }
  });

  it("las cuatro parejas de la v2 son recíprocas y apuntan solo a ids `_v2`", () => {
    const pairs: Array<[string, string]> = [
      ["noise_own_v2", "noise_tolerance_v2"],
      ["party_own_v2", "party_tolerance_v2"],
      ["guests_overnight_own_v2", "guests_overnight_tolerance_v2"],
      ["pets_own_v2", "pets_tolerance_v2"],
    ];
    for (const [own, tolerance] of pairs) {
      const behavior = byId(QUESTIONNAIRE_V2, own);
      const accepted = byId(QUESTIONNAIRE_V2, tolerance);
      expect(behavior.comparison).toBe("behavior");
      expect(behavior.pairedWith).toBe(tolerance);
      expect(behavior.toleranceOf).toBeUndefined();
      expect(accepted.comparison).toBe("tolerance");
      expect(accepted.toleranceOf).toBe(own);
      expect(accepted.pairedWith).toBeUndefined();
      expect(accepted.category).toBe(behavior.category);
      expect(accepted.scale).toEqual(behavior.scale);
    }
    // Ninguna pregunta de la v2 apunta a un id sustituido.
    for (const question of QUESTIONNAIRE_V2.questions) {
      for (const pair of [question.pairedWith, question.toleranceOf]) {
        if (pair !== undefined) expect(REPLACED_V1_IDS).not.toContain(pair);
      }
    }
  });
});

describe("la v1 se conserva como histórico", () => {
  it.each<[string, string, Record<number, string>, string]>([
    [
      "noise_own",
      "¿Cuánto ruido sueles hacer en casa (música, llamadas, televisión…)?",
      { 1: "Muy poco", 5: "Bastante" },
      "noise_tolerance",
    ],
    [
      "noise_tolerance",
      "Cuando estás en casa, ¿cuánto ruido de tus compañeros te parece aceptable?",
      { 1: "Muy poco", 5: "Bastante" },
      "noise_own",
    ],
    [
      "party_own",
      "¿Cada cuánto te gustaría organizar reuniones o fiestas en casa?",
      {
        1: "Nunca",
        2: "Alguna vez al año",
        3: "Una vez al mes",
        4: "Cada dos semanas",
        5: "Cada semana o más",
      },
      "party_tolerance",
    ],
    [
      "party_tolerance",
      "¿Cada cuánto te parece bien que haya reuniones o fiestas en casa?",
      {
        1: "Nunca",
        2: "Alguna vez al año",
        3: "Una vez al mes",
        4: "Cada dos semanas",
        5: "Cada semana o más",
      },
      "party_own",
    ],
    [
      "guests_overnight_own",
      "¿Cada cuánto se quedaría alguien a dormir contigo?",
      {
        1: "Nunca",
        2: "Alguna vez al mes",
        3: "Una vez a la semana",
        4: "Varias veces por semana",
        5: "Casi a diario",
      },
      "guests_overnight_tolerance",
    ],
    [
      "guests_overnight_tolerance",
      "¿Cada cuánto te parece bien que se quede alguien a dormir con tus compañeros?",
      {
        1: "Nunca",
        2: "Alguna vez al mes",
        3: "Una vez a la semana",
        4: "Varias veces por semana",
        5: "Casi a diario",
      },
      "guests_overnight_own",
    ],
    [
      "pets_own",
      "¿Tienes o piensas traer una mascota?",
      { 1: "No", 2: "Pequeña (pez, roedor…)", 3: "Gato o perro" },
      "pets_tolerance",
    ],
    [
      "pets_tolerance",
      "¿Qué mascotas de tus compañeros aceptarías en el piso?",
      {
        1: "Ninguna",
        2: "Solo pequeñas (pez, roedor, pájaro…)",
        3: "También gatos o perros",
      },
      "pets_own",
    ],
  ])("%s: enunciado, etiquetas y pareja de la v1", (id, text, labels, pair) => {
    const question = byId(QUESTIONNAIRE_V1, id);
    expect(question.text).toBe(text);
    expect(question.labels).toEqual(labels);
    expect(question.pairedWith ?? question.toleranceOf).toBe(pair);
    expect(question.help).toBeUndefined();
  });
});

describe("S1–S4 en la v2", () => {
  it("S1: ruido con la misma escala y orientación; el extremo superior es «Mucho» en las dos preguntas", () => {
    const own = byId(QUESTIONNAIRE_V2, "noise_own_v2");
    const tolerance = byId(QUESTIONNAIRE_V2, "noise_tolerance_v2");
    expect(own.text).toBe(byId(QUESTIONNAIRE_V1, "noise_own").text);
    expect(tolerance.text).toBe(byId(QUESTIONNAIRE_V1, "noise_tolerance").text);
    for (const question of [own, tolerance]) {
      expect(question.scale).toEqual({ min: 1, max: 5 });
      expect(question.labels).toEqual({ 1: "Muy poco", 5: "Mucho" });
    }
  });

  it("S2: la conducta pregunta lo mismo; la tolerancia, por las fiestas que organiza un compañero", () => {
    const own = byId(QUESTIONNAIRE_V2, "party_own_v2");
    const tolerance = byId(QUESTIONNAIRE_V2, "party_tolerance_v2");
    expect(own.text).toBe(byId(QUESTIONNAIRE_V1, "party_own").text);
    expect(tolerance.text).toBe(
      "¿Cada cuánto te parece bien que un compañero organice reuniones o fiestas en casa?"
    );
    for (const question of [own, tolerance]) {
      expect(question.labels).toEqual(byId(QUESTIONNAIRE_V1, "party_own").labels);
    }
  });

  it("S3: quien se queda a dormir es alguien invitado por ti o por un compañero", () => {
    const own = byId(QUESTIONNAIRE_V2, "guests_overnight_own_v2");
    const tolerance = byId(QUESTIONNAIRE_V2, "guests_overnight_tolerance_v2");
    expect(own.text).toBe(
      "¿Cada cuánto se quedaría a dormir en casa alguien invitado por ti?"
    );
    expect(tolerance.text).toBe(
      "¿Cada cuánto te parece bien que alguien invitado por un compañero se quede a dormir en casa?"
    );
    for (const question of [own, tolerance]) {
      expect(question.labels).toEqual(
        byId(QUESTIONNAIRE_V1, "guests_overnight_own").labels
      );
    }
  });

  it("S4: las mascotas que habrá en el piso, con los mismos ejemplos de mascotas pequeñas en la pareja", () => {
    const own = byId(QUESTIONNAIRE_V2, "pets_own_v2");
    const tolerance = byId(QUESTIONNAIRE_V2, "pets_tolerance_v2");
    expect(own.text).toBe("¿Vas a tener alguna mascota en el piso?");
    expect(own.labels).toEqual({
      1: "No",
      2: "Sí, pequeña (pez, roedor, pájaro…)",
      3: "Sí, gato o perro",
    });
    expect(tolerance.text).toBe(byId(QUESTIONNAIRE_V1, "pets_tolerance").text);
    expect(tolerance.labels).toEqual(byId(QUESTIONNAIRE_V1, "pets_tolerance").labels);
    const examples = /\(pez, roedor, pájaro…\)/;
    expect(own.labels[2]).toMatch(examples);
    expect(tolerance.labels[2]).toMatch(examples);
  });

  it("ninguna de las ocho lleva ayuda (la ayuda S5 sigue solo en las visitas)", () => {
    for (const id of NEW_V2_IDS) expect(byId(QUESTIONNAIRE_V2, id).help).toBeUndefined();
    expect(byId(QUESTIONNAIRE_V2, "guests_own").help).toBeTruthy();
    expect(byId(QUESTIONNAIRE_V2, "guests_tolerance").help).toBeTruthy();
  });
});
