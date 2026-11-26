import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendInterest: vi.fn(),
  withdrawInterest: vi.fn(),
  requireCompletedQuestionnaire: vi.fn(),
  requireActiveProfile: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ client: true }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireCompletedQuestionnaire: mocks.requireCompletedQuestionnaire,
  requireActiveProfile: mocks.requireActiveProfile,
}));
vi.mock("@/lib/services/interests", () => ({
  sendInterest: mocks.sendInterest,
  withdrawInterest: mocks.withdrawInterest,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { expressInterest, retractInterest } from "@/app/actions/interests";
import { INTEREST_NOTICES, interestNotice } from "@/lib/interests/notices";

// Fase 5.1 — Server Actions de «Me interesa»: orquestación fina. Solo pasan
// al servicio el id de la otra persona; vuelven a la página de origen con un
// aviso de la lista cerrada.

const TARGET = "d0000000-0000-4000-8000-000000000001";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
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
  mocks.requireActiveProfile.mockResolvedValue(undefined);
});

describe("expressInterest", () => {
  it.each([
    ["sent", "/explorar?aviso=enviado"],
    ["already_sent", "/explorar?aviso=ya-enviado"],
    ["matched", "/explorar?aviso=match"],
  ])("%s → %s", async (status, url) => {
    mocks.sendInterest.mockResolvedValue({ ok: true, data: { status } });
    expect(await redirectOf(expressInterest(form({ targetId: TARGET })))).toBe(url);
    expect(mocks.sendInterest).toHaveBeenCalledWith({ client: true }, TARGET);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/explorar");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/matches");
  });

  it("vuelve a /matches o a la página de /explorar indicada", async () => {
    mocks.sendInterest.mockResolvedValue({ ok: true, data: { status: "matched" } });
    expect(
      await redirectOf(
        expressInterest(form({ targetId: TARGET, volver: "matches", pagina: "3" }))
      )
    ).toBe("/matches?aviso=match");
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledWith("/matches");
    expect(
      await redirectOf(
        expressInterest(form({ targetId: TARGET, volver: "explorar", pagina: "3" }))
      )
    ).toBe("/explorar?pagina=3&aviso=match");
    // Destino y página fuera de la lista: /explorar sin página.
    expect(
      await redirectOf(
        expressInterest(
          form({ targetId: TARGET, volver: "https://evil.example", pagina: "0x1" })
        )
      )
    ).toBe("/explorar?aviso=match");
  });

  it.each([
    ["rate_limited", "/explorar?aviso=limite"],
    ["not_found", "/explorar?aviso=no-disponible"],
    ["validation", "/explorar?aviso=no-disponible"],
    ["unknown", "/explorar?aviso=error"],
    ["forbidden", "/test"],
    ["deleted", "/cuenta-desactivada"],
    ["no_profile", "/bienvenida/perfil"],
  ])("error %s → %s", async (error, url) => {
    mocks.sendInterest.mockResolvedValue({ ok: false, error });
    expect(await redirectOf(expressInterest(form({ targetId: TARGET })))).toBe(url);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sin sesión: al login, volviendo a la página", async () => {
    mocks.sendInterest.mockResolvedValue({ ok: false, error: "unauthenticated" });
    expect(await redirectOf(expressInterest(form({ targetId: TARGET })))).toMatch(
      /^\/login/
    );
  });

  it.each([["userId"], ["score"], ["roomId"], ["p_from"]])(
    "un campo no permitido (%s) no llega al servicio",
    async (field) => {
      expect(
        await redirectOf(expressInterest(form({ targetId: TARGET, [field]: "x" })))
      ).toBe("/explorar?aviso=error");
      expect(mocks.sendInterest).not.toHaveBeenCalled();
    }
  );

  it("el guard va antes que el servicio", async () => {
    mocks.requireCompletedQuestionnaire.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { url: "/test" })
    );
    expect(await redirectOf(expressInterest(form({ targetId: TARGET })))).toBe("/test");
    expect(mocks.sendInterest).not.toHaveBeenCalled();
  });
});

describe("retractInterest", () => {
  it.each([
    [{ ok: true, data: { status: "withdrawn" } }, "/matches?aviso=retirado"],
    [{ ok: true, data: { status: "not_found" } }, "/matches?aviso=no-enviado"],
    [{ ok: false, error: "conflict" }, "/matches?aviso=con-match"],
    [{ ok: false, error: "unknown" }, "/matches?aviso=error"],
    [{ ok: false, error: "deleted" }, "/cuenta-desactivada"],
  ])("%j → %s", async (result, url) => {
    mocks.withdrawInterest.mockResolvedValue(result);
    expect(
      await redirectOf(retractInterest(form({ targetId: TARGET, volver: "matches" })))
    ).toBe(url);
    expect(mocks.requireActiveProfile).toHaveBeenCalledWith("/matches");
  });
});

describe("avisos", () => {
  it("solo los códigos de la lista muestran texto", () => {
    expect(interestNotice("match")).toBe(INTEREST_NOTICES.match);
    expect(interestNotice(["retirado", "match"])).toBe(INTEREST_NOTICES.retirado);
    for (const raw of [undefined, "", "toString", "__proto__", "<b>x</b>"]) {
      expect(interestNotice(raw)).toBeNull();
    }
  });
});
