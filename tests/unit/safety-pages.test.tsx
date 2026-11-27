import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  knownCounterpart: vi.fn(),
  listBlockedPeople: vi.fn(),
  listReportsForAdmin: vi.fn(),
  requireCompletedQuestionnaire: vi.fn(),
  requireActiveProfile: vi.fn(),
  requireAdmin: vi.fn(),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({
  SETTINGS_PATH: "/ajustes",
  requireCompletedQuestionnaire: mocks.requireCompletedQuestionnaire,
  requireActiveProfile: mocks.requireActiveProfile,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/services/interests", () => ({
  knownCounterpart: mocks.knownCounterpart,
  listBlockedPeople: mocks.listBlockedPeople,
}));
vi.mock("@/lib/services/reports", () => ({
  listReportsForAdmin: mocks.listReportsForAdmin,
}));
vi.mock("@/app/actions/safety", () => ({
  blockUserAction: async () => {},
  unblockUserAction: async () => {},
  reportUserAction: async () => {},
}));
vi.mock("@/app/actions/admin-reports", () => ({ resolveReportAction: async () => {} }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import ReportPage from "@/app/(app)/reportar/[id]/page";
import BlockedPeoplePage from "@/app/(app)/ajustes/bloqueos/page";
import AdminReportsPage from "@/app/admin/reportes/page";
import { SafetyActions } from "@/components/safety/safety-actions";

// Sesión 83 — páginas de bloquear y reportar. Los servicios, en
// services-safety; las Server Actions, en safety-actions.

const TARGET = "d0000000-0000-4000-8000-000000000001";
const REPORTER = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (mock !== mocks.notFound) mock.mockReset();
  }
  mocks.requireCompletedQuestionnaire.mockResolvedValue(undefined);
  mocks.requireActiveProfile.mockResolvedValue(undefined);
  mocks.requireAdmin.mockResolvedValue(undefined);
});

const renderReport = async (query: Record<string, string> = {}, id = TARGET) =>
  renderToStaticMarkup(
    await ReportPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(query),
    })
  );

describe("/reportar/<id>", () => {
  it("formulario con los seis motivos, descripción opcional y «Bloquear también»", async () => {
    mocks.knownCounterpart.mockResolvedValue({
      ok: true,
      data: { userId: REPORTER, targetId: TARGET, name: "Ana Pérez" },
    });
    const html = await renderReport();
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledWith(
      `/reportar/${TARGET}`
    );
    expect(html).toContain("Reportar a Ana Pérez");
    expect(html.match(/<input[^>]*type="radio"[^>]*name="reason"/g)).toHaveLength(6);
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain('name="bloquear" value="1"');
    expect(html).toContain(`name="targetId" value="${TARGET}"`);
    // Nunca quién reporta en el formulario.
    expect(html).not.toContain(REPORTER);
  });

  it("alguien que no conoces: 404", async () => {
    mocks.knownCounterpart.mockResolvedValue({ ok: false, error: "not_found" });
    await expect(renderReport()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("solo los avisos y errores de la lista", async () => {
    mocks.knownCounterpart.mockResolvedValue({
      ok: true,
      data: { userId: REPORTER, targetId: TARGET, name: null },
    });
    const html = await renderReport({ aviso: "ya-reportado", error: "motivo" });
    expect(html).toContain("Ya tienes un reporte abierto");
    expect(html).toContain("Elige un motivo.");
    expect(html).toContain("Reportar a esta persona");
    const invented = await renderReport({ aviso: "<script>", error: "x" });
    expect(invented).not.toContain('data-testid="safety-notice"');
    expect(invented).not.toContain('data-testid="report-error"');
  });
});

describe("/ajustes/bloqueos", () => {
  it("lista con «Desbloquear»; una cuenta ya no disponible, sin nombre", async () => {
    mocks.listBlockedPeople.mockResolvedValue({
      ok: true,
      data: [
        { id: TARGET, name: "Ana Pérez", blockedAt: "2026-11-26T10:00:00Z" },
        { id: REPORTER, name: null, blockedAt: "2026-11-25T10:00:00Z" },
      ],
    });
    const html = renderToStaticMarkup(
      await BlockedPeoplePage({ searchParams: Promise.resolve({ aviso: "bloqueado" }) })
    );
    expect(mocks.requireActiveProfile).toHaveBeenCalledWith("/ajustes/bloqueos");
    expect(html.match(/data-testid="blocked-person"/g)).toHaveLength(2);
    expect(html).toContain("Cuenta no disponible");
    expect(html).toContain("Has bloqueado a esta persona");
  });

  it("vacía", async () => {
    mocks.listBlockedPeople.mockResolvedValue({ ok: true, data: [] });
    const html = renderToStaticMarkup(
      await BlockedPeoplePage({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain('data-testid="blocked-empty"');
  });
});

describe("/admin/reportes", () => {
  const report = {
    id: "e0000000-0000-4000-8000-000000000001",
    reason: "harassment",
    description: "Me insulta",
    status: "pending",
    createdAt: "2026-11-26T10:00:00Z",
    resolvedAt: null,
    resolutionNotes: null,
    reporter: { id: REPORTER, name: "Quien reporta" },
    reported: { id: TARGET, name: "Reportada", deactivated: false },
    room: null,
  };

  it("guard de admin en la página y reportes abiertos por defecto", async () => {
    mocks.listReportsForAdmin.mockResolvedValue({ ok: true, data: [report] });
    const html = renderToStaticMarkup(
      await AdminReportsPage({ searchParams: Promise.resolve({}) })
    );
    expect(mocks.requireAdmin).toHaveBeenCalled();
    expect(mocks.listReportsForAdmin).toHaveBeenCalledWith({}, "open");
    expect(html).toContain("Acoso, amenazas o insultos");
    expect(html).toContain("Me insulta");
    expect(html).toContain("Reportada");
  });

  it("sin admin, no se cargan los reportes", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(AdminReportsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(mocks.listReportsForAdmin).not.toHaveBeenCalled();
  });

  it("?vista=cerrados pide los cerrados", async () => {
    mocks.listReportsForAdmin.mockResolvedValue({ ok: true, data: [] });
    const html = renderToStaticMarkup(
      await AdminReportsPage({ searchParams: Promise.resolve({ vista: "cerrados" }) })
    );
    expect(mocks.listReportsForAdmin).toHaveBeenCalledWith({}, "closed");
    expect(html).toContain("No hay reportes cerrados.");
  });
});

describe("SafetyActions", () => {
  it("bloquear con confirmación y enlace a reportar, solo con el id", () => {
    const html = renderToStaticMarkup(<SafetyActions targetId={TARGET} name="Ana" />);
    expect(html).toContain(`name="targetId" value="${TARGET}"`);
    expect(html).toContain(`href="/reportar/${TARGET}"`);
    expect(html).toContain("No se le avisa");
  });
});
