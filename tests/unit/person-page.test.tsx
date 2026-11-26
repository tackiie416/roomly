import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PersonProfileDTO } from "@/lib/services/matching";

const mocks = vi.hoisted(() => ({
  getPersonPage: vi.fn(),
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
vi.mock("@/lib/services/interests", () => ({ getPersonPage: mocks.getPersonPage }));
vi.mock("@/app/actions/interests", () => ({
  expressInterest: async () => {},
  retractInterest: async () => {},
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import PersonPage from "@/app/(app)/explorar/[id]/page";

// «Ver perfil» (Fase 5.2). El servicio se prueba en services-interests.

const ID = "d0000000-0000-4000-8000-000000000001";
const person = (overrides: Partial<PersonProfileDTO> = {}): PersonProfileDTO => ({
  id: ID,
  fullName: "Ana Pérez",
  age: 24,
  university: "UPC",
  neighborhoods: ["Gràcia"],
  neighborhoodsTotal: 2,
  budgetRange: { min: 400, max: 650 },
  score: 88,
  strengths: ["Horarios parecidos"],
  differences: ["Distinta tolerancia al ruido"],
  bio: "Me gusta cocinar.\\nY leer.",
  fieldOfStudy: "Arquitectura",
  seekingStatus: "has_room_looking_for_roommate",
  moveInMonth: "2026-09",
  ...overrides,
});

const render = async (aviso?: string) =>
  renderToStaticMarkup(
    await PersonPage({
      params: Promise.resolve({ id: ID }),
      searchParams: Promise.resolve(aviso ? { aviso } : {}),
    })
  );

beforeEach(() => {
  mocks.getPersonPage.mockReset();
  mocks.requireCompletedQuestionnaire.mockReset();
  mocks.requireCompletedQuestionnaire.mockResolvedValue(undefined);
});

describe("/explorar/[id]", () => {
  it("muestra el perfil mínimo, sin datos privados", async () => {
    mocks.getPersonPage.mockResolvedValue({
      ok: true,
      data: { profile: person(), state: undefined, matchedAt: null },
    });
    const html = await render();
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledTimes(1);
    expect(mocks.getPersonPage).toHaveBeenCalledWith({}, ID);
    for (const text of [
      "Ana Pérez",
      "24 años · UPC",
      "88%",
      "Sobre Ana",
      "Me gusta cocinar.",
      "Tiene habitación y busca compañeros",
      "Arquitectura",
      "Gràcia y 1 más",
      "400–650 € al mes",
      "Desde septiembre de 2026",
      "Por qué encajáis",
      "Posibles diferencias",
      "Me interesa",
      'name="volver" value="perfil"',
      "Volver a Explorar",
    ])
      expect(html).toContain(text);
    expect(html).not.toMatch(/@|date_of_birth|2002-|categoryScores/);
    expect(html).toContain('data-testid="neighborhoods-attribution"');
  });

  it("sin bio ni estudios: no hay sección vacía", async () => {
    mocks.getPersonPage.mockResolvedValue({
      ok: true,
      data: {
        profile: person({
          bio: null,
          fieldOfStudy: null,
          neighborhoods: [],
          moveInMonth: null,
        }),
        state: "matched",
        matchedAt: "2026-11-20T10:00:00Z",
      },
    });
    const html = await render("match");
    expect(html).not.toContain("Sobre Ana");
    expect(html).toContain("Sin indicar");
    expect(html).toContain("Sin fecha");
    expect(html).toContain("✓ Tenéis un match");
    expect(html).toContain("Volver a tus matches");
    expect(html).toContain("¡Tenéis un match!");
    expect(html).not.toContain('data-testid="neighborhoods-attribution"');
  });

  it("not_found → 404; otro error → error genérico", async () => {
    mocks.getPersonPage.mockResolvedValue({ ok: false, error: "not_found" });
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    mocks.getPersonPage.mockResolvedValue({ ok: false, error: "unknown" });
    await expect(render()).rejects.toThrow("No hemos podido cargar este perfil.");
  });
});
