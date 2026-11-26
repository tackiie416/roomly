import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  type CandidateDTO,
  MAX_COUNTERPARTS,
  evaluateCounterparts,
  type MatchingDeps,
} from "@/lib/services/matching";
import {
  type DbClient,
  type DbError,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";
import { uuidSchema } from "@/lib/validation/common";

/**
 * «Me interesa» y match mutuo (Fase 5.1).
 *
 * Reparto de clientes (D17, ampliada en la Fase 5.1):
 *   - Quién puede recibir un interés lo decide `evaluateCounterparts`
 *     (lib/services/matching.ts): las mismas reglas que `/explorar` (cuenta
 *     elegible y filtros duros). Así nadie envía un interés a un id que no le
 *     saldría en `/explorar`, y el score sale del motor de TypeScript.
 *   - Este archivo usa el cliente admin SOLO para dos rpc:
 *     `record_interest` y `withdraw_interest` (20261126120000), con EXECUTE
 *     solo para service_role. Los clientes no escriben en `interests` ni en
 *     `matches`; la base de datos exige además, a todos los roles, cuentas
 *     válidas e interés mutuo para un match.
 *   - Los intereses y matches propios se leen con el cliente del usuario
 *     (RLS: solo los participantes).
 */

export type InterestStatus = "sent" | "already_sent" | "matched";
export type WithdrawStatus = "withdrawn" | "not_found";

export type InterestsDeps = MatchingDeps & {
  /** Cliente con service_role, solo para las dos rpc. Se inyecta en los tests. */
  interestsAdminClient: () => DbClient;
};

const DEFAULT_DEPS: InterestsDeps = {
  adminClient: () => createAdminClient(),
  interestsAdminClient: () => createAdminClient(),
  today: () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
};

const INTEREST_STATUSES: readonly InterestStatus[] = ["sent", "already_sent", "matched"];

/** Traduce los errores de las rpc sin exponer su mensaje. */
function mapRpcError<T>(error: DbError): ServiceResult<T> {
  const message = error?.message ?? "";
  if (message.includes("rate_limit_exceeded")) return fail("rate_limited");
  // La otra cuenta dejó de ser válida entre la comprobación y la rpc: para
  // quien envía es lo mismo que no encontrarla.
  if (message.includes("interest_party_invalid")) return fail("not_found");
  return mapDbError(error);
}

/**
 * Envía «Me interesa» a `targetId`. Si la otra persona ya lo había enviado,
 * se crea el match en la misma transacción. Errores:
 *   - `validation`: el id no es un UUID;
 *   - `not_found`: no existe, no es elegible o no pasa los filtros duros
 *     (indistinguibles, para no enumerar perfiles);
 *   - `rate_limited`: 30 intereses en 24 h;
 *   - los de quien envía: `unauthenticated`, `no_profile`, `deleted`,
 *     `forbidden` (sin onboarding o sin el test vigente completado).
 */
export async function sendInterest(
  supabase: DbClient,
  targetId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ status: InterestStatus }>> {
  const parsed = uuidSchema.safeParse(targetId);
  if (!parsed.success) return fail("validation");

  const evaluated = await evaluateCounterparts(
    supabase,
    [parsed.data],
    { requireHardFilters: true },
    deps
  );
  if (!evaluated.ok) return evaluated;
  const target = evaluated.data.byId.get(parsed.data);
  if (!target) return fail("not_found");

  const { data, error } = await deps.interestsAdminClient().rpc("record_interest", {
    p_from: evaluated.data.viewerId,
    p_to: target.id,
    p_score: target.score,
  });
  if (error) return mapRpcError(error);
  const status = data as unknown;
  if (!INTEREST_STATUSES.includes(status as InterestStatus)) return fail("unknown");
  return ok({ status: status as InterestStatus });
}

/**
 * Retira un interés enviado. Con match ya hecho no se retira (`conflict`):
 * deshacer un match es una decisión de la Fase 6. No hace falta que la otra
 * persona siga siendo elegible: retirar siempre está permitido.
 */
export async function withdrawInterest(
  supabase: DbClient,
  targetId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ status: WithdrawStatus }>> {
  const parsed = uuidSchema.safeParse(targetId);
  if (!parsed.success) return fail("validation");
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const profile = await supabase
    .from("profiles")
    .select("id, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error) return mapDbError(profile.error);
  if (!profile.data) return fail("no_profile");
  if (profile.data.deleted_at !== null) return fail("deleted");
  if (parsed.data === userId) return fail("validation");

  const { data, error } = await deps.interestsAdminClient().rpc("withdraw_interest", {
    p_from: userId,
    p_to: parsed.data,
  });
  if (error) return mapRpcError(error);
  if (data === "matched") return fail("conflict");
  if (data === "withdrawn" || data === "not_found") return ok({ status: data });
  return fail("unknown");
}

export type MatchSummary = CandidateDTO & { matchedAt: string };
export type InterestSummary = CandidateDTO & { at: string };

export type InterestOverview = {
  matches: MatchSummary[];
  /** Te han enviado «Me interesa» y todavía no has respondido. */
  received: InterestSummary[];
  /** Lo has enviado y todavía no hay respuesta. */
  sent: InterestSummary[];
  /** Ids con interés enviado (con o sin match), para marcar `/explorar`. */
  sentIds: string[];
  matchedIds: string[];
};

type InterestRow = { from_user_id: string; to_user_id: string; created_at: string };
type MatchRow = {
  user_a_id: string;
  user_b_id: string;
  compatibility_score: number;
  created_at: string;
};

/** Ids propios: intereses enviados y recibidos, y matches (cliente del usuario). */
export async function getOwnInterestIds(
  supabase: DbClient
): Promise<
  ServiceResult<{ userId: string; interests: InterestRow[]; matches: MatchRow[] }>
> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const [interestsRead, matchesRead] = await Promise.all([
    supabase
      .from("interests")
      .select("from_user_id, to_user_id, created_at")
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("matches")
      .select("user_a_id, user_b_id, compatibility_score, created_at")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (interestsRead.error) return mapDbError(interestsRead.error);
  if (matchesRead.error) return mapDbError(matchesRead.error);
  return ok({
    userId,
    interests: (interestsRead.data ?? []) as InterestRow[],
    matches: (matchesRead.data ?? []) as MatchRow[],
  });
}

/**
 * `/matches`: matches, intereses recibidos sin responder e intereses
 * enviados sin respuesta. Cada persona sale como `CandidateDTO` (lista
 * blanca). Los intereses solo se muestran si la otra persona sigue pasando
 * los filtros duros (como en `/explorar`); los matches, mientras su cuenta
 * siga siendo elegible, con el score guardado al crearse.
 */
export async function getInterestOverview(
  supabase: DbClient,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<InterestOverview>> {
  const own = await getOwnInterestIds(supabase);
  if (!own.ok) return own;
  const { userId, interests, matches } = own.data;

  const other = (m: MatchRow) => (m.user_a_id === userId ? m.user_b_id : m.user_a_id);
  const matchedIds = matches.map(other);
  const matched = new Set(matchedIds);
  // Los más recientes primero (las lecturas van ordenadas), hasta el máximo
  // de una evaluación: recibidos antes que enviados.
  const receivedRows = interests
    .filter((i) => i.to_user_id === userId && !matched.has(i.from_user_id))
    .slice(0, MAX_COUNTERPARTS);
  const sentRows = interests
    .filter((i) => i.from_user_id === userId && !matched.has(i.to_user_id))
    .slice(0, MAX_COUNTERPARTS - receivedRows.length);
  const shownMatches = matches.slice(0, MAX_COUNTERPARTS);

  const [withFilters, withoutFilters] = await Promise.all([
    evaluateCounterparts(
      supabase,
      [...sentRows.map((i) => i.to_user_id), ...receivedRows.map((i) => i.from_user_id)],
      { requireHardFilters: true },
      deps
    ),
    evaluateCounterparts(
      supabase,
      shownMatches.map(other),
      { requireHardFilters: false },
      deps
    ),
  ]);
  if (!withFilters.ok) return withFilters;
  if (!withoutFilters.ok) return withoutFilters;

  const summaries = (rows: InterestRow[], idOf: (i: InterestRow) => string) =>
    rows.flatMap((i): InterestSummary[] => {
      const dto = withFilters.data.byId.get(idOf(i));
      return dto ? [{ ...dto, at: i.created_at }] : [];
    });

  return ok({
    matches: shownMatches.flatMap((m): MatchSummary[] => {
      const dto = withoutFilters.data.byId.get(other(m));
      return dto
        ? [{ ...dto, score: m.compatibility_score, matchedAt: m.created_at }]
        : [];
    }),
    received: summaries(receivedRows, (i) => i.from_user_id),
    sent: summaries(sentRows, (i) => i.to_user_id),
    sentIds: interests.filter((i) => i.from_user_id === userId).map((i) => i.to_user_id),
    matchedIds,
  });
}

export type InterestState = "sent" | "received" | "matched";

/**
 * Estado de «Me interesa» con cada persona (para las tarjetas de
 * `/explorar`), con el cliente del usuario. Sin entrada: ninguno.
 */
export async function getInterestStates(
  supabase: DbClient
): Promise<ServiceResult<Map<string, InterestState>>> {
  const own = await getOwnInterestIds(supabase);
  if (!own.ok) return own;
  const { userId, interests, matches } = own.data;
  const states = new Map<string, InterestState>();
  for (const i of interests) {
    if (i.to_user_id === userId && !states.has(i.from_user_id)) {
      states.set(i.from_user_id, "received");
    }
  }
  // Lo enviado pesa más que lo recibido (sin match, solo puede ser uno de los
  // dos: si fueran los dos, habría match).
  for (const i of interests) {
    if (i.from_user_id === userId) states.set(i.to_user_id, "sent");
  }
  for (const m of matches) {
    states.set(m.user_a_id === userId ? m.user_b_id : m.user_a_id, "matched");
  }
  return ok(states);
}
