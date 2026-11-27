import "server-only";

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
import {
  MESSAGES_PAGE_SIZE,
  type MessageCursor,
  encodeMessageCursor,
  messageInputSchema,
  parseMessageCursor,
} from "@/lib/validation/chat";
import { uuidSchema } from "@/lib/validation/common";

/**
 * Chat entre matches (Fase 6, 20261127120000).
 *
 * Todo con el cliente del usuario (sin service_role): la RLS solo deja ver
 * las conversaciones ABIERTAS en las que participa (`is_conversation_participant`)
 * y el trigger `trg_messages_integrity` decide, para todos los roles, si un
 * mensaje puede entrar (match vigente, cuentas activas, longitud, ritmo y
 * `client_token` único). Este servicio valida antes con Zod y comprueba que
 * la conversación es visible, para responder igual (`not_found`) a una
 * conversación ajena, cerrada o inexistente.
 *
 * La otra persona sale como `CandidateDTO` (lista blanca, por
 * `evaluateCounterparts` de lib/services/matching.ts, sin filtros duros: ya
 * hay match). Nunca se devuelven ids de remitente: cada mensaje dice solo si
 * es propio.
 */

/**
 * Lo que necesita `evaluateCounterparts`; sin pasarlo, el suyo por defecto
 * (este archivo no importa el cliente admin: D17).
 */
export type ChatDeps = MatchingDeps | undefined;

export type ConversationSummary = {
  id: string;
  /** `null` si la cuenta de la otra persona ya no está disponible. */
  person: CandidateDTO | null;
  lastMessageAt: string | null;
  createdAt: string;
  unread: boolean;
};

export type ChatMessage = {
  id: string;
  mine: boolean;
  content: string;
  createdAt: string;
};

export type ConversationPage = {
  id: string;
  person: CandidateDTO | null;
  /** Id de la otra persona, solo para las acciones del servidor (deshacer). */
  otherId: string;
  messages: ChatMessage[];
  /** Cursor para «Mensajes anteriores»; `null` si no hay más. */
  olderCursor: string | null;
  /** Se está viendo la página más reciente (sin cursor). */
  latest: boolean;
};

type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
};
type ConversationRow = {
  id: string;
  match_id: string | null;
  created_at: string;
  last_message_at: string | null;
};
type MessageRow = { id: string; sender_id: string; content: string; created_at: string };

/** Ids de la otra persona de cada conversación (RLS: solo las propias abiertas). */
async function counterpartsOf(
  supabase: DbClient,
  userId: string,
  conversationIds: string[]
): Promise<ServiceResult<Map<string, string>>> {
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds)
    .neq("user_id", userId);
  if (error) return mapDbError(error);
  const byConversation = new Map<string, string>();
  for (const row of (data ?? []) as Pick<
    ParticipantRow,
    "conversation_id" | "user_id"
  >[]) {
    byConversation.set(row.conversation_id, row.user_id);
  }
  return ok(byConversation);
}

/** Score guardado en cada match (el de `/matches`), por id de match. */
async function matchScores(
  supabase: DbClient,
  matchIds: string[]
): Promise<ServiceResult<Map<string, number>>> {
  if (matchIds.length === 0) return ok(new Map());
  const { data, error } = await supabase
    .from("matches")
    .select("id, compatibility_score")
    .in("id", matchIds);
  if (error) return mapDbError(error);
  return ok(
    new Map(
      ((data ?? []) as { id: string; compatibility_score: number }[]).map((m) => [
        m.id,
        m.compatibility_score,
      ])
    )
  );
}

