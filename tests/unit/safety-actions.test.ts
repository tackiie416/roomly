import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  reportUser: vi.fn(),
  reportRoom: vi.fn(),
  resolveReport: vi.fn(),
  requireCompletedQuestionnaire: vi.fn(),
  requireActiveProfile: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ client: true }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireCompletedQuestionnaire: mocks.requireCompletedQuestionnaire,
  requireActiveProfile: mocks.requireActiveProfile,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/services/interests", () => ({
  blockUser: mocks.blockUser,
  unblockUser: mocks.unblockUser,
}));
vi.mock("@/lib/services/reports", () => ({
  reportUser: mocks.reportUser,
  reportRoom: mocks.reportRoom,
  resolveReport: mocks.resolveReport,
}));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({ visitor: true }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { url: "404" });
  },
}));

import {
  blockUserAction,
  reportRoomAction,
  reportUserAction,
  unblockUserAction,
} from "@/app/actions/safety";
import { resolveReportAction } from "@/app/actions/admin-reports";
import { SAFETY_NOTICES, safetyNotice } from "@/lib/safety/notices";

// Sesión 83 — bloquear, desbloquear, reportar y resolver reportes:
// orquestación fina. Del navegador solo llegan los campos de la lista; quién
// bloquea, reporta o resuelve sale de la sesión.

const TARGET = "d0000000-0000-4000-8000-000000000001";
const REPORT = "e0000000-0000-4000-8000-000000000001";
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
  mocks.requireAdmin.mockResolvedValue(undefined);
});

describe("blockUserAction y unblockUserAction", () => {
  it.each([
    ["blocked", "/ajustes/bloqueos?aviso=bloqueado"],
    ["already_blocked", "/ajustes/bloqueos?aviso=ya-bloqueado"],
  ])("%s → %s", async (status, url) => {
    mocks.blockUser.mockResolvedValue({ ok: true, data: { status } });
    expect(await redirectOf(blockUserAction(form({ targetId: TARGET })))).toBe(url);
    expect(mocks.blockUser).toHaveBeenCalledWith({ client: true }, TARGET);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/explorar", "layout");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mensajes", "layout");
  });

  it.each([
    ["not_found", "/ajustes/bloqueos?aviso=no-disponible"],
    ["rate_limited", "/ajustes/bloqueos?aviso=limite"],
    ["unknown", "/ajustes/bloqueos?aviso=error"],
    ["deleted", "/cuenta-desactivada"],
    ["forbidden", "/test"],
  ])("%s → %s", async (error, url) => {
    mocks.blockUser.mockResolvedValue({ ok: false, error });
    expect(await redirectOf(blockUserAction(form({ targetId: TARGET })))).toBe(url);
  });

  it("campos de más (quién bloquea): error, sin llamar al servicio", async () => {
    expect(
      await redirectOf(blockUserAction(form({ targetId: TARGET, blockerId: TARGET })))
    ).toBe("/ajustes/bloqueos?aviso=error");
    expect(mocks.blockUser).not.toHaveBeenCalled();
  });

  it.each([
    ["unblocked", "/ajustes/bloqueos?aviso=desbloqueado"],
    ["not_found", "/ajustes/bloqueos?aviso=no-bloqueado"],
  ])("desbloquear: %s → %s", async (status, url) => {
    mocks.unblockUser.mockResolvedValue({ ok: true, data: { status } });
    expect(await redirectOf(unblockUserAction(form({ targetId: TARGET })))).toBe(url);
    expect(mocks.requireActiveProfile).toHaveBeenCalledWith("/ajustes/bloqueos");
  });
});

describe("reportUserAction", () => {
  const reportForm = (extra: Record<string, string> = {}) =>
    form({ targetId: TARGET, reason: "harassment", description: "texto", ...extra });

  it.each([
    ["created", `/reportar/${TARGET}?aviso=reportado`],
    ["duplicate", `/reportar/${TARGET}?aviso=ya-reportado`],
  ])("%s → %s", async (status, url) => {
    mocks.reportUser.mockResolvedValue({ ok: true, data: { status } });
    expect(await redirectOf(reportUserAction(reportForm()))).toBe(url);
    expect(mocks.reportUser).toHaveBeenCalledWith(
      { client: true },
      { targetId: TARGET, reason: "harassment", description: "texto" }
    );
    expect(mocks.blockUser).not.toHaveBeenCalled();
  });

  it("con «Bloquear también»: reporta y después bloquea", async () => {
    mocks.reportUser.mockResolvedValue({ ok: true, data: { status: "created" } });
    mocks.blockUser.mockResolvedValue({ ok: true, data: { status: "blocked" } });
    expect(await redirectOf(reportUserAction(reportForm({ bloquear: "1" })))).toBe(
      "/ajustes/bloqueos?aviso=bloqueado-reportado"
    );
    expect(mocks.blockUser).toHaveBeenCalledWith({ client: true }, TARGET);
  });

  it("si el bloqueo falla, el reporte ya está guardado y se dice", async () => {
    mocks.reportUser.mockResolvedValue({ ok: true, data: { status: "created" } });
    mocks.blockUser.mockResolvedValue({ ok: false, error: "rate_limited" });
    expect(await redirectOf(reportUserAction(reportForm({ bloquear: "1" })))).toBe(
      `/reportar/${TARGET}?aviso=reportado`
    );
  });

  it.each([
    [{ reason: ["Elige un motivo."] }, `/reportar/${TARGET}?error=motivo`],
    [{ description: ["Larga."] }, `/reportar/${TARGET}?error=descripcion`],
  ])("validación %j → %s", async (fieldErrors, url) => {
    mocks.reportUser.mockResolvedValue({ ok: false, error: "validation", fieldErrors });
    expect(await redirectOf(reportUserAction(reportForm()))).toBe(url);
  });

  it.each([
    ["not_found", "/matches?aviso=no-disponible"],
    ["rate_limited", `/reportar/${TARGET}?aviso=limite`],
    ["unknown", `/reportar/${TARGET}?aviso=error`],
  ])("%s → %s", async (error, url) => {
    mocks.reportUser.mockResolvedValue({ ok: false, error });
    expect(await redirectOf(reportUserAction(reportForm()))).toBe(url);
  });

  it("campos de más (quién reporta): error, sin llamar al servicio", async () => {
    expect(await redirectOf(reportUserAction(reportForm({ reporterId: TARGET })))).toBe(
      `/reportar/${TARGET}?aviso=error`
    );
    expect(mocks.reportUser).not.toHaveBeenCalled();
  });

  it("un id manipulado no llega a la ruta de vuelta", async () => {
    mocks.reportUser.mockResolvedValue({ ok: false, error: "unauthenticated" });
    expect(await redirectOf(reportUserAction(form({ targetId: "//evil.example" })))).toBe(
      "/login?next=%2Fmatches"
    );
  });

  it("los avisos están en una lista cerrada", () => {
    expect(safetyNotice("inventado")).toBeNull();
    expect(safetyNotice("reportado")).toBe(SAFETY_NOTICES.reportado);
    // El aviso de bloqueo nunca dice que se avisa a la otra persona.
    expect(SAFETY_NOTICES.bloqueado).toContain("No se le avisa");
  });
});

