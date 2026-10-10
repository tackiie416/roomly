/**
 * Tipos del motor de compatibilidad (Fase 3.2). Sin E/S y sin `server-only`:
 * la definición del cuestionario también la usa el formulario de `/test`.
 *
 * Especificación cerrada de la Fase 3 (2026-10-07): el motor es una función
 * pura de TypeScript (regla 6 de CLAUDE.md), nunca SQL ni un LLM.
 */

/**
 * Las 11 categorías de §9 de ROOMLY_MASTER_SPEC.md. El orden de
 * `CATEGORY_ORDER` (lib/matching/weights.ts) es el orden fijo de cálculo y de
 * desempate.
 */
export type Category =
  | "location"
  | "budget"
  | "cleanliness"
  | "schedules"
  | "noise"
  | "parties"
  | "guests"
  | "smoking"
  | "pets"
  | "study"
  | "personality";

/** Categorías que salen del test; `location` y `budget` salen de las preferencias. */
export type QuestionCategory = Exclude<Category, "location" | "budget">;

/**
 * Cómo se compara una pregunta:
 *   - `similarity`: dos respuestas a la misma pregunta;
 *   - `behavior`: lo que hace cada uno; se compara con la `tolerance` del otro
 *     (`pairedWith`), en los dos sentidos, y la pareja vale el mínimo;
 *   - `tolerance`: el máximo que se acepta del otro, en la misma escala que su
 *     conducta (`toleranceOf`).
 */
export type Comparison = "similarity" | "behavior" | "tolerance";

export type Question = {
  /** Id estable: nunca cambia de significado, escala, tipo, categoría ni pareja (D15a). */
  id: string;
  text: string;
  category: QuestionCategory;
  comparison: Comparison;
  scale: { min: number; max: number };
  /** Etiquetas de los valores: solo extremos en las escalas 1–5 de valoración; todas en las de opciones. */
  labels: Readonly<Record<number, string>>;
  /** Ayuda opcional bajo el enunciado. Solo presentación: no se guarda ni puntúa. */
  help?: string;
  /** Solo en `behavior`: id de su tolerancia. */
  pairedWith?: string;
  /** Solo en `tolerance`: id de su conducta. */
  toleranceOf?: string;
};

export type Questionnaire = {
  version: number;
  /** Orden fijo: es el orden de presentación y el orden de cálculo. */
  questions: readonly Question[];
};

/** Respuestas: id de pregunta → valor entero de su escala. */
export type QuestionnaireAnswers = Record<string, number>;

/** Datos de vivienda que usa el score (Ubicación y Presupuesto). */
export type HousingInput = {
  neighborhoodIds: readonly string[];
  budgetMin: number | null;
  budgetMax: number | null;
};

/** Lo que el motor sabe de una persona. Sin identidad: ni id, ni nombre, ni fechas. */
export type CompatibilityInput = {
  questionnaireVersion: number;
  answers: Readonly<Record<string, unknown>>;
  housing: HousingInput;
};

export type MatchWeights = {
  version: number;
  /** Peso entero de cada una de las 11 categorías; suman 100. */
  byCategory: Readonly<Record<Category, number>>;
  /** Hueco de presupuesto (€/mes) a partir del cual la categoría vale 0 (D8). */
  budgetGapRef: number;
  /** Fortaleza si la categoría vale al menos esto. */
  strengthMin: number;
  /** Diferencia si la categoría vale como mucho esto. */
  differenceMax: number;
};

export type ReasonDirection = "a_more" | "b_more" | null;

/**
 * Una explicación, sin texto ni cifras: el texto lo genera
 * lib/matching/explanations.ts para quien mira. `direction` solo existe en
 * diferencias de `schedules` y `noise`.
 */
export type CompatibilityReason = {
  kind: "strength" | "difference";
  category: Category;
  direction: ReasonDirection;
};

export type NotComparableReason =
  | "version_mismatch"
  /** Al cuestionario le faltan las preguntas de la dirección (fallo del código, no de las respuestas). */
  | "invalid_questionnaire"
  | "incomplete_answers"
  | "invalid_answer"
  | "invalid_weights"
  | "invalid_housing";

export type CompatibilityResult =
  | {
      status: "ok";
      /** Entero 0–100. */
      overallScore: number;
      /**
       * Score de cada categoría presente (0–1, redondeado a 6 decimales).
       * SOLO INTERNO: nunca sale del servidor (no va en ningún DTO).
       */
      categoryScores: Partial<Record<Category, number>>;
      /** Como mucho 3 fortalezas y después como mucho 3 diferencias. */
      reasons: CompatibilityReason[];
      weightsVersion: number;
      questionnaireVersion: number;
    }
  | { status: "not_comparable"; reason: NotComparableReason };
