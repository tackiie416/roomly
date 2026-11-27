import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  type CandidateDTO,
  MAX_COUNTERPARTS,
  type PersonProfileDTO,
  evaluateCounterparts,
  getPersonProfile,
  type MatchingDeps,
  namesOfBlocked,
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
 *   - Este archivo usa el cliente admin SOLO para seis rpc:
 *     `record_interest` y `withdraw_interest` (20261126120000),
 *     `undo_match` y `room_interest_owner` (Fase 6, 20261127120000), y
 *     `block_user` y `unblock_user` (sesión 83, 20261128120000), con
 *     EXECUTE solo para service_role. Los clientes no escriben en `interests` ni en
 *     `matches`; la base de datos exige además, a todos los roles, cuentas
 *     válidas e interés mutuo para un match.
 *   - Los intereses y matches propios se leen con el cliente del usuario
 *     (RLS: solo los participantes).
 */

export type InterestStatus = "sent" | "already_sent" | "matched";
export type WithdrawStatus = "withdrawn" | "not_found";

export type InterestsDeps = MatchingDeps & {
  /** Cliente con service_role, solo para las seis rpc. Se inyecta en los tests. */
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

  let evaluated = await evaluateCounterparts(
    supabase,
    [parsed.data],
    { requireHardFilters: true },
    deps
  );
  if (!evaluated.ok) return evaluated;
  if (!evaluated.data.byId.has(parsed.data)) {
    // Fase 6: quien te mostró interés por una habitación tuya (o por la suya)
    // puede recibir tu respuesta aunque no salga en `/explorar`.
    const own = await getOwnInterestIds(supabase);
    if (!own.ok) return own;
    if (!roomLinked(own.data.interests, parsed.data)) return fail("not_found");
    evaluated = await evaluateCounterparts(
      supabase,
      [parsed.data],
      { requireHardFilters: false },
      deps
    );
    if (!evaluated.ok) return evaluated;
  }
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

/** Contexto de un interés por habitación (Fase 6): solo su título. */
export type RoomContext = {
  id: string;
  /** `null` si quien mira ya no puede verla (dejó de estar publicada). */
  title: string | null;
};

export type MatchSummary = CandidateDTO & {
  matchedAt: string;
  /** Su chat (Fase 6); `null` si todavía no se ha abierto. */
  conversationId: string | null;
};
export type InterestSummary = CandidateDTO & { at: string; room: RoomContext | null };

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

type InterestRow = {
  from_user_id: string;
  to_user_id: string;
  room_id: string | null;
  created_at: string;
};
type MatchRow = {
  id: string;
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
      .select("from_user_id, to_user_id, room_id, created_at")
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("matches")
      .select("id, user_a_id, user_b_id, compatibility_score, created_at")
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
  const counterpart = (i: InterestRow) =>
    i.from_user_id === userId ? i.to_user_id : i.from_user_id;
  // Fase 6: un interés por habitación no depende de los filtros duros (se
  // eligió esa habitación, no a alguien de `/explorar`).
  const interestRows = [...sentRows, ...receivedRows];
  const filtered = interestRows.filter((i) => !i.room_id).map(counterpart);
  const unfiltered = [
    ...shownMatches.map(other),
    ...interestRows.filter((i) => Boolean(i.room_id)).map(counterpart),
  ];
  const roomIds = [
    ...new Set(interestRows.flatMap((i) => (i.room_id ? [i.room_id] : []))),
  ];

  const [withFilters, withoutFilters, rooms, conversations] = await Promise.all([
    evaluateCounterparts(supabase, filtered, { requireHardFilters: true }, deps),
    evaluateCounterparts(supabase, unfiltered, { requireHardFilters: false }, deps),
    roomTitles(supabase, roomIds),
    conversationIdsByMatch(
      supabase,
      shownMatches.map((m) => m.id)
    ),
  ]);
  if (!withFilters.ok) return withFilters;
  if (!withoutFilters.ok) return withoutFilters;
  if (!rooms.ok) return rooms;
  if (!conversations.ok) return conversations;

  const summaries = (rows: InterestRow[]) =>
    rows.flatMap((i): InterestSummary[] => {
      const id = counterpart(i);
      const dto = (i.room_id ? withoutFilters : withFilters).data.byId.get(id);
      if (!dto) return [];
      const room = i.room_id
        ? { id: i.room_id, title: rooms.data.get(i.room_id) ?? null }
        : null;
      return [{ ...dto, at: i.created_at, room }];
    });

  return ok({
    matches: shownMatches.flatMap((m): MatchSummary[] => {
      const dto = withoutFilters.data.byId.get(other(m));
      return dto
        ? [
            {
              ...dto,
              score: m.compatibility_score,
              matchedAt: m.created_at,
              conversationId: conversations.data.get(m.id) ?? null,
            },
          ]
        : [];
    }),
    received: summaries(receivedRows),
    sent: summaries(sentRows),
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
  return ok(statesOf(own.data));
}

function statesOf({
  userId,
  interests,
  matches,
}: {
  userId: string;
  interests: InterestRow[];
  matches: MatchRow[];
}): Map<string, InterestState> {
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
  return states;
}

export type PersonPage = {
  profile: PersonProfileDTO;
  state: InterestState | undefined;
  matchedAt: string | null;
};

/**
 * «Ver perfil» (Fase 5.2): el perfil y el estado de «Me interesa» con esa
 * persona. Con match, se ve aunque ya no pase los filtros duros, con el score
 * guardado del match; también (Fase 6) con un interés por habitación entre
 * las dos, en cualquier sentido; si no, solo si saldría en `/explorar`. Cualquier
 * otro caso (id no válido, inexistente, no elegible, uno mismo) es
 * `not_found`, sin distinguir.
 */
export async function getPersonPage(
  supabase: DbClient,
  targetId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<PersonPage>> {
  const parsed = uuidSchema.safeParse(targetId);
  if (!parsed.success) return fail("not_found");
  const own = await getOwnInterestIds(supabase);
  if (!own.ok) return own;
  const state = statesOf(own.data).get(parsed.data);
  const match = own.data.matches.find(
    (m) => m.user_a_id === parsed.data || m.user_b_id === parsed.data
  );
  const profile = await getPersonProfile(
    supabase,
    parsed.data,
    { requireHardFilters: !match && !roomLinked(own.data.interests, parsed.data) },
    deps
  );
  if (!profile.ok) return profile;
  return ok({
    profile: match ? { ...profile.data, score: match.compatibility_score } : profile.data,
    state,
    matchedAt: match?.created_at ?? null,
  });
}

/** Fase 6: hay un interés por habitación entre quien mira y `otherId`. */
function roomLinked(interests: readonly InterestRow[], otherId: string): boolean {
  return interests.some(
    (i) => Boolean(i.room_id) && (i.from_user_id === otherId || i.to_user_id === otherId)
  );
}

/**
 * Títulos de las habitaciones de los intereses, con el cliente del usuario:
 * las propias en cualquier estado y las ajenas solo si son públicas (R7). Lo
 * que no puede ver se queda sin título.
 */
async function roomTitles(
  supabase: DbClient,
  roomIds: string[]
): Promise<ServiceResult<Map<string, string>>> {
  if (roomIds.length === 0) return ok(new Map());
  const { data, error } = await supabase
    .from("rooms")
    .select("id, title")
    .in("id", roomIds);
  if (error) return mapDbError(error);
  return ok(
    new Map(((data ?? []) as { id: string; title: string }[]).map((r) => [r.id, r.title]))
  );
}

/** Chat de cada match (RLS: solo las conversaciones abiertas propias). */
async function conversationIdsByMatch(
  supabase: DbClient,
  matchIds: string[]
): Promise<ServiceResult<Map<string, string>>> {
  if (matchIds.length === 0) return ok(new Map());
  const { data, error } = await supabase
    .from("conversations")
    .select("id, match_id")
    .in("match_id", matchIds);
  if (error) return mapDbError(error);
  const byMatch = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; match_id: string | null }[]) {
    if (row.match_id) byMatch.set(row.match_id, row.id);
  }
  return ok(byMatch);
}

export type UndoStatus = "undone" | "not_found";

/** Cuenta propia activa (las acciones que no exigen el test, como retirar). */
async function activeUserId(supabase: DbClient): Promise<ServiceResult<string>> {
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
  return ok(userId);
}

/**
 * Deshace el match con `targetId` (Fase 6): borra el match y los dos
 * intereses, y la base de datos cierra el chat (ninguna de las dos personas
 * lo vuelve a leer ni a escribir). Siempre permitido para quien forma parte
 * del match, aunque la otra persona ya no sea elegible. Sin match:
 * `not_found`.
 */
export async function undoMatch(
  supabase: DbClient,
  targetId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ status: UndoStatus }>> {
  const parsed = uuidSchema.safeParse(targetId);
  if (!parsed.success) return fail("validation");
  const user = await activeUserId(supabase);
  if (!user.ok) return user;
  if (parsed.data === user.data) return fail("validation");

  const { data, error } = await deps.interestsAdminClient().rpc("undo_match", {
    p_user: user.data,
    p_other: parsed.data,
  });
  if (error) return mapRpcError(error);
  if (data === "undone" || data === "not_found") return ok({ status: data });
  return fail("unknown");
}

/**
 * «Me interesa esta habitación» (Fase 6). La habitación tiene que ser pública
 * (R7) y de una cuenta que pueda recibir intereses; el detalle público sigue
 * sin decir de quién es (R4): solo las dos personas lo ven después, en
 * `/matches`. Sin filtros duros (se elige la habitación), pero las dos
 * personas necesitan el test vigente completado para calcular el score.
 * Errores: `validation` (id no válido o habitación propia), `not_found`
 * (indistinguible: no existe, no es pública o su cuenta no puede recibirlo),
 * `rate_limited` y los de la cuenta de quien envía.
 */
export async function sendRoomInterest(
  supabase: DbClient,
  roomId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ status: InterestStatus }>> {
  const parsed = uuidSchema.safeParse(roomId);
  if (!parsed.success) return fail("validation");

  const ownerRead = await deps
    .interestsAdminClient()
    .rpc("room_interest_owner", { p_room_id: parsed.data });
  if (ownerRead.error) return mapRpcError(ownerRead.error);
  const owner = uuidSchema.safeParse(ownerRead.data);
  if (!owner.success) return fail("not_found");

  const evaluated = await evaluateCounterparts(
    supabase,
    [owner.data],
    { requireHardFilters: false },
    deps
  );
  if (!evaluated.ok) return evaluated;
  if (owner.data === evaluated.data.viewerId) return fail("validation");
  const target = evaluated.data.byId.get(owner.data);
  if (!target) return fail("not_found");

  const { data, error } = await deps.interestsAdminClient().rpc("record_interest", {
    p_from: evaluated.data.viewerId,
    p_to: target.id,
    p_score: target.score,
    p_room_id: parsed.data,
  });
  if (error) {
    if ((error.message ?? "").includes("interest_room_invalid")) return fail("not_found");
    return mapRpcError(error);
  }
  const status = data as unknown;
  if (!INTEREST_STATUSES.includes(status as InterestStatus)) return fail("unknown");
  return ok({ status: status as InterestStatus });
}

// ------------------------------------------------------------------
// Bloqueos (sesión 83)
// ------------------------------------------------------------------

export type BlockStatus = "blocked" | "already_blocked";
export type UnblockStatus = "unblocked" | "not_found";

/** Bloqueos propios (cliente del usuario: RLS, solo los que ha hecho). */
async function ownBlocks(
  supabase: DbClient,
  userId: string
): Promise<ServiceResult<{ blocked_id: string; created_at: string }[]>> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_COUNTERPARTS);
  if (error) return mapDbError(error);
  return ok((data ?? []) as { blocked_id: string; created_at: string }[]);
}

