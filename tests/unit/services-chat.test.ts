import { describe, expect, it } from "vitest";
import {
  getConversation,
  listConversations,
  sendMessage,
  unreadCount,
} from "@/lib/services/chat";
import type { MatchingDeps } from "@/lib/services/matching";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";
import {
  MESSAGES_PAGE_SIZE,
  encodeMessageCursor,
  messageInputSchema,
  parseMessageCursor,
} from "@/lib/validation/chat";
import { createFakeSupabase, type Call } from "./helpers/fake-supabase";

// Fase 6 — chat entre matches. El servicio usa solo el cliente del usuario:
// la RLS y el trigger de messages (tests/db/27) deciden el acceso; aquí se
// prueba qué consulta, cómo pagina, cómo marca como leído y cómo traduce los
// errores sin exponerlos.

const VIEWER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-000000000001";
const CONV = "c0000000-0000-4000-8000-000000000001";
const CONV_2 = "c0000000-0000-4000-8000-000000000002";
const MATCH = "f0000000-0000-4000-8000-000000000001";
const TOKEN = "a0000000-0000-4000-8000-000000000001";
const BCN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const housing = () => ({
  city_id: BCN,
  university_id: null,
  budget_min: null,
  budget_max: null,
  move_in_date: null,
  move_out_date: null,
  preferred_neighborhood_ids: [],
  roommates_wanted_min: null,
  roommates_wanted_max: null,
});
const response = () => ({
  questionnaire_version: CURRENT_QUESTIONNAIRE_VERSION,
  answers: Object.fromEntries(getCurrentQuestionnaire().questions.map((q) => [q.id, 1])),
  completed_at: "2026-10-02T10:00:00Z",
});
const person = (id: string) => ({
  id,
  full_name: "Otra Persona",
  date_of_birth: "2001-03-15",
  role: "user",
  deleted_at: null,
  onboarding_completed_at: "2026-10-01T10:00:00Z",
  housing_preferences: housing(),
  compatibility_responses: response(),
});

