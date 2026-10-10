import { getQuestionnaire, isValidAnswer } from "@/lib/matching/questionnaire";
import type {
  Category,
  CompatibilityInput,
  CompatibilityReason,
  CompatibilityResult,
  HousingInput,
  MatchWeights,
  NotComparableReason,
  Question,
  Questionnaire,
  ReasonDirection,
} from "@/lib/matching/types";
import { CATEGORY_ORDER, MAX_REASONS_PER_KIND } from "@/lib/matching/weights";

/**
 * Motor de compatibilidad (Fase 3.2): función pura, determinista y simétrica.
 * Contrato exacto en la especificación cerrada de la Fase 3 (2026-10-07):
 *
 *   - similitud: 1 − |a − b| / (máx − mín);
 *   - conducta/tolerancia: d(X→Y) = 1 si conducta_X ≤ tolerancia_Y, si no
 *     1 − (conducta_X − tolerancia_Y) / (máx − mín); la pareja vale
 *     min(d(A→B), d(B→A)) (D1);
 *   - categoría del test: media de sus unidades en el orden de la definición;
 *   - Ubicación: |N_A ∩ N_B| / min(|N_A|, |N_B|) si los dos tienen barrios;
 *   - Presupuesto: 1 sin hueco, si no max(0, 1 − hueco / budgetGapRef);
 *   - Ubicación o Presupuesto sin dato en cualquiera de los dos → categoría
 *     ausente y se renormaliza (D3);
 *   - cada categoría se redondea a 6 decimales (r6) y los umbrales se comparan
 *     sobre ese valor; el total es round_half_up(r6(100·Σ peso·cat / Σ pesos)),
 *     recortado a 0–100.
 *
 * Nunca lanza: cualquier entrada inválida devuelve `not_comparable`.
 */

/** Redondeo a 6 decimales, mitad hacia arriba (los valores son siempre ≥ 0). */
export function r6(value: number): number {
  return Math.floor(value * 1_000_000 + 0.5) / 1_000_000;
}

/** Entero más cercano, mitad hacia arriba (valores ≥ 0). */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeIntOrNull(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

function validWeights(weights: MatchWeights): boolean {
  if (!isPlainObject(weights) || !isPlainObject(weights.byCategory)) return false;
  if (!Number.isInteger(weights.version) || weights.version < 1) return false;
  let total = 0;
  for (const category of CATEGORY_ORDER) {
    const weight = weights.byCategory[category];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0)
      return false;
    total += weight;
  }
  if (Object.keys(weights.byCategory).length !== CATEGORY_ORDER.length) return false;
  if (total !== 100) return false;
  const { budgetGapRef, strengthMin, differenceMax } = weights;
  return (
    typeof budgetGapRef === "number" &&
    Number.isFinite(budgetGapRef) &&
    budgetGapRef > 0 &&
    typeof strengthMin === "number" &&
    typeof differenceMax === "number" &&
    differenceMax >= 0 &&
    differenceMax < strengthMin &&
    strengthMin <= 1
  );
}

function validHousing(housing: unknown): housing is HousingInput {
  if (!isPlainObject(housing)) return false;
  const { neighborhoodIds, budgetMin, budgetMax } = housing;
  if (!Array.isArray(neighborhoodIds)) return false;
  if (!neighborhoodIds.every((id) => typeof id === "string" && UUID.test(id)))
    return false;
  if (!isNonNegativeIntOrNull(budgetMin) || !isNonNegativeIntOrNull(budgetMax))
    return false;
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) return false;
  return true;
}

/** Comprueba las respuestas de una persona; null si son válidas y completas. */
function answersProblem(
  questionnaire: Questionnaire,
  answers: unknown
): "incomplete_answers" | "invalid_answer" | null {
  if (!isPlainObject(answers)) return "invalid_answer";
  let missing = false;
  for (const question of questionnaire.questions) {
    const value = answers[question.id];
    if (value === undefined || value === null) {
      missing = true;
      continue;
    }
    if (!isValidAnswer(question, value)) return "invalid_answer";
  }
  return missing ? "incomplete_answers" : null;
}

function span(question: Question): number {
  return question.scale.max - question.scale.min;
}

function similarity(question: Question, a: number, b: number): number {
  return 1 - Math.abs(a - b) / span(question);
}

/** d(X→Y): cuánto cabe la conducta de X en la tolerancia de Y. */
function fits(question: Question, behavior: number, tolerance: number): number {
  return behavior <= tolerance ? 1 : 1 - (behavior - tolerance) / span(question);
}

