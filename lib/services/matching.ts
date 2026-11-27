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

/** Datos propios de quien mira, leídos con su cliente (RLS). */
type Viewer = {
  userId: string;
  housing: HousingRow;
  response: ResponseRow;
  filter: HardFilterProfile;
};

/**
 * Quien mira: sesión, perfil activo con el onboarding completo, test
 * completado en la versión vigente y ciudad. Mismos errores que antes de la
 * Fase 5 (`getCandidates`).
 */
async function loadViewer(supabase: DbClient): Promise<ServiceResult<Viewer>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

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

  return ok({
    userId,
    housing: ownHousing,
    response: ownResponse as ResponseRow,
    filter: toFilterProfile(ownHousing),
  });
}

/**
 * Elegibilidad (`isEligibleCandidate`), filtros duros (si se piden) y score
 * de cada fila leída con service_role. Las filas que no pasan se descartan.
 */
function scoreRows(
  viewer: Viewer,
  rows: CandidateRow[],
  requireHardFilters: boolean
): Scored[] {
  const viewerInput = toCompatibilityInput(viewer.housing, viewer.response);
  const scored: Scored[] = [];
  for (const row of rows) {
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
      viewer.userId,
      CURRENT_QUESTIONNAIRE_VERSION
    );
    if (!eligible) continue;
    if (
      requireHardFilters &&
      !passesHardFilters(
        viewer.filter,
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
  return scored;
}

/** `CandidateDTO` campo a campo, con los nombres de universidades y barrios (cliente del usuario). */
async function toCandidateDTOs(
  supabase: DbClient,
  viewer: Viewer,
  scored: Scored[],
  today: string
): Promise<ServiceResult<CandidateDTO[]>> {
  const universityIds = [
    ...new Set(
      scored.map((s) => s.housing.university_id).filter((id): id is string => !!id)
    ),
  ];
  const neighborhoodIds = [
    ...new Set(scored.flatMap((s) => s.housing.preferred_neighborhood_ids ?? [])),
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

  return ok(
    scored.map((s): CandidateDTO => {
      const zones = pickNeighborhoods(
        s.housing.preferred_neighborhood_ids ?? [],
        viewer.housing.preferred_neighborhood_ids ?? [],
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
    })
  );
}

function byScoreThenId(x: Scored, y: Scored): number {
  return y.score - x.score || (x.row.id < y.row.id ? -1 : x.row.id > y.row.id ? 1 : 0);
}

/**
 * Personas con un bloqueo con quien mira, en cualquiera de los dos sentidos
 * (sesión 83). Se lee con service_role porque quien está bloqueada no puede
 * leer los bloqueos que le han hecho (RLS de `user_blocks`: solo los
 * propios), y así nunca sabe por la app quién la ha bloqueado: esa persona
 * simplemente deja de salirle, como si su cuenta ya no estuviera disponible.
 */
async function blockedCounterparts(
  deps: MatchingDeps,
  viewerId: string
): Promise<ServiceResult<Set<string>>> {
  const { data, error } = await deps
    .adminClient()
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
    .limit(5000);
  if (error) return mapDbError(error);
  const ids = new Set<string>();
  for (const row of (data ?? []) as { blocker_id?: string; blocked_id?: string }[]) {
    const other = row.blocker_id === viewerId ? row.blocked_id : row.blocker_id;
    if (typeof other === "string" && other !== viewerId) ids.add(other);
  }
  return ok(ids);
}

/**
 * Página `page` (desde 1) de candidatos de la sesión, por score descendente
 * y, a igual score, por id ascendente. Sin límite total.
 */
export async function getCandidates(
  supabase: DbClient,
  page: number,
  deps: MatchingDeps = DEFAULT_DEPS
): Promise<ServiceResult<CandidatePage>> {
  const viewerRead = await loadViewer(supabase);
  if (!viewerRead.ok) return viewerRead;
  const viewer = viewerRead.data;
  const currentPage = Number.isInteger(page) && page >= 1 ? page : 1;

  const empty: CandidatePage = {
    candidates: [],
    page: currentPage,
    pageSize: CANDIDATES_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    viewerAcceptsRoommates: acceptsRoommates(viewer.filter),
  };
  if (!empty.viewerAcceptsRoommates) return ok(empty);

  // --- Lectura cruzada: service_role, una sola consulta, columnas explícitas ---
  const { data, error } = await deps
    .adminClient()
    .from("profiles")
    .select(CANDIDATE_SELECT)
    .neq("id", viewer.userId)
    .is("deleted_at", null)
    .not("onboarding_completed_at", "is", null)
    .neq("role", "admin")
    .eq("housing_preferences.city_id", viewer.housing.city_id as string)
    .eq("compatibility_responses.questionnaire_version", CURRENT_QUESTIONNAIRE_VERSION)
    .not("compatibility_responses.completed_at", "is", null);
  if (error) return mapDbError(error);
  const blocked = await blockedCounterparts(deps, viewer.userId);
  if (!blocked.ok) return blocked;

  const scored = scoreRows(
    viewer,
    ((data ?? []) as unknown as CandidateRow[]).filter(
      (row) => !blocked.data.has(row.id)
    ),
    true
  );
  scored.sort(byScoreThenId);
  const total = scored.length;
  const totalPages = Math.ceil(total / CANDIDATES_PAGE_SIZE);
  const slice = scored.slice(
    (currentPage - 1) * CANDIDATES_PAGE_SIZE,
    currentPage * CANDIDATES_PAGE_SIZE
  );

  const dtos = await toCandidateDTOs(supabase, viewer, slice, deps.today());
  if (!dtos.ok) return dtos;
  return ok({ ...empty, candidates: dtos.data, total, totalPages });
}

/** Máximo de personas por evaluación concreta (intereses y matches de una página). */
export const MAX_COUNTERPARTS = 200;

export type Counterparts = {
  viewerId: string;
  /** Solo las personas que pasan: elegibles y, si se piden, los filtros duros. */
  byId: Map<string, CandidateDTO>;
};

/**
 * Fase 5: las mismas reglas que `/explorar`, para un conjunto concreto de
 * personas (la destinataria de un «Me interesa», o las de los intereses y
 * matches propios). Con `requireHardFilters`, solo pasan quienes saldrían en
 * `/explorar` (así no se puede enviar un interés ni ver a nadie por su id);
 * sin él (matches ya hechos), basta con que la cuenta siga siendo elegible.
 * Una sola consulta con service_role, con las mismas columnas explícitas; lo
 * que sale es `CandidateDTO`, nunca la fila.
 */
export async function evaluateCounterparts(
  supabase: DbClient,
  ids: readonly string[],
  options: { requireHardFilters: boolean },
  deps: MatchingDeps = DEFAULT_DEPS
): Promise<ServiceResult<Counterparts>> {
  const viewerRead = await loadViewer(supabase);
  if (!viewerRead.ok) return viewerRead;
  const viewer = viewerRead.data;
  const unique = [...new Set(ids)].filter((id) => id !== viewer.userId);
  if (unique.length > MAX_COUNTERPARTS) return fail("validation");
  if (unique.length === 0) return ok({ viewerId: viewer.userId, byId: new Map() });

  const { data, error } = await deps
    .adminClient()
    .from("profiles")
    .select(CANDIDATE_SELECT)
    .in("id", unique)
    .neq("id", viewer.userId)
    .is("deleted_at", null)
    .not("onboarding_completed_at", "is", null)
    .neq("role", "admin")
    .eq("compatibility_responses.questionnaire_version", CURRENT_QUESTIONNAIRE_VERSION)
    .not("compatibility_responses.completed_at", "is", null);
  if (error) return mapDbError(error);
  const blocked = await blockedCounterparts(deps, viewer.userId);
  if (!blocked.ok) return blocked;

  const scored = scoreRows(
    viewer,
    ((data ?? []) as unknown as CandidateRow[]).filter(
      (row) => !blocked.data.has(row.id)
    ),
    options.requireHardFilters
  );
  scored.sort(byScoreThenId);
  const dtos = await toCandidateDTOs(supabase, viewer, scored, deps.today());
  if (!dtos.ok) return dtos;
  return ok({
    viewerId: viewer.userId,
    byId: new Map(dtos.data.map((dto) => [dto.id, dto])),
  });
}

export type SeekingStatus =
  "looking_for_room" | "has_room_looking_for_roommate" | "flexible";

/**
 * «Ver perfil» (Fase 5.2): `CandidateDTO` más lo que la persona escribió para
 * que lo vean otras (sus textos «Sobre ti» y «Estudios», que los formularios
 * avisan de que son visibles), qué busca y el mes desde el que quiere entrar.
 * Nunca la fecha de nacimiento, los presupuestos exactos, las respuestas, el
 * email ni `categoryScores`.
 */
export type PersonProfileDTO = CandidateDTO & {
  bio: string | null;
  fieldOfStudy: string | null;
  seekingStatus: SeekingStatus;
  /** `AAAA-MM`, solo el mes. */
  moveInMonth: string | null;
};

const SEEKING_STATUSES: readonly SeekingStatus[] = [
  "looking_for_room",
  "has_room_looking_for_roommate",
  "flexible",
];

/**
 * Perfil de otra persona con las reglas de `/explorar` (D14 y Fase 5): con
 * `requireHardFilters`, solo si quien mira la vería en `/explorar`; sin él
 * (ya hay match), basta con que la cuenta siga siendo elegible. Si no pasa,
 * `not_found`, igual que un id inexistente: no se puede enumerar perfiles.
 * Dos consultas con service_role y columnas explícitas.
 */
export async function getPersonProfile(
  supabase: DbClient,
  id: string,
  options: { requireHardFilters: boolean },
  deps: MatchingDeps = DEFAULT_DEPS
): Promise<ServiceResult<PersonProfileDTO>> {
  const evaluated = await evaluateCounterparts(supabase, [id], options, deps);
  if (!evaluated.ok) return evaluated;
  const dto = evaluated.data.byId.get(id);
  if (!dto) return fail("not_found");

  const { data, error } = await deps
    .adminClient()
    .from("profiles")
    .select(
      "bio, seeking_status, housing_preferences!inner(field_of_study, move_in_date)"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!data) return fail("not_found");
  const row = data as unknown as {
    bio: string | null;
    seeking_status: string;
    housing_preferences:
      | { field_of_study: string | null; move_in_date: string | null }
      | Array<{ field_of_study: string | null; move_in_date: string | null }>
      | null;
  };
  const housing = one(row.housing_preferences);
  const text = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };
  if (!SEEKING_STATUSES.includes(row.seeking_status as SeekingStatus))
    return fail("unknown");
  return ok({
    ...dto,
    bio: text(row.bio),
    fieldOfStudy: text(housing?.field_of_study),
    seekingStatus: row.seeking_status as SeekingStatus,
    moveInMonth: housing?.move_in_date ? housing.move_in_date.slice(0, 7) : null,
  });
}

/**
 * Nombres de las personas que quien mira ha bloqueado (sesión 83), para su
 * lista de `/ajustes/bloqueos`: solo `id` y nombre, de cuentas activas. Los
 * ids salen de los bloqueos propios, leídos antes con el cliente del usuario
 * (nunca de un parámetro del navegador).
 */
export async function namesOfBlocked(
  ids: readonly string[],
  deps: MatchingDeps = DEFAULT_DEPS
): Promise<ServiceResult<Map<string, string>>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return ok(new Map());
  if (unique.length > MAX_COUNTERPARTS) return fail("validation");
  const { data, error } = await deps
    .adminClient()
    .from("profiles")
    .select("id, full_name")
    .in("id", unique)
    .is("deleted_at", null);
  if (error) return mapDbError(error);
  return ok(
    new Map(
      ((data ?? []) as { id: string; full_name: string }[]).map((p) => [
        p.id,
        p.full_name,
      ])
    )
  );
}