/**
 * ¿Puede quien mira referirse a `targetId` para bloquearla o reportarla? Solo
 * a alguien que ya conoce por la app: con un interés o un match entre las dos,
 * a quien ya ha bloqueado, o que le saldría en `/explorar` sin los filtros
 * duros (cuenta elegible). Cualquier otro id es `not_found`: estas acciones no
 * sirven para saber si un id existe.
 */
export async function knownCounterpart(
  supabase: DbClient,
  targetId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ userId: string; targetId: string; name: string | null }>> {
  const parsed = uuidSchema.safeParse(targetId);
  if (!parsed.success) return fail("not_found");
  const user = await activeUserId(supabase);
  if (!user.ok) return user;
  if (parsed.data === user.data) return fail("not_found");

  const blocks = await ownBlocks(supabase, user.data);
  if (!blocks.ok) return blocks;
  if (blocks.data.some((b) => b.blocked_id === parsed.data)) {
    const names = await namesOfBlocked([parsed.data], deps);
    if (!names.ok) return names;
    return ok({
      userId: user.data,
      targetId: parsed.data,
      name: names.data.get(parsed.data) ?? null,
    });
  }

  const evaluated = await evaluateCounterparts(
    supabase,
    [parsed.data],
    { requireHardFilters: false },
    deps
  );
  if (!evaluated.ok) return evaluated;
  const dto = evaluated.data.byId.get(parsed.data);
  if (!dto) return fail("not_found");
  return ok({ userId: user.data, targetId: parsed.data, name: dto.fullName });
}