/** `/mensajes`: las conversaciones abiertas, la más reciente primero. */
export async function listConversations(
  supabase: DbClient,
  deps?: ChatDeps
): Promise<ServiceResult<ConversationSummary[]>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const own = await supabase
    .from("conversation_participants")
    .select("conversation_id, user_id, last_read_at")
    .eq("user_id", userId)
    .limit(MAX_COUNTERPARTS);
  if (own.error) return mapDbError(own.error);
  const ownRows = (own.data ?? []) as ParticipantRow[];
  if (ownRows.length === 0) return ok([]);
  const ids = ownRows.map((row) => row.conversation_id);

  const [conversationsRead, others] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, match_id, created_at, last_message_at")
      .in("id", ids),
    counterpartsOf(supabase, userId, ids),
  ]);
  if (conversationsRead.error) return mapDbError(conversationsRead.error);
  if (!others.ok) return others;
  const conversations = (conversationsRead.data ?? []) as ConversationRow[];

  const [scores, people] = await Promise.all([
    matchScores(
      supabase,
      conversations.flatMap((c) => (c.match_id ? [c.match_id] : []))
    ),
    evaluateCounterparts(
      supabase,
      [...others.data.values()],
      { requireHardFilters: false },
      deps
    ),
  ]);
  if (!scores.ok) return scores;
  if (!people.ok) return people;

  const lastRead = new Map(ownRows.map((row) => [row.conversation_id, row.last_read_at]));
  const summaries = conversations.flatMap((c): ConversationSummary[] => {
    const otherId = others.data.get(c.id);
    if (!otherId) return [];
    const dto = people.data.byId.get(otherId);
    const score = c.match_id ? scores.data.get(c.match_id) : undefined;
    const read = lastRead.get(c.id) ?? null;
    return [
      {
        id: c.id,
        person: dto ? { ...dto, score: score ?? dto.score } : null,
        lastMessageAt: c.last_message_at,
        createdAt: c.created_at,
        unread:
          c.last_message_at !== null &&
          (read === null || Date.parse(c.last_message_at) > Date.parse(read)),
      },
    ];
  });
  const activity = (s: ConversationSummary) => Date.parse(s.lastMessageAt ?? s.createdAt);
  summaries.sort((a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id));
  return ok(summaries);
}

/** Conversaciones abiertas con mensajes sin leer (para el aviso de la navegación). */
export function unreadCount(conversations: readonly ConversationSummary[]): number {
  return conversations.filter((c) => c.unread).length;
}

