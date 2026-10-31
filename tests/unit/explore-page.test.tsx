import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { CandidateDTO, CandidatePage } from "@/lib/services/matching";

const mocks = vi.hoisted(() => ({
  getCandidates: vi.fn(),
  requireCompletedQuestionnaire: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({
  requireCompletedQuestionnaire: mocks.requireCompletedQuestionnaire,
}));
vi.mock("@/lib/services/matching", () => ({ getCandidates: mocks.getCandidates }));

import ExplorePage from "@/app/(app)/explorar/page";
import { NEIGHBORHOODS_SOURCE } from "@/components/rooms/neighborhoods-attribution";

// /explorar (Fase 3.5) con la atribución del catálogo de barrios (sesión 70):
// las zonas de las tarjetas son nombres de `neighborhoods` (R1), así que,
// cuando alguna tarjeta las muestra, debajo de la lista va el componente
// compartido. El resto de la página no cambia. Los servicios y el guard se
// prueban en services-matching y questionnaire-routes; aquí solo la página.

const candidate = (overrides: Partial<CandidateDTO> = {}): CandidateDTO => ({
  id: "c1",
  fullName: "Compatible Uno",
  age: 25,
  university: "UPC",
  neighborhoods: [],
  neighborhoodsTotal: 0,
  budgetRange: { min: 400, max: 650 },
  score: 91,
  strengths: ["Horarios parecidos"],
  differences: [],
  ...overrides,
});

function pageWith(data: Partial<CandidatePage>) {
  mocks.getCandidates.mockResolvedValue({
    ok: true,
    data: {
      candidates: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 0,
      viewerAcceptsRoommates: true,
      ...data,
    },
  });
}

const render = async (pagina?: string) =>
  renderToStaticMarkup(
    await ExplorePage({ searchParams: Promise.resolve(pagina ? { pagina } : {}) })
  );
const attributions = (html: string) =>
  html.match(/data-testid="neighborhoods-attribution"/g)?.length ?? 0;

beforeEach(() => {
  mocks.getCandidates.mockReset();
  mocks.requireCompletedQuestionnaire.mockReset();
  mocks.requireCompletedQuestionnaire.mockResolvedValue(undefined);
});

describe("/explorar: atribución de los barrios del catálogo", () => {
  it("si alguna tarjeta muestra zonas, una sola atribución, debajo de la lista", async () => {
    pageWith({
      candidates: [
        candidate({ neighborhoods: ["Gràcia", "Sants"], neighborhoodsTotal: 4 }),
        candidate({ id: "c2", fullName: "Compatible Dos" }),
      ],
      total: 2,
      totalPages: 1,
    });
    const html = await render();
    expect(attributions(html)).toBe(1);
    expect(html.indexOf('data-testid="neighborhoods-attribution"')).toBeGreaterThan(
      html.lastIndexOf('data-testid="candidate"')
    );
    expect(html).toContain("Gràcia, Sants y 2 más");
    for (const url of [
      NEIGHBORHOODS_SOURCE.datasetUrl,
      NEIGHBORHOODS_SOURCE.resourceUrl,
      NEIGHBORHOODS_SOURCE.licenseUrl,
    ])
      expect(html).toContain(`href="${url}"`);
    expect(NEIGHBORHOODS_SOURCE.datasetUrl).toBe(
      "https://datos.gob.es/es/catalogo/l01080193-unidades-administrativas-de-la-ciudad-de-barcelona"
    );
    expect(NEIGHBORHOODS_SOURCE.resourceUrl).toBe(
      "https://opendata-ajuntament.barcelona.cat/data/dataset/808daafa-d9ce-48c0-925a-fa5afdb1ed41/resource/75197dfe-0306-4c5e-9643-34948af07fb6/download"
    );
    expect(NEIGHBORHOODS_SOURCE.licenseUrl).toBe(
      "https://creativecommons.org/licenses/by/4.0/deed.es"
    );
    expect(html).toContain(
      'datos procedentes del conjunto “<a href="https://datos.gob.es/es/catalogo/l01080193-unidades-administrativas-de-la-ciudad-de-barcelona"'
    );
  });

  it("sin zonas en ninguna tarjeta no hay atribución (no se muestra el catálogo)", async () => {
    pageWith({ candidates: [candidate()], total: 1, totalPages: 1 });
    const html = await render();
    expect(html).toContain("Sin zonas preferidas");
    expect(attributions(html)).toBe(0);
  });

  it.each([
    ["sin candidatos", { total: 0 }],
    ["no acepta compañeros", { viewerAcceptsRoommates: false }],
    ["página fuera de rango", { total: 3, totalPages: 1 }],
  ])("%s: sin tarjetas ni atribución", async (_label, data) => {
    pageWith(data);
    const html = await render("5");
    expect(html).not.toContain('data-testid="candidate"');
    expect(attributions(html)).toBe(0);
  });

  it("usa el componente compartido, sin copiar el texto", () => {
    const source = readFileSync("app/(app)/explorar/page.tsx", "utf8");
    expect(source).toContain(
      'import { NeighborhoodsAttribution } from "@/components/rooms/neighborhoods-attribution";'
    );
    expect(source).toContain("<NeighborhoodsAttribution />");
    expect(source).not.toMatch(
      /Unidades administrativas|CC BY|Open Data BCN|datos\.gob\.es/
    );
  });
});

describe("/explorar: el resto de la página no cambia", () => {
  it("tarjetas, puntuación, presupuesto, explicación y paginación como antes", async () => {
    pageWith({
      candidates: [candidate({ neighborhoods: ["Gràcia"], neighborhoodsTotal: 1 })],
      total: 11,
      totalPages: 2,
    });
    const html = await render("2");
    expect(mocks.getCandidates).toHaveBeenCalledWith({}, 2);
    expect(mocks.requireCompletedQuestionnaire).toHaveBeenCalledTimes(1);
    expect(html).toContain("11 compañeros compatibles");
    expect(html).toContain("Compatible Uno");
    expect(html).toContain("91%");
    expect(html).toContain("400–650 € al mes");
    expect(html).toContain("Por qué encajáis");
    expect(html).toContain("Página 2 de 2");
    expect(html).toContain('href="/explorar"');
    expect(html).not.toMatch(/Ver perfil|Me interesa/);
  });

  it("si falla el servicio, error genérico sin detalles", async () => {
    mocks.getCandidates.mockResolvedValue({ ok: false, error: "unknown" });
    await expect(render()).rejects.toThrow(
      "No hemos podido cargar los compañeros compatibles. Vuelve a intentarlo en un momento."
    );
  });
});