describe("resolveReportAction", () => {
  it("resuelve con el guard de admin y vuelve a la vista que toca", async () => {
    mocks.resolveReport.mockResolvedValue({ ok: true, data: { status: "resolved" } });
    expect(
      await redirectOf(
        resolveReportAction(form({ reportId: REPORT, status: "resolved", notes: "ok" }))
      )
    ).toBe("/admin/reportes?aviso=guardado&vista=cerrados");
    expect(mocks.requireAdmin).toHaveBeenCalled();
    mocks.resolveReport.mockResolvedValue({ ok: true, data: { status: "in_review" } });
    expect(
      await redirectOf(
        resolveReportAction(form({ reportId: REPORT, status: "in_review" }))
      )
    ).toBe("/admin/reportes?aviso=guardado");
  });

  it("sin admin, el guard redirige antes de llamar al servicio", async () => {
    mocks.requireAdmin.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { url: "/" })
    );
    expect(
      await redirectOf(
        resolveReportAction(form({ reportId: REPORT, status: "resolved" }))
      )
    ).toBe("/");
    expect(mocks.resolveReport).not.toHaveBeenCalled();
  });

  it("campos de más (resolved_by): error, sin llamar al servicio", async () => {
    expect(
      await redirectOf(
        resolveReportAction(
          form({ reportId: REPORT, status: "resolved", resolvedBy: REPORT })
        )
      )
    ).toBe("/admin/reportes?aviso=error");
    expect(mocks.resolveReport).not.toHaveBeenCalled();
  });
});

describe("reportRoomAction", () => {
  const ROOM = "f0000000-0000-4000-8000-000000000001";
  const page = `/reportar/habitacion/${ROOM}`;

  it.each([
    ["created", "anuncio-reportado"],
    ["duplicate", "anuncio-ya-reportado"],
  ])("%s → %s, con la sesión y el cliente de visitante", async (status, notice) => {
    mocks.reportRoom.mockResolvedValue({ ok: true, data: { status } });
    expect(
      await redirectOf(reportRoomAction(form({ roomId: ROOM, reason: "scam" })))
    ).toBe(`${page}?aviso=${notice}`);
    expect(mocks.requireActiveProfile).toHaveBeenCalledWith(page);
    expect(mocks.reportRoom).toHaveBeenCalledWith(
      { client: true },
      { visitor: true },
      { roomId: ROOM, reason: "scam", description: "" }
    );
  });

  it("un reporter_id o un reported_user_id inyectado: error sin llamar al servicio", async () => {
    for (const extra of ["reporterId", "reported_user_id"])
      expect(
        await redirectOf(
          reportRoomAction(form({ roomId: ROOM, reason: "scam", [extra]: ROOM }))
        )
      ).toBe(`${page}?aviso=error`);
    expect(mocks.reportRoom).not.toHaveBeenCalled();
  });

  it("un id que no es UUID: 404 sin guard ni servicio", async () => {
    expect(
      await redirectOf(reportRoomAction(form({ roomId: "x", reason: "scam" })))
    ).toBe("404");
    expect(mocks.reportRoom).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", "404"],
    ["rate_limited", `${page}?aviso=limite`],
    ["deleted", "/cuenta-desactivada"],
    ["unknown", `${page}?aviso=error`],
  ])("%s → %s", async (error, url) => {
    mocks.reportRoom.mockResolvedValue({ ok: false, error });
    expect(
      await redirectOf(reportRoomAction(form({ roomId: ROOM, reason: "scam" })))
    ).toBe(url);
  });

  it("validación del motivo: vuelve con el error del campo", async () => {
    mocks.reportRoom.mockResolvedValue({
      ok: false,
      error: "validation",
      fieldErrors: { reason: ["Elige un motivo."] },
    });
    expect(await redirectOf(reportRoomAction(form({ roomId: ROOM })))).toBe(
      `${page}?error=motivo`
    );
  });
});