function olderFilter(cursor: MessageCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

/**
 * Una página del chat, en orden cronológico. Sin cursor, la más reciente, y
 * deja el chat leído hasta su último mensaje. `not_found` (indistinguible)
 * si el id no es válido, la conversación no existe, es ajena o está cerrada.
 */
export async function getConversation(
  supabase: DbClient,
  rawId: unknown,
  rawCursor?: unknown,
  deps?: ChatDeps
): Promise<ServiceResult<ConversationPage>> {
  const parsed = uuidSchema.safeParse(rawId);
  if (!parsed.success) return fail("not_found");
  const conversationId = parsed.data;
  const cursor = parseMessageCursor(rawCursor);
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const conversationRead = await supabase
    .from("conversations")
    .select("id, match_id, created_at, last_message_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationRead.error) return mapDbError(conversationRead.error);
  const conversation = conversationRead.data as ConversationRow | null;
  if (!conversation) return fail("not_found");

  let messagesQuery = supabase
    .from("messages")
    .select("id, sender_id, content, created_at")
    .eq("conversation_id", conversationId);
  if (cursor) messagesQuery = messagesQuery.or(olderFilter(cursor));
  const [others, messagesRead, ownRead] = await Promise.all([
    counterpartsOf(supabase, userId, [conversationId]),
    messagesQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGES_PAGE_SIZE + 1),
    supabase
      .from("conversation_participants")
      .select("conversation_id, user_id, last_read_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!others.ok) return others;
  if (messagesRead.error) return mapDbError(messagesRead.error);
  if (ownRead.error) return mapDbError(ownRead.error);
  const otherId = others.data.get(conversationId);
  if (!otherId || !ownRead.data) return fail("not_found");

  const [scores, people] = await Promise.all([
    matchScores(supabase, conversation.match_id ? [conversation.match_id] : []),
    evaluateCounterparts(supabase, [otherId], { requireHardFilters: false }, deps),
  ]);
  if (!scores.ok) return scores;
  if (!people.ok) return people;
  const dto = people.data.byId.get(otherId);
  const score = conversation.match_id
    ? scores.data.get(conversation.match_id)
    : undefined;

  const rows = (messagesRead.data ?? []) as MessageRow[];
  const page = rows.slice(0, MESSAGES_PAGE_SIZE);
  const oldest = page[page.length - 1];
  const olderCursor =
    rows.length > MESSAGES_PAGE_SIZE && oldest
      ? encodeMessageCursor({ createdAt: oldest.created_at, id: oldest.id })
      : null;

  // Leído hasta el último mensaje visto (la hora de la base de datos, no la
  // del servidor). Si falla, el chat se muestra igual.
  const newest = page[0];
  const lastRead = (ownRead.data as ParticipantRow).last_read_at;
  if (
    !cursor &&
    newest &&
    (lastRead === null || Date.parse(newest.created_at) > Date.parse(lastRead))
  ) {
    await supabase
      .from("conversation_participants")
      .update({ last_read_at: newest.created_at })
      .eq("conversation_id", conversationId)
      .eq("user_id", userId);
  }

  return ok({
    id: conversationId,
    person: dto ? { ...dto, score: score ?? dto.score } : null,
    otherId,
    messages: page
      .map((m) => ({
        id: m.id,
        mine: m.sender_id === userId,
        content: m.content,
        createdAt: m.created_at,
      }))
      .reverse(),
    olderCursor,
    latest: !cursor,
  });
}

export type SendStatus = "sent" | "duplicate";

const CONTENT_RULES = [
  {
    code: "23514",
    match: "chk_messages_content_length",
    field: "content",
    message: "El mensaje es demasiado largo.",
  },
  {
    code: "23514",
    match: "chk_content_not_empty",
    field: "content",
    message: "Escribe un mensaje antes de enviarlo.",
  },
];

/** Traduce los errores del envío sin exponer su mensaje. */
function mapSendError<T>(error: DbError): ServiceResult<T> {
  const message = error?.message ?? "";
  if (message.includes("rate_limit_exceeded")) return fail("rate_limited");
  // Cerrada entre la comprobación y el envío (se deshizo el match), o la RLS
  // ya no la deja ver: para quien envía, lo mismo que no encontrarla.
  if (message.includes("message_conversation_closed") || error?.code === "42501")
    return fail("not_found");
  // La otra cuenta ya no está activa (o quien envía dejó de ser parte).
  if (message.includes("message_sender_invalid")) return fail("conflict");
  return mapDbError(error, CONTENT_RULES);
}

/**
 * Envía un mensaje. Errores:
 *   - `validation` (con `fieldErrors.content`): vacío o demasiado largo;
 *   - `not_found`: conversación ajena, cerrada o inexistente;
 *   - `conflict`: la otra persona ya no puede recibir mensajes;
 *   - `rate_limited`: 30 mensajes en un minuto;
 *   - los de la cuenta: `unauthenticated`, `no_profile`, `deleted`.
 * Un reenvío con el mismo `clientToken` no duplica: `duplicate`.
 */
export async function sendMessage(
  supabase: DbClient,
  input: unknown
): Promise<ServiceResult<{ status: SendStatus; conversationId: string }>> {
  const parsed = messageInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "content");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return fail("validation", fieldErrors);
  }
  const { conversationId, clientToken, content } = parsed.data;

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

  const visible = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (visible.error) return mapDbError(visible.error);
  if (!visible.data) return fail("not_found");

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: userId,
    content,
    client_token: clientToken,
  });
  if (error) {
    if (
      error.code === "23505" &&
      (error.message ?? "").includes("uq_messages_sender_token")
    ) {
      return ok({ status: "duplicate", conversationId });
    }
    return mapSendError(error);
  }
  return ok({ status: "sent", conversationId });
}
