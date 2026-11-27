import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  requireCompletedQuestionnaire: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ client: true }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireCompletedQuestionnaire: mocks.requireCompletedQuestionnaire,
}));
vi.mock("@/lib/services/chat", () => ({ sendMessage: mocks.sendMessage }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { sendChatMessage } from "@/app/actions/chat";
import { CHAT_NOTICES, chatNotice } from "@/lib/chat/notices";

// Fase 6 — Server Action del chat: orquestación fina. Solo pasa al servicio
// la conversación, el token y el texto (nunca el remitente) y vuelve al chat
// con un aviso de la lista cerrada.

const CONV = "c0000000-0000-4000-8000-000000000001";
const TOKEN = "a0000000-0000-4000-8000-000000000001";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const message = (extra: Record<string, string> = {}) =>
  form({ conversationId: CONV, clientToken: TOKEN, content: "Hola", ...extra });
const redirectOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { url?: string }).url;
  }
  throw new Error("sin redirect");
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireCompletedQuestionnaire.mockResolvedValue(undefined);
});

describe("sendChatMessage", () => {
  it.each(["sent", "duplicate"])(
    "%s → vuelve al chat, al último mensaje",
    async (status) => {
      mocks.sendMessage.mockResolvedValue({
        ok: true,
        data: { status, conversationId: CONV },
      });
      expect(await redirectOf(sendChatMessage(message()))).toBe(
        `/mensajes/${CONV}#ultimo`
      );
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        { client: true },
        { conversationId: CONV, clientToken: TOKEN, content: "Hola" }
      );
      expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledWith(
        `/mensajes/${CONV}`
      );
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/mensajes", "layout");
    }
  );

  it.each([
    [{ ok: false, error: "not_found" }, "/mensajes?aviso=cerrado"],
    [{ ok: false, error: "conflict" }, `/mensajes/${CONV}?aviso=no-disponible#escribir`],
    [{ ok: false, error: "rate_limited" }, `/mensajes/${CONV}?aviso=limite#escribir`],
    [{ ok: false, error: "unknown" }, `/mensajes/${CONV}?aviso=error#escribir`],
    [
      {
        ok: false,
        error: "validation",
        fieldErrors: { content: ["Escribe un mensaje antes de enviarlo."] },
      },
      `/mensajes/${CONV}?aviso=vacio#escribir`,
    ],
    [
      {
        ok: false,
        error: "validation",
        fieldErrors: { content: ["El mensaje no puede tener más de 2000 caracteres."] },
      },
      `/mensajes/${CONV}?aviso=largo#escribir`,
    ],
    [{ ok: false, error: "unauthenticated" }, `/login?next=%2Fmensajes%2F${CONV}`],
    [{ ok: false, error: "deleted" }, "/cuenta-desactivada"],
  ])("%j → %s", async (result, url) => {
    mocks.sendMessage.mockResolvedValue(result);
    expect(await redirectOf(sendChatMessage(message()))).toBe(url);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("campos de más (por ejemplo, el remitente): error, sin llamar al servicio", async () => {
    expect(await redirectOf(sendChatMessage(message({ senderId: TOKEN })))).toBe(
      `/mensajes/${CONV}?aviso=error#escribir`
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("una conversación que no es un UUID vuelve a /mensajes", async () => {
    mocks.sendMessage.mockResolvedValue({
      ok: false,
      error: "validation",
      fieldErrors: { conversationId: ["Identificador no válido"] },
    });
    expect(
      await redirectOf(sendChatMessage(message({ conversationId: "../../admin" })))
    ).toBe("/mensajes?aviso=cerrado");
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledWith("/mensajes");
  });

  it("los avisos son de una lista cerrada", () => {
    expect(chatNotice("limite")).toBe(CHAT_NOTICES.limite);
    expect(chatNotice("<script>")).toBeNull();
    expect(chatNotice(undefined)).toBeNull();
  });
});