/** Score de cada categoría del test (sin redondear), en el orden de la definición. */
function questionnaireCategoryScores(
  questionnaire: Questionnaire,
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Map<Category, number> {
  const byId = new Map(
    questionnaire.questions.map((question) => [question.id, question])
  );
  const units = new Map<Category, number[]>();
  for (const question of questionnaire.questions) {
    let unit: number | null = null;
    if (question.comparison === "similarity") {
      unit = similarity(question, a[question.id] as number, b[question.id] as number);
    } else if (question.comparison === "behavior") {
      const tolerance = byId.get(question.pairedWith ?? "");
      if (!tolerance) continue;
      const aToB = fits(question, a[question.id] as number, b[tolerance.id] as number);
      const bToA = fits(question, b[question.id] as number, a[tolerance.id] as number);
      unit = Math.min(aToB, bToA);
    }
    // `tolerance`: la cuenta su conducta, no es una unidad propia.
    if (unit === null) continue;
    const list = units.get(question.category) ?? [];
    list.push(unit);
    units.set(question.category, list);
  }
  const scores = new Map<Category, number>();
  for (const [category, list] of units) {
    let sum = 0;
    for (const unit of list) sum += unit;
    scores.set(category, sum / list.length);
  }
  return scores;
}

function locationScore(a: HousingInput, b: HousingInput): number | null {
  const setA = new Set(a.neighborhoodIds.map((id) => id.toLowerCase()));
  const setB = new Set(b.neighborhoodIds.map((id) => id.toLowerCase()));
  if (setA.size === 0 || setB.size === 0) return null;
  let common = 0;
  for (const id of setA) if (setB.has(id)) common += 1;
  return common / Math.min(setA.size, setB.size);
}

/** Presupuesto presente si tiene al menos un extremo. */
function hasBudget(housing: HousingInput): boolean {
  return housing.budgetMin !== null || housing.budgetMax !== null;
}

/**
 * Hueco entre dos rangos de presupuesto, con extremos abiertos: sin mínimo
 * se toma 0 y sin máximo, sin límite. 0 si se solapan. Lo comparte el filtro
 * duro (lib/matching/filters.ts).
 */
export function budgetGap(
  a: { budgetMin: number | null; budgetMax: number | null },
  b: { budgetMin: number | null; budgetMax: number | null }
): number {
  const low = Math.max(a.budgetMin ?? 0, b.budgetMin ?? 0);
  const high = Math.min(a.budgetMax ?? Infinity, b.budgetMax ?? Infinity);
  return Math.max(0, low - high);
}

function budgetScore(a: HousingInput, b: HousingInput, gapRef: number): number | null {
  if (!hasBudget(a) || !hasBudget(b)) return null;
  const gap = budgetGap(a, b);
  return gap === 0 ? 1 : Math.max(0, 1 - gap / gapRef);
}

function sign(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/**
 * Dirección con dos componentes: `a_more` si ninguno es negativo y alguno es
 * positivo; `b_more` al revés; si se contradicen o son 0, `null`.
 */
function concordant(first: number, second: number): ReasonDirection {
  const s1 = sign(first);
  const s2 = sign(second);
  if (s1 >= 0 && s2 >= 0 && (s1 > 0 || s2 > 0)) return "a_more";
  if (s1 <= 0 && s2 <= 0 && (s1 < 0 || s2 < 0)) return "b_more";
  return null;
}

/** Ids de las preguntas que dan la dirección de las diferencias de Horarios y Ruido. */
export type DirectionQuestionIds = {
  bedtime: string;
  wakeup: string;
  noiseTolerance: string;
  quietHours: string;
};

/**
 * Las preguntas de la dirección, sacadas de la definición del cuestionario que
 * se compara (nunca de un id fijo que pueda no existir en esa versión):
 *   - Horarios: `schedule_bedtime` y `schedule_wakeup`, de similitud;
 *   - Ruido: la tolerancia de la única pareja de Ruido (`noise_tolerance` en
 *     la v1, `noise_tolerance_v2` en la v2), recíproca con su conducta, y
 *     `rules_quiet_hours`, de similitud.
 * Null si falta alguna o no tiene esa forma: `calculateCompatibility` devuelve
 * entonces `invalid_questionnaire`, nunca una dirección calculada con un hueco.
 */
export function directionQuestionIds(
  questionnaire: Questionnaire
): DirectionQuestionIds | null {
  const byId = new Map(
    questionnaire.questions.map((question) => [question.id, question])
  );
  const isSimilarityIn = (id: string, category: Category) => {
    const question = byId.get(id);
    return question?.comparison === "similarity" && question.category === category;
  };
  if (
    !isSimilarityIn("schedule_bedtime", "schedules") ||
    !isSimilarityIn("schedule_wakeup", "schedules") ||
    !isSimilarityIn("rules_quiet_hours", "noise")
  ) {
    return null;
  }
  const tolerances = questionnaire.questions.filter(
    (question) => question.category === "noise" && question.comparison === "tolerance"
  );
  if (tolerances.length !== 1) return null;
  const [tolerance] = tolerances;
  const behavior = byId.get(tolerance.toleranceOf ?? "");
  if (
    behavior?.comparison !== "behavior" ||
    behavior.category !== "noise" ||
    behavior.pairedWith !== tolerance.id
  ) {
    return null;
  }
  return {
    bedtime: "schedule_bedtime",
    wakeup: "schedule_wakeup",
    noiseTolerance: tolerance.id,
    quietHours: "rules_quiet_hours",
  };
}

/**
 * Solo para diferencias de Horarios y Ruido:
 *   - Horarios: Δ acostarse y Δ levantarse (A − B); `a_more` = A tiene un
 *     horario más tardío.
 *   - Ruido: Δ tolerancia (B − A) y Δ horas de silencio (A − B); `a_more` =
 *     A prefiere más tranquilidad. La conducta de ruido no interviene.
 * Las respuestas ya están validadas contra el cuestionario del que salen `ids`.
 */
function direction(
  category: Category,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ids: DirectionQuestionIds
): ReasonDirection {
  const n = (answers: Record<string, unknown>, id: string) => answers[id] as number;
  if (category === "schedules") {
    return concordant(
      n(a, ids.bedtime) - n(b, ids.bedtime),
      n(a, ids.wakeup) - n(b, ids.wakeup)
    );
  }
  if (category === "noise") {
    return concordant(
      n(b, ids.noiseTolerance) - n(a, ids.noiseTolerance),
      n(a, ids.quietHours) - n(b, ids.quietHours)
    );
  }
  return null;
}

function notComparable(reason: NotComparableReason): CompatibilityResult {
  return { status: "not_comparable", reason };
}

export function calculateCompatibility(
  a: CompatibilityInput,
  b: CompatibilityInput,
  weights: MatchWeights
): CompatibilityResult {
  if (!validWeights(weights)) return notComparable("invalid_weights");
  if (!isPlainObject(a) || !isPlainObject(b)) return notComparable("invalid_answer");
  if (
    !Number.isInteger(a.questionnaireVersion) ||
    a.questionnaireVersion !== b.questionnaireVersion
  ) {
    return notComparable("version_mismatch");
  }
  const questionnaire = getQuestionnaire(a.questionnaireVersion);
  if (!questionnaire) return notComparable("version_mismatch");
  const directionIds = directionQuestionIds(questionnaire);
  if (!directionIds) return notComparable("invalid_questionnaire");
  if (!validHousing(a.housing) || !validHousing(b.housing)) {
    return notComparable("invalid_housing");
  }
  const problemA = answersProblem(questionnaire, a.answers);
  const problemB = answersProblem(questionnaire, b.answers);
  if (problemA === "invalid_answer" || problemB === "invalid_answer") {
    return notComparable("invalid_answer");
  }
  if (problemA || problemB) return notComparable("incomplete_answers");

  const answersA = a.answers as Record<string, unknown>;
  const answersB = b.answers as Record<string, unknown>;
  const raw = questionnaireCategoryScores(questionnaire, answersA, answersB);
  const location = locationScore(a.housing, b.housing);
  if (location !== null) raw.set("location", location);
  const budget = budgetScore(a.housing, b.housing, weights.budgetGapRef);
  if (budget !== null) raw.set("budget", budget);

  const categoryScores: Partial<Record<Category, number>> = {};
  let weighted = 0;
  let totalWeight = 0;
  for (const category of CATEGORY_ORDER) {
    const value = raw.get(category);
    if (value === undefined) continue;
    const rounded = r6(value);
    categoryScores[category] = rounded;
    weighted += weights.byCategory[category] * rounded;
    totalWeight += weights.byCategory[category];
  }
  const overall = totalWeight === 0 ? 0 : roundHalfUp(r6((100 * weighted) / totalWeight));
  const overallScore = Math.min(100, Math.max(0, overall));

  // Explicaciones: por peso descendente y, a igual peso, en el orden fijo.
  const ranked = CATEGORY_ORDER.filter(
    (category) => categoryScores[category] !== undefined
  )
    .map((category, index) => ({ category, index }))
    .sort(
      (x, y) =>
        weights.byCategory[y.category] - weights.byCategory[x.category] ||
        x.index - y.index
    )
    .map(({ category }) => category);
  const strengths: CompatibilityReason[] = ranked
    .filter((category) => (categoryScores[category] as number) >= weights.strengthMin)
    .slice(0, MAX_REASONS_PER_KIND)
    .map((category) => ({ kind: "strength", category, direction: null }));
  const differences: CompatibilityReason[] = ranked
    .filter((category) => (categoryScores[category] as number) <= weights.differenceMax)
    .slice(0, MAX_REASONS_PER_KIND)
    .map((category) => ({
      kind: "difference",
      category,
      direction: direction(category, answersA, answersB, directionIds),
    }));

  return {
    status: "ok",
    overallScore,
    categoryScores,
    reasons: [...strengths, ...differences],
    weightsVersion: weights.version,
    questionnaireVersion: questionnaire.version,
  };
}