const message = (n: number, sender = n % 2 ? VIEWER : OTHER) => ({
  id: `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sender_id: sender,
  content: `Mensaje ${n}`,
  created_at: new Date(Date.UTC(2026, 10, 20, 10, 0, n)).toISOString(),
});

type Options = {
  userId?: string | null;
  deleted?: boolean;
  visible?: boolean;
  messages?: unknown[];
  lastReadAt?: string | null;
  insertError?: { code?: string; message?: string } | null;
  ownParticipants?: unknown[];
  conversations?: unknown[];
  others?: unknown[];
  people?: unknown[];
};

function setup(options: Options = {}) {
  const visible = options.visible ?? true;
  const user = createFakeSupabase({
    userId: options.userId === undefined ? VIEWER : options.userId,
    respond: (call: Call) => {
      if (call.table === "profiles")
        return {
          data: {
            id: VIEWER,
            deleted_at: options.deleted ? "2026-11-01T00:00:00Z" : null,
            onboarding_completed_at: "2026-10-01T10:00:00Z",
          },
          error: null,
        };
      if (call.table === "housing_preferences") return { data: housing(), error: null };
      if (call.table === "compatibility_responses")
        return { data: response(), error: null };
      if (call.table === "conversations") {
        if (call.terminal === "maybeSingle")
          return {
            data: visible
              ? {
                  id: CONV,
                  match_id: MATCH,
                  created_at: "2026-11-20T09:00:00Z",
                  last_message_at: null,
                }
              : null,
            error: null,
          };
        return { data: options.conversations ?? [], error: null };
      }
      if (call.table === "conversation_participants") {
        if (call.operation === "update") return { data: null, error: null };
        if (call.terminal === "maybeSingle")
          return {
            data: visible
              ? {
                  conversation_id: CONV,
                  user_id: VIEWER,
                  last_read_at: options.lastReadAt ?? null,
                }
              : null,
            error: null,
          };
        if (call.filters.some((f) => f.kind === "neq"))
          return {
            data:
              options.others ??
              (visible ? [{ conversation_id: CONV, user_id: OTHER }] : []),
            error: null,
          };
        return { data: options.ownParticipants ?? [], error: null };
      }
      if (call.table === "messages") {
        if (call.operation === "insert")
          return { data: null, error: options.insertError ?? null };
        return { data: options.messages ?? [], error: null };
      }
      if (call.table === "matches")
        return { data: [{ id: MATCH, compatibility_score: 72 }], error: null };
      if (call.table === "universities" || call.table === "neighborhoods")
        return { data: [], error: null };
      return { data: null, error: null };
    },
  });
  const admin = createFakeSupabase({
    userId: null,
    respond: (call) => {
      const ids = (call.filters.find((f) => f.kind === "in")?.value ?? []) as string[];
      const rows = (options.people ?? [person(OTHER)]) as Array<{ id: string }>;
      return { data: rows.filter((r) => ids.includes(r.id)), error: null };
    },
  });
  const deps: MatchingDeps = {
    adminClient: () => admin.client,
    today: () => "2026-11-25",
  };
  return { user, admin, deps };
}

const input = (content: unknown = "Hola, ¿qué tal?") => ({
  conversationId: CONV,
  clientToken: TOKEN,
  content,
});

describe("validación de mensajes", () => {
  it("quita espacios, normaliza saltos de línea y acepta 2000 caracteres justos", () => {
    expect(messageInputSchema.parse(input("  hola\r\nadiós  ")).content).toBe(
      "hola\nadiós"
    );
    expect(messageInputSchema.safeParse(input("😀".repeat(2000))).success).toBe(true);
  });

  it.each([
    ["vacío", "   "],
    ["más de 2000 caracteres (contados como code points)", "😀".repeat(2001)],
    ["no es texto", 42],
  ])("rechaza un mensaje %s", (_, content) => {
    expect(messageInputSchema.safeParse(input(content)).success).toBe(false);
  });

  it("rechaza campos de más (el remitente nunca llega del navegador)", () => {
    expect(messageInputSchema.safeParse({ ...input(), senderId: OTHER }).success).toBe(
      false
    );
  });

  it("cursor: ida y vuelta, y cualquier otra cosa es «sin cursor»", () => {
    const cursor = { createdAt: "2026-11-20T10:00:01.123456+00:00", id: CONV };
    expect(parseMessageCursor(encodeMessageCursor(cursor))).toEqual(cursor);
    for (const raw of [
      undefined,
      "",
      "x_y",
      `2026-11-20T10:00:01Z_no-uuid`,
      `2026-13-45T99:00:00Z_${CONV}`,
      `created_at.lt.2026),or(id.gt.0_${CONV}`,
      ["a", "b"],
    ]) {
      expect(parseMessageCursor(raw)).toBeNull();
    }
  });
});

describe("sendMessage", () => {
  it("inserta con el cliente del usuario, con el remitente de la sesión", async () => {
    const s = setup();
    expect(await sendMessage(s.user.client, input("  Hola  "))).toEqual({
      ok: true,
      data: { status: "sent", conversationId: CONV },
    });
    const insert = s.user.calls.find((c) => c.operation === "insert");
    expect(insert?.table).toBe("messages");
    expect(insert?.payload).toEqual({
      conversation_id: CONV,
      sender_id: VIEWER,
      content: "Hola",
      client_token: TOKEN,
    });
  });

  it("un reenvío con el mismo client_token no duplica: duplicate", async () => {
    const s = setup({
      insertError: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "uq_messages_sender_token"',
      },
    });
    expect(await sendMessage(s.user.client, input())).toEqual({
      ok: true,
      data: { status: "duplicate", conversationId: CONV },
    });
  });

  it("una conversación ajena, cerrada o inexistente: not_found, sin insertar", async () => {
    const s = setup({ visible: false });
    expect(await sendMessage(s.user.client, input())).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(s.user.calls.some((c) => c.operation === "insert")).toBe(false);
  });

  it.each([
    ["message_conversation_closed: cerrada", "23514", "not_found"],
    ["message_sender_invalid: cuenta desactivada", "23514", "conflict"],
    ["rate_limit_exceeded: demasiados mensajes", "P0001", "rate_limited"],
    ["new row violates row-level security policy", "42501", "not_found"],
    ["otra cosa", "XX000", "unknown"],
  ])("traduce «%s» sin exponer el mensaje", async (message, code, expected) => {
    const s = setup({ insertError: { code, message } });
    const result = await sendMessage(s.user.client, input());
    expect(result).toEqual({ ok: false, error: expected });
    expect(JSON.stringify(result)).not.toContain(message);
  });

  it("el CHECK de longitud de la base de datos es un error del campo", async () => {
    const s = setup({
      insertError: {
        code: "23514",
        message: 'new row violates check constraint "chk_messages_content_length"',
      },
    });
    expect(await sendMessage(s.user.client, input())).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { content: ["El mensaje es demasiado largo."] },
    });
  });

  it("vacío o con datos inválidos: validation, sin consultas", async () => {
    const s = setup();
    const result = await sendMessage(s.user.client, input(""));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation");
      expect(result.fieldErrors?.content).toBeDefined();
    }
    expect(s.user.calls).toHaveLength(0);
  });

  it("sin sesión o con la cuenta desactivada: sin insertar", async () => {
    const anon = setup({ userId: null });
    expect(await sendMessage(anon.user.client, input())).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    const deleted = setup({ deleted: true });
    expect(await sendMessage(deleted.user.client, input())).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(deleted.user.calls.some((c) => c.operation === "insert")).toBe(false);
  });
});

describe("getConversation", () => {
  it("página más reciente en orden cronológico, solo «mío / suyo», y la marca como leída", async () => {
    const rows = [message(3), message(2), message(1)];
    const s = setup({ messages: rows });
    const result = await getConversation(s.user.client, CONV, undefined, s.deps);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.messages.map((m) => [m.content, m.mine])).toEqual([
      ["Mensaje 1", true],
      ["Mensaje 2", false],
      ["Mensaje 3", true],
    ]);
    for (const m of result.data.messages) expect(m).not.toHaveProperty("sender_id");
    expect(result.data.person?.score).toBe(72);
    expect(result.data.olderCursor).toBeNull();
    expect(result.data.latest).toBe(true);

    const read = s.user.calls.find((c) => c.table === "messages");
    expect(read?.columns).toBe("id, sender_id, content, created_at");
    expect(read?.order).toEqual(["created_at.desc", "id.desc"]);
    expect(read?.limit).toBe(MESSAGES_PAGE_SIZE + 1);
    const update = s.user.calls.find((c) => c.operation === "update");
    expect(update?.table).toBe("conversation_participants");
    expect(update?.payload).toEqual({ last_read_at: rows[0].created_at });
    expect(update?.filters).toEqual([
      { kind: "eq", column: "conversation_id", value: CONV },
      { kind: "eq", column: "user_id", value: VIEWER },
    ]);
  });

  it("con más de una página: cursor del más antiguo y filtro de keyset al pedir los anteriores", async () => {
    const rows = Array.from({ length: MESSAGES_PAGE_SIZE + 1 }, (_, i) =>
      message(MESSAGES_PAGE_SIZE + 1 - i)
    );
    const s = setup({ messages: rows });
    const first = await getConversation(s.user.client, CONV, undefined, s.deps);
    if (!first.ok) throw new Error(first.error);
    expect(first.data.messages).toHaveLength(MESSAGES_PAGE_SIZE);
    const oldest = rows[MESSAGES_PAGE_SIZE - 1];
    expect(first.data.olderCursor).toBe(`${oldest.created_at}_${oldest.id}`);

    const t = setup({ messages: [message(1)] });
    const older = await getConversation(
      t.user.client,
      CONV,
      first.data.olderCursor,
      t.deps
    );
    if (!older.ok) throw new Error(older.error);
    expect(older.data.latest).toBe(false);
    const read = t.user.calls.find((c) => c.table === "messages");
    expect(read?.filters).toContainEqual({
      kind: "or",
      column: "",
      value: `created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`,
    });
    // Ver mensajes antiguos no cambia lo leído.
    expect(t.user.calls.some((c) => c.operation === "update")).toBe(false);
  });

  it("ya leído hasta el último mensaje: no vuelve a escribir", async () => {
    const rows = [message(2), message(1)];
    const s = setup({ messages: rows, lastReadAt: rows[0].created_at });
    await getConversation(s.user.client, CONV, undefined, s.deps);
    expect(s.user.calls.some((c) => c.operation === "update")).toBe(false);
  });

  it.each([
    ["un id no válido", "no-es-un-id"],
    ["una conversación ajena, cerrada o inexistente", CONV],
  ])("%s: not_found indistinguible", async (_, id) => {
    const s = setup({ visible: false });
    expect(await getConversation(s.user.client, id, undefined, s.deps)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(s.user.calls.some((c) => c.operation !== "select")).toBe(false);
  });

  it("la otra cuenta ya no está disponible: el chat se ve, sin persona", async () => {
    const s = setup({ people: [] });
    const result = await getConversation(s.user.client, CONV, undefined, s.deps);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.person).toBeNull();
    expect(result.data.otherId).toBe(OTHER);
  });
});

describe("listConversations", () => {
  it("las abiertas, la más reciente primero, con «sin leer» y sin vista previa", async () => {
    const s = setup({
      ownParticipants: [
        { conversation_id: CONV, user_id: VIEWER, last_read_at: "2026-11-20T10:00:00Z" },
        { conversation_id: CONV_2, user_id: VIEWER, last_read_at: null },
      ],
      conversations: [
        {
          id: CONV,
          match_id: MATCH,
          created_at: "2026-11-19T10:00:00Z",
          last_message_at: "2026-11-21T10:00:00Z",
        },
        {
          id: CONV_2,
          match_id: MATCH,
          created_at: "2026-11-22T10:00:00Z",
          last_message_at: null,
        },
      ],
      others: [
        { conversation_id: CONV, user_id: OTHER },
        { conversation_id: CONV_2, user_id: OTHER },
      ],
    });
    const result = await listConversations(s.user.client, s.deps);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.map((c) => [c.id, c.unread])).toEqual([
      [CONV_2, false],
      [CONV, true],
    ]);
    expect(unreadCount(result.data)).toBe(1);
    expect(result.data[0]).not.toHaveProperty("lastMessage");
    expect(s.user.calls.some((c) => c.table === "messages")).toBe(false);
    expect(s.user.calls.some((c) => c.operation !== "select")).toBe(false);
  });

  it("sin conversaciones: lista vacía, sin más consultas", async () => {
    const s = setup();
    expect(await listConversations(s.user.client, s.deps)).toEqual({
      ok: true,
      data: [],
    });
    expect(s.user.calls).toHaveLength(1);
    expect(s.admin.calls).toHaveLength(0);
  });

  it("sin sesión: unauthenticated", async () => {
    const s = setup({ userId: null });
    expect(await listConversations(s.user.client, s.deps)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
});
