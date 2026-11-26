import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CandidateDTO } from "@/lib/services/matching";

const mocks = vi.hoisted(() => ({
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  requireCompletedQuestionnaire: vi.fn(),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({
  requireCompletedQuestionnaire: mocks.requireCompletedQuestionnaire,
}));
vi.mock("@/lib/services/chat", () => ({
  listConversations: mocks.listConversations,
  getConversation: mocks.getConversation,
}));
vi.mock("@/app/actions/chat", () => ({ sendChatMessage: async () => {} }));
vi.mock("@/app/actions/interests", () => ({ undoMatchAction: async () => {} }));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: () => {} }),
}));

import MessagesPage from "@/app/(app)/mensajes/page";
import ConversationPage, { dynamic } from "@/app/(app)/mensajes/[conversationId]/page";

// Fase 6 — páginas del chat. Los servicios se prueban en services-chat.

const CONV = "c0000000-0000-4000-8000-000000000001";
const OTHER = "d0000000-0000-4000-8000-000000000001";
const person = (): CandidateDTO => ({
  id: OTHER,
  fullName: "Ana Pérez",
  age: 24,
  university: null,
  neighborhoods: [],
  neighborhoodsTotal: 0,
  budgetRange: null,
  score: 81,
  strengths: [],
  differences: [],
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if ("mockReset" in mock && mock !== mocks.notFound) mock.mockReset();
  }
  mocks.requireCompletedQuestionnaire.mockResolvedValue(undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("NEXT_PUBLIC_CHAT_REALTIME", "");
});

const renderList = async (aviso?: string) =>
  renderToStaticMarkup(
    await MessagesPage({ searchParams: Promise.resolve(aviso ? { aviso } : {}) })
  );
const renderChat = async (query: Record<string, string> = {}, id = CONV) =>
  renderToStaticMarkup(
    await ConversationPage({
      params: Promise.resolve({ conversationId: id }),
      searchParams: Promise.resolve(query),
    })
  );

describe("/mensajes", () => {
  it("estado vacío con enlace a los matches", async () => {
    mocks.listConversations.mockResolvedValue({ ok: true, data: [] });
    const html = await renderList();
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledWith("/mensajes");
    expect(html).toContain('data-testid="conversations-empty"');
    expect(html).toContain('href="/matches"');
  });

  it("lista con «Nuevo» en las que tienen mensajes sin leer, y el aviso de la lista cerrada", async () => {
    mocks.listConversations.mockResolvedValue({
      ok: true,
      data: [
        {
          id: CONV,
          person: person(),
          lastMessageAt: "2026-11-25T10:00:00Z",
          createdAt: "2026-11-20T10:00:00Z",
          unread: true,
        },
        {
          id: "c0000000-0000-4000-8000-000000000002",
          person: null,
          lastMessageAt: null,
          createdAt: "2026-11-19T10:00:00Z",
          unread: false,
        },
      ],
    });
    const html = await renderList("cerrado");
    expect(html).toContain(`href="/mensajes/${CONV}"`);
    expect(html).toContain("Ana Pérez");
    expect(html).toContain("Persona no disponible");
    expect(html).toContain("Sin mensajes todavía");
    expect(html.match(/data-testid="unread"/g)).toHaveLength(1);
    expect(html).toContain("Esa conversación ya no está disponible.");
  });

  it("un error de carga no muestra detalles", async () => {
    mocks.listConversations.mockResolvedValue({ ok: false, error: "unknown" });
    await expect(renderList()).rejects.toThrow("No hemos podido cargar tus mensajes");
  });
});

describe("/mensajes/<id>", () => {
  const chat = (overrides = {}) => ({
    ok: true,
    data: {
      id: CONV,
      person: person(),
      otherId: OTHER,
      messages: [
        {
          id: "m1",
          mine: false,
          content: "Hola <b>Juan</b>",
          createdAt: "2026-11-25T09:00:00Z",
        },
        { id: "m2", mine: true, content: "¡Hola!", createdAt: "2026-11-25T09:01:00Z" },
      ],
      olderCursor: "2026-11-25T09:00:00Z_m1",
      latest: true,
      ...overrides,
    },
  });

  it("es dinámica", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("mensajes en orden, escapados, con formulario y deshacer match", async () => {
    mocks.getConversation.mockResolvedValue(chat());
    const html = await renderChat();
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledWith(`/mensajes/${CONV}`);
    expect(html.indexOf("Hola &lt;b&gt;Juan&lt;/b&gt;")).toBeLessThan(
      html.indexOf("¡Hola!")
    );
    expect(html).not.toContain("<b>Juan</b>");
    expect(html).toContain('data-testid="message-theirs"');
    expect(html).toContain('data-testid="message-mine"');
    expect(html).toContain('id="ultimo"');
    expect(html).toContain('maxLength="2000"');
    expect(html).toMatch(/name="clientToken" value="[0-9a-f-]{36}"/);
    expect(html).toContain(`name="conversationId" value="${CONV}"`);
    expect(html).not.toContain("senderId");
    expect(html).toContain(
      `href="/mensajes/${CONV}?antes=${encodeURIComponent("2026-11-25T09:00:00Z_m1")}"`
    );
    expect(html).toContain('data-testid="undo-match"');
    expect(html).toContain(`href="/explorar/${OTHER}"`);
    // Realtime desactivado por defecto: sin suscripción, con «Actualizar».
    expect(html).toContain('data-testid="chat-refresh"');
  });

  it("cada vez, un clientToken nuevo", async () => {
    mocks.getConversation.mockResolvedValue(chat());
    const token = (html: string) => html.match(/name="clientToken" value="([^"]+)"/)?.[1];
    expect(token(await renderChat())).not.toBe(token(await renderChat()));
  });

  it("sin mensajes: estado vacío", async () => {
    mocks.getConversation.mockResolvedValue(chat({ messages: [], olderCursor: null }));
    const html = await renderChat();
    expect(html).toContain('data-testid="chat-empty"');
    expect(html).not.toContain('data-testid="older-messages"');
  });

  it("la otra cuenta ya no está disponible: sin formulario de envío", async () => {
    mocks.getConversation.mockResolvedValue(chat({ person: null }));
    const html = await renderChat();
    expect(html).toContain("Esta cuenta ya no está disponible");
    expect(html).not.toContain('name="content"');
  });

  it("ajena, cerrada o inexistente: 404", async () => {
    mocks.getConversation.mockResolvedValue({ ok: false, error: "not_found" });
    await expect(renderChat()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderChat({}, "no-es-un-id")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenLastCalledWith("/mensajes");
  });

  it("un aviso inventado no se muestra; uno de la lista, sí", async () => {
    mocks.getConversation.mockResolvedValue(chat());
    expect(await renderChat({ aviso: "<script>" })).not.toContain(
      'data-testid="chat-notice"'
    );
    expect(await renderChat({ aviso: "limite" })).toContain("Espera un minuto");
  });
});
