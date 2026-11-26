import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CandidateDTO } from "@/lib/services/matching";

const mocks = vi.hoisted(() => ({
  getInterestOverview: vi.fn(),
  requireCompletedQuestionnaire: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({
  requireCompletedQuestionnaire: mocks.requireCompletedQuestionnaire,
}));
vi.mock("@/lib/services/interests", () => ({
  getInterestOverview: mocks.getInterestOverview,
}));
vi.mock("@/app/actions/interests", () => ({
  expressInterest: async () => {},
  retractInterest: async () => {},
}));

import MatchesPage from "@/app/(app)/matches/page";

// /matches (Fase 5.1): matches, recibidos (con «Hacer match») y enviados
// (con «Retirar»). El servicio se prueba en services-interests.

const dto = (id: string, fullName: string, score = 80): CandidateDTO => ({
  id,
  fullName,
  age: 24,
  university: null,
  neighborhoods: [],
  neighborhoodsTotal: 0,
  budgetRange: null,
  score,
  strengths: ["Horarios parecidos"],
  differences: [],
});

const render = async (aviso?: string) =>
  renderToStaticMarkup(
    await MatchesPage({ searchParams: Promise.resolve(aviso ? { aviso } : {}) })
  );

beforeEach(() => {
  mocks.getInterestOverview.mockReset();
  mocks.requireCompletedQuestionnaire.mockReset();
  mocks.requireCompletedQuestionnaire.mockResolvedValue(undefined);
});

describe("/matches", () => {
  it("muestra las tres secciones con sus acciones", async () => {
    mocks.getInterestOverview.mockResolvedValue({
      ok: true,
      data: {
        matches: [{ ...dto("m1", "Match Uno", 77), matchedAt: "2026-11-21T10:00:00Z" }],
        received: [{ ...dto("r1", "Recibida Uno"), at: "2026-11-24T10:00:00Z" }],
        sent: [{ ...dto("s1", "Enviada Uno"), at: "2026-11-23T10:00:00Z" }],
        sentIds: ["s1", "m1"],
        matchedIds: ["m1"],
      },
    });
    const html = await render("match");
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledWith("/matches");
    expect(html).toContain("¡Tenéis un match!");
    expect(html).toContain("Match Uno");
    expect(html).toContain("77%");
    expect(html).toContain("Match desde el 21 de noviembre");
    expect(html).toContain("✓ Tenéis un match");
    expect(html).toContain("El chat todavía no está disponible");
    expect(html).toContain("Recibida Uno");
    expect(html).toContain("Hacer match");
    expect(html).toContain("Enviada Uno");
    expect(html).toContain("Retirar");
    expect(html.match(/name="volver" value="matches"/g)).toHaveLength(2);
    expect(html).not.toMatch(/email|teléfono|date_of_birth/i);
  });

  it("vacía: textos de estado, sin tarjetas", async () => {
    mocks.getInterestOverview.mockResolvedValue({
      ok: true,
      data: { matches: [], received: [], sent: [], sentIds: [], matchedIds: [] },
    });
    const html = await render();
    expect(html).toContain("Todavía no tienes ningún match.");
    expect(html).toContain("Nadie pendiente de respuesta.");
    expect(html).toContain("No tienes intereses sin respuesta.");
    expect(html).not.toContain('data-testid="person-');
    expect(html).not.toContain('data-testid="interest-notice"');
  });

  it("si falla el servicio, error genérico", async () => {
    mocks.getInterestOverview.mockResolvedValue({ ok: false, error: "unknown" });
    await expect(render()).rejects.toThrow("No hemos podido cargar tus matches.");
  });
});