/**
 * Bloquea a `targetId` (sesión 83). La base de datos borra el match y los
 * intereses de las dos y cierra su chat, y no deja crear nada nuevo entre
 * ellas en ningún sentido. Para la otra persona es como si la cuenta dejara
 * de estar disponible: no se le avisa ni puede leer el bloqueo.
 */
export async function blockUser(
  supabase: DbClient,
  targetId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ status: BlockStatus }>> {
  const known = await knownCounterpart(supabase, targetId, deps);
  if (!known.ok) return known;
  const { data, error } = await deps.interestsAdminClient().rpc("block_user", {
    p_blocker: known.data.userId,
    p_blocked: known.data.targetId,
  });
  if (error) {
    if ((error.message ?? "").includes("rate_limit_exceeded"))
      return fail("rate_limited");
    return mapDbError(error);
  }
  if (data === "blocked" || data === "already_blocked") return ok({ status: data });
  return fail("unknown");
}

/** Quita un bloqueo propio. No devuelve el match ni los intereses borrados. */
export async function unblockUser(
  supabase: DbClient,
  targetId: unknown,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ status: UnblockStatus }>> {
  const parsed = uuidSchema.safeParse(targetId);
  if (!parsed.success) return fail("validation");
  const user = await activeUserId(supabase);
  if (!user.ok) return user;
  if (parsed.data === user.data) return fail("validation");
  const { data, error } = await deps.interestsAdminClient().rpc("unblock_user", {
    p_blocker: user.data,
    p_blocked: parsed.data,
  });
  if (error) return mapDbError(error);
  if (data === "unblocked" || data === "not_found") return ok({ status: data });
  return fail("unknown");
}

export type BlockedPerson = {
  id: string;
  /** `null` si la cuenta ya no está disponible. */
  name: string | null;
  blockedAt: string;
};

/** `/ajustes/bloqueos`: las personas que has bloqueado, las últimas primero. */
export async function listBlockedPeople(
  supabase: DbClient,
  deps: InterestsDeps = DEFAULT_DEPS
): Promise<ServiceResult<BlockedPerson[]>> {
  const user = await activeUserId(supabase);
  if (!user.ok) return user;
  const blocks = await ownBlocks(supabase, user.data);
  if (!blocks.ok) return blocks;
  const names = await namesOfBlocked(
    blocks.data.map((b) => b.blocked_id),
    deps
  );
  if (!names.ok) return names;
  return ok(
    blocks.data.map((b) => ({
      id: b.blocked_id,
      name: names.data.get(b.blocked_id) ?? null,
      blockedAt: b.created_at,
    }))
  );
}
