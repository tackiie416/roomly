import { budgetGap } from "@/lib/matching/score";
import { MATCH_WEIGHTS } from "@/lib/matching/weights";

/**
 * Filtros duros de candidatos (Fase 3.3): funciones puras que se aplican
 * ANTES del score. lib/services/matching.ts filtra además en la consulta SQL
 * (cuenta activa, onboarding completo, no admin, test completo de la versión
 * vigente, misma ciudad); `isEligibleCandidate` repite esas condiciones sobre
 * las filas leídas como defensa en profundidad.
 *
 * No filtran (especificación cerrada de la Fase 3): `seeking_status`, fumar
 * ni mascotas; estos dos solo puntúan. No hay índices nuevos: la consulta usa
 * `idx_housing_preferences_city`; fechas, presupuesto y compañeros se
 * evalúan aquí.
 */

/** Datos de vivienda de una persona que intervienen en los filtros duros. */
export type HardFilterProfile = {
  cityId: string | null;
  /** `AAAA-MM-DD` o null (abierto). */
  moveInDate: string | null;
  moveOutDate: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  roommatesMin: number | null;
  roommatesMax: number | null;
};

/**
 * Número de compañeros (D9 + D2): el rango efectivo es
 * `[max(1, min ?? 1), max ?? ∞]`. `max = 0` significa «sin compañeros»: esa
 * persona no es candidata de nadie (y no ve candidatos).
 */
export function acceptsRoommates(
  profile: Pick<HardFilterProfile, "roommatesMax">
): boolean {
  return profile.roommatesMax !== 0;
}

function roommatesOverlap(a: HardFilterProfile, b: HardFilterProfile): boolean {
  if (!acceptsRoommates(a) || !acceptsRoommates(b)) return false;
  const low = Math.max(
    Math.max(1, a.roommatesMin ?? 1),
    Math.max(1, b.roommatesMin ?? 1)
  );
  const high = Math.min(a.roommatesMax ?? Infinity, b.roommatesMax ?? Infinity);
  return low <= high;
}

/** Fechas: `[entrada ?? −∞, salida ?? +∞]`; pasa si los intervalos se solapan al menos un día. */
function datesOverlap(a: HardFilterProfile, b: HardFilterProfile): boolean {
  const starts = [a.moveInDate, b.moveInDate].filter((d): d is string => d !== null);
  const ends = [a.moveOutDate, b.moveOutDate].filter((d): d is string => d !== null);
  if (starts.length === 0 || ends.length === 0) return true;
  const latestStart = starts.reduce((x, y) => (x > y ? x : y));
  const earliestEnd = ends.reduce((x, y) => (x < y ? x : y));
  // Cadenas ISO `AAAA-MM-DD`: se comparan bien como texto.
  return latestStart <= earliestEnd;
}

/** Presupuesto: pasa si alguno no tiene (ningún extremo) o si el hueco ≤ `budgetGapRef`. */
function budgetCompatible(
  a: HardFilterProfile,
  b: HardFilterProfile,
  budgetGapRef: number
): boolean {
  const hasA = a.budgetMin !== null || a.budgetMax !== null;
  const hasB = b.budgetMin !== null || b.budgetMax !== null;
  if (!hasA || !hasB) return true;
  return budgetGap(a, b) <= budgetGapRef;
}

/** Filtros duros entre dos personas (simétricos). */
export function passesHardFilters(
  a: HardFilterProfile,
  b: HardFilterProfile,
  budgetGapRef: number = MATCH_WEIGHTS.budgetGapRef
): boolean {
  if (a.cityId === null || b.cityId === null || a.cityId !== b.cityId) return false;
  if (!datesOverlap(a, b)) return false;
  if (!budgetCompatible(a, b, budgetGapRef)) return false;
  return roommatesOverlap(a, b);
}

/** Lo que se sabe de un candidato antes de puntuarlo. */
export type CandidateEligibility = {
  id: string;
  role: string;
  deletedAt: string | null;
  onboardingCompletedAt: string | null;
  questionnaireVersion: number | null;
  questionnaireCompletedAt: string | null;
};

/**
 * Candidato elegible para quien mira: no es uno mismo, cuenta activa,
 * onboarding completo, no es admin (D10) y test completado en la versión
 * vigente.
 */
export function isEligibleCandidate(
  candidate: CandidateEligibility,
  viewerId: string,
  currentVersion: number
): boolean {
  return (
    candidate.id !== viewerId &&
    candidate.deletedAt === null &&
    candidate.onboardingCompletedAt !== null &&
    candidate.role !== "admin" &&
    candidate.questionnaireVersion === currentVersion &&
    candidate.questionnaireCompletedAt !== null
  );
}
