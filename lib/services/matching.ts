import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_QUESTIONNAIRE_VERSION } from "@/lib/matching/questionnaire";
import { questionnaireStatus } from "@/lib/matching/questionnaire-status";
import { calculateCompatibility } from "@/lib/matching/score";
import { renderReason } from "@/lib/matching/explanations";
import {
  acceptsRoommates,
  isEligibleCandidate,
  passesHardFilters,
  type HardFilterProfile,
} from "@/lib/matching/filters";
import { MATCH_WEIGHTS } from "@/lib/matching/weights";
import type { CompatibilityInput } from "@/lib/matching/types";
import {
  type DbClient,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";

/**
 * Candidatos de `/explorar` (Fase 3.4).
 *
 * Reparto de clientes (D17):
 *   - Los datos PROPIOS (perfil, preferencias, test) y los nombres de
 *     universidades y barrios (tablas de referencia públicas) se leen con el
 *     cliente del usuario, bajo RLS.
 *   - La lectura CRUZADA de candidatos usa `createAdminClient()`, porque la
 *     RLS solo deja leer la fila propia de `profiles`, `housing_preferences` y
 *     `compatibility_responses`. Es una sola consulta, con columnas explícitas
 *     y recursos embebidos (sin N+1), filtrada en SQL: otra persona, cuenta
 *     activa, onboarding completo, no admin (D10), test completado de la
 *     versión vigente y misma ciudad (usa `idx_housing_preferences_city`).
 *
 * Después, en Node: los mismos criterios otra vez (`isEligibleCandidate`, por
 * si la consulta cambiara), los filtros duros (`passesHardFilters`), el
 * score (`calculateCompatibility`) y la página. Las respuestas, la fecha de
 * nacimiento, los presupuestos exactos y `categoryScores` NUNCA salen de
 * aquí: la página solo recibe `CandidateDTO`, construido campo a campo.
 */

export const CANDIDATES_PAGE_SIZE = 20;
const MAX_NEIGHBORHOODS_SHOWN = 3;
const BUDGET_STEP = 50;

/** Lo único que sale hacia la página por cada candidato. */
export type CandidateDTO = {
  id: string;
  fullName: string;
  /** Años cumplidos (Europe/Madrid). */
  age: number;
  university: string | null;
  /** Hasta 3 nombres: primero los que coinciden con los de quien mira. */
  neighborhoods: string[];
  /** Número total de barrios preferidos del candidato. */
  neighborhoodsTotal: number;
  /** Rango en escalones de 50 €: mínimo hacia abajo, máximo hacia arriba. */
  budgetRange: { min: number | null; max: number | null } | null;
  score: number;
  strengths: string[];
  differences: string[];
};

export type CandidatePage = {
  candidates: CandidateDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** false si quien mira tiene `roommates_wanted_max = 0` (no acepta compañeros). */
  viewerAcceptsRoommates: boolean;
};

export type MatchingDeps = {
  adminClient: () => DbClient;
  /** Fecha de hoy `AAAA-MM-DD` en Europe/Madrid (inyectable en los tests). */
  today: () => string;
};

/** Hoy en Europe/Madrid como `AAAA-MM-DD`. */
export function todayInMadrid(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const DEFAULT_DEPS: MatchingDeps = {
  adminClient: () => createAdminClient(),
  today: () => todayInMadrid(),
};

const HOUSING_COLUMNS =
  "city_id, university_id, budget_min, budget_max, move_in_date, move_out_date, preferred_neighborhood_ids, roommates_wanted_min, roommates_wanted_max";
const RESPONSE_COLUMNS = "questionnaire_version, answers, completed_at";

/** Columnas exactas de la lectura cruzada (sin bio, email, avatar ni seeking_status). */
export const CANDIDATE_SELECT =
  `id, full_name, date_of_birth, role, deleted_at, onboarding_completed_at, ` +
  `housing_preferences!inner(${HOUSING_COLUMNS}), ` +
  `compatibility_responses!inner(${RESPONSE_COLUMNS})`;

type HousingRow = {
  city_id: string | null;
  university_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  move_in_date: string | null;
  move_out_date: string | null;
  preferred_neighborhood_ids: string[] | null;
  roommates_wanted_min: number | null;
  roommates_wanted_max: number | null;
};
type ResponseRow = {
  questionnaire_version: number;
  answers: unknown;
  completed_at: string | null;
};
type CandidateRow = {
  id: string;
  full_name: string;
  date_of_birth: string;
  role: string;
  deleted_at: string | null;
  onboarding_completed_at: string | null;
  housing_preferences: HousingRow | HousingRow[] | null;
  compatibility_responses: ResponseRow | ResponseRow[] | null;
};

/** PostgREST devuelve objeto (uno a uno) o lista según la relación: se aceptan los dos. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toFilterProfile(housing: HousingRow): HardFilterProfile {
  return {
    cityId: housing.city_id,
    moveInDate: housing.move_in_date,
    moveOutDate: housing.move_out_date,
    budgetMin: housing.budget_min,
    budgetMax: housing.budget_max,
    roommatesMin: housing.roommates_wanted_min,
    roommatesMax: housing.roommates_wanted_max,
  };
}

function toCompatibilityInput(
  housing: HousingRow,
  response: ResponseRow
): CompatibilityInput {
  return {
    questionnaireVersion: response.questionnaire_version,
    answers: (response.answers ?? {}) as Record<string, unknown>,
    housing: {
      neighborhoodIds: housing.preferred_neighborhood_ids ?? [],
      budgetMin: housing.budget_min,
      budgetMax: housing.budget_max,
    },
  };
}

/** Años cumplidos en `today` (`AAAA-MM-DD`) para una fecha de nacimiento `AAAA-MM-DD`. */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** Presupuesto en escalones de 50 €: mínimo hacia abajo y máximo hacia arriba. */
export function toBudgetRange(
  min: number | null,
  max: number | null
): CandidateDTO["budgetRange"] {
  if (min === null && max === null) return null;
  return {
    min: min === null ? null : Math.floor(min / BUDGET_STEP) * BUDGET_STEP,
    max: max === null ? null : Math.ceil(max / BUDGET_STEP) * BUDGET_STEP,
  };
}

/** Hasta 3 nombres: primero los compartidos con quien mira, y en cada grupo, por orden alfabético. */
export function pickNeighborhoods(
  candidateIds: readonly string[],
  viewerIds: readonly string[],
  names: ReadonlyMap<string, string>
): { shown: string[]; total: number } {
  const unique = [...new Set(candidateIds)];
  const viewer = new Set(viewerIds);
  const byName = (x: string, y: string) => x.localeCompare(y, "es");
  const named = (ids: string[]) =>
    ids
      .map((id) => names.get(id))
      .filter((name): name is string => !!name)
      .sort(byName);
  const shared = named(unique.filter((id) => viewer.has(id)));
  const others = named(unique.filter((id) => !viewer.has(id)));
  return {
    shown: [...shared, ...others].slice(0, MAX_NEIGHBORHOODS_SHOWN),
    total: unique.length,
  };
}

type Scored = {
  row: CandidateRow;
  housing: HousingRow;
  score: number;
  strengths: string[];
  differences: string[];
};

/**
 * Página `page` (desde 1) de candidatos de la sesión, por score descendente
 * y, a igual score, por id ascendente. Sin límite total.
 */
export async function getCandidates(
  supabase: DbClient,
  page: number,
  deps: MatchingDeps = DEFAULT_DEPS
): Promise<ServiceResult<CandidatePage>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const currentPage = Number.isInteger(page) && page >= 1 ? page : 1;

  // --- Datos propios: cliente del usuario (RLS) ---
  const [profileRead, housingRead, responseRead] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, deleted_at, onboarding_completed_at")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("housing_preferences")
      .select(HOUSING_COLUMNS)
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("compatibility_responses")
      .select(RESPONSE_COLUMNS)
      .eq("profile_id", userId)
      .maybeSingle(),
  ]);
  for (const read of [profileRead, housingRead, responseRead]) {
    if (read.error) return mapDbError(read.error);
  }
  const profile = profileRead.data;
  if (!profile) return fail("no_profile");
  if (profile.deleted_at !== null) return fail("deleted");
  if (profile.onboarding_completed_at === null) return fail("forbidden");
  const ownResponse = responseRead.data as ResponseRow | null;
  if (questionnaireStatus(ownResponse, CURRENT_QUESTIONNAIRE_VERSION) !== "completed") {
    return fail("forbidden");
  }
  const ownHousing = housingRead.data as HousingRow | null;
  if (!ownHousing || ownHousing.city_id === null) return fail("forbidden");

  const viewerFilter = toFilterProfile(ownHousing);
  const empty: CandidatePage = {
    candidates: [],
    page: currentPage,
    pageSize: CANDIDATES_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    viewerAcceptsRoommates: acceptsRoommates(viewerFilter),
  };
  if (!empty.viewerAcceptsRoommates) return ok(empty);

  // --- Lectura cruzada: service_role, una sola consulta, columnas explícitas ---
  const { data, error } = await deps
    .adminClient()
    .from("profiles")
    .select(CANDIDATE_SELECT)
    .neq("id", userId)
    .is("deleted_at", null)
    .not("onboarding_completed_at", "is", null)
    .neq("role", "admin")
    .eq("housing_preferences.city_id", ownHousing.city_id)
    .eq("compatibility_responses.questionnaire_version", CURRENT_QUESTIONNAIRE_VERSION)
    .not("compatibility_responses.completed_at", "is", null);
  if (error) return mapDbError(error);

  const viewerInput = toCompatibilityInput(ownHousing, ownResponse as ResponseRow);
  const scored: Scored[] = [];
  for (const row of (data ?? []) as unknown as CandidateRow[]) {
    const housing = one(row.housing_preferences);
    const response = one(row.compatibility_responses);
    if (!housing || !response) continue;
    const eligible = isEligibleCandidate(
      {
        id: row.id,
        role: row.role,
        deletedAt: row.deleted_at,
        onboardingCompletedAt: row.onboarding_completed_at,
        questionnaireVersion: response.questionnaire_version,
        questionnaireCompletedAt: response.completed_at,
      },
      userId,
      CURRENT_QUESTIONNAIRE_VERSION
    );
    if (!eligible) continue;
    if (
      !passesHardFilters(
        viewerFilter,
        toFilterProfile(housing),
        MATCH_WEIGHTS.budgetGapRef
      )
    ) {
      continue;
    }
    const result = calculateCompatibility(
      viewerInput,
      toCompatibilityInput(housing, response),
      MATCH_WEIGHTS
    );
    if (result.status !== "ok") continue;
    const reasons = (kind: "strength" | "difference") =>
      result.reasons
        .filter((reason) => reason.kind === kind)
        .map((reason) => renderReason(reason, "a", row.full_name));
    scored.push({
      row,
      housing,
      score: result.overallScore,
      strengths: reasons("strength"),
      differences: reasons("difference"),
    });
  }

  scored.sort(
    (x, y) =>
      y.score - x.score || (x.row.id < y.row.id ? -1 : x.row.id > y.row.id ? 1 : 0)
  );
  const total = scored.length;
  const totalPages = Math.ceil(total / CANDIDATES_PAGE_SIZE);
  const slice = scored.slice(
    (currentPage - 1) * CANDIDATES_PAGE_SIZE,
    currentPage * CANDIDATES_PAGE_SIZE
  );

  // --- Nombres solo para la página: tablas de referencia, cliente del usuario ---
  const universityIds = [
    ...new Set(
      slice.map((s) => s.housing.university_id).filter((id): id is string => !!id)
    ),
  ];
  const neighborhoodIds = [
    ...new Set(slice.flatMap((s) => s.housing.preferred_neighborhood_ids ?? [])),
  ];
  const [universitiesRead, neighborhoodsRead] = await Promise.all([
    universityIds.length > 0
      ? supabase.from("universities").select("id, name").in("id", universityIds)
      : Promise.resolve({ data: [], error: null }),
    neighborhoodIds.length > 0
      ? supabase.from("neighborhoods").select("id, name").in("id", neighborhoodIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (universitiesRead.error) return mapDbError(universitiesRead.error);
  if (neighborhoodsRead.error) return mapDbError(neighborhoodsRead.error);
  const universityNames = new Map(
    ((universitiesRead.data ?? []) as Array<{ id: string; name: string }>).map((u) => [
      u.id,
      u.name,
    ])
  );
  const neighborhoodNames = new Map(
    ((neighborhoodsRead.data ?? []) as Array<{ id: string; name: string }>).map((n) => [
      n.id,
      n.name,
    ])
  );

  const today = deps.today();
  const candidates = slice.map((s): CandidateDTO => {
    const zones = pickNeighborhoods(
      s.housing.preferred_neighborhood_ids ?? [],
      ownHousing.preferred_neighborhood_ids ?? [],
      neighborhoodNames
    );
    return {
      id: s.row.id,
      fullName: s.row.full_name,
      age: ageOn(s.row.date_of_birth, today),
      university: s.housing.university_id
        ? (universityNames.get(s.housing.university_id) ?? null)
        : null,
      neighborhoods: zones.shown,
      neighborhoodsTotal: zones.total,
      budgetRange: toBudgetRange(s.housing.budget_min, s.housing.budget_max),
      score: s.score,
      strengths: s.strengths,
      differences: s.differences,
    };
  });

  return ok({ ...empty, candidates, total, totalPages });
}
