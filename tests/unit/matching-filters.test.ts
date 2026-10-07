import { describe, expect, it } from "vitest";
import {
  acceptsRoommates,
  isEligibleCandidate,
  passesHardFilters,
  type CandidateEligibility,
  type HardFilterProfile,
} from "@/lib/matching/filters";

// Fase 3.3 — filtros duros (antes del score): ciudad, fechas, presupuesto
// (hueco > 150 excluye) y número de compañeros (`max = 0` = sin compañeros).
// No filtran seeking_status, fumar ni mascotas (no son entradas del filtro).

const BCN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const open: HardFilterProfile = {
  cityId: BCN,
  moveInDate: null,
  moveOutDate: null,
  budgetMin: null,
  budgetMax: null,
  roommatesMin: null,
  roommatesMax: null,
};
const p = (overrides: Partial<HardFilterProfile> = {}): HardFilterProfile => ({
  ...open,
  ...overrides,
});

/** Comprueba el filtro en los dos sentidos (debe ser simétrico). */
function both(a: HardFilterProfile, b: HardFilterProfile): boolean {
  const ab = passesHardFilters(a, b);
  expect(passesHardFilters(b, a)).toBe(ab);
  return ab;
}

describe("ciudad", () => {
  it("misma ciudad pasa; otra ciudad o sin ciudad no", () => {
    expect(both(p(), p())).toBe(true);
    expect(both(p(), p({ cityId: MAD }))).toBe(false);
    expect(both(p({ cityId: null }), p())).toBe(false);
    expect(both(p({ cityId: null }), p({ cityId: null }))).toBe(false);
  });
});

describe("fechas: [entrada ?? −∞, salida ?? +∞] se solapan", () => {
  it.each<[string, Partial<HardFilterProfile>, Partial<HardFilterProfile>, boolean]>([
    ["todo NULL", {}, {}, true],
    ["solo entradas", { moveInDate: "2026-09-01" }, { moveInDate: "2027-02-01" }, true],
    ["solo salidas", { moveOutDate: "2027-06-30" }, { moveOutDate: "2026-12-31" }, true],
    [
      "intervalos solapados",
      { moveInDate: "2026-09-01", moveOutDate: "2027-06-30" },
      { moveInDate: "2027-01-01", moveOutDate: "2027-12-31" },
      true,
    ],
    [
      "comparten un solo día (inclusivo)",
      { moveInDate: "2026-09-01", moveOutDate: "2027-01-31" },
      { moveInDate: "2027-01-31", moveOutDate: "2027-06-30" },
      true,
    ],
    [
      "B entra al día siguiente de salir A",
      { moveInDate: "2026-09-01", moveOutDate: "2027-01-31" },
      { moveInDate: "2027-02-01" },
      false,
    ],
    [
      "A sale antes de que B entre (B sin salida)",
      { moveOutDate: "2026-12-31" },
      { moveInDate: "2027-01-01" },
      false,
    ],
  ])("%s", (_label, a, b, expected) => {
    expect(both(p(a), p(b))).toBe(expected);
  });
});

describe("presupuesto: hueco > 150 excluye", () => {
  const A = { budgetMin: 300, budgetMax: 400 };
  it.each<[string, Partial<HardFilterProfile>, boolean]>([
    ["hueco 0", { budgetMin: 400, budgetMax: 500 }, true],
    ["hueco 75", { budgetMin: 475, budgetMax: 600 }, true],
    ["hueco 150 exactos", { budgetMin: 550, budgetMax: 700 }, true],
    ["hueco 151", { budgetMin: 551, budgetMax: 700 }, false],
    ["B sin presupuesto", {}, true],
    ["B solo con mínimo lejano (desde 600)", { budgetMin: 600 }, false],
    ["B solo con máximo (hasta 250)", { budgetMax: 250 }, true],
  ])("%s", (_label, b, expected) => {
    expect(both(p(A), p(b))).toBe(expected);
  });

  it("los dos sin presupuesto pasan", () => {
    expect(both(p(), p())).toBe(true);
  });
});

describe("número de compañeros: [max(1, min ?? 1), max ?? ∞]", () => {
  it.each<[string, Partial<HardFilterProfile>, Partial<HardFilterProfile>, boolean]>([
    ["los dos sin preferencia", {}, {}, true],
    [
      "1–2 y 2–4 se solapan en 2",
      { roommatesMin: 1, roommatesMax: 2 },
      { roommatesMin: 2, roommatesMax: 4 },
      true,
    ],
    [
      "1 y 3–4 no se solapan",
      { roommatesMin: 1, roommatesMax: 1 },
      { roommatesMin: 3, roommatesMax: 4 },
      false,
    ],
    [
      "min 0 cuenta como 1",
      { roommatesMin: 0, roommatesMax: 1 },
      { roommatesMin: 1, roommatesMax: 1 },
      true,
    ],
    [
      "sin máximo y mínimo 3 frente a hasta 2",
      { roommatesMin: 3 },
      { roommatesMax: 2 },
      false,
    ],
    [
      "max 0 (sin compañeros) frente a cualquiera",
      { roommatesMin: 0, roommatesMax: 0 },
      {},
      false,
    ],
    ["max 0 en los dos", { roommatesMax: 0 }, { roommatesMax: 0 }, false],
  ])("%s", (_label, a, b, expected) => {
    expect(both(p(a), p(b))).toBe(expected);
  });

  it("acceptsRoommates: solo max = 0 significa que no acepta compañeros", () => {
    expect(acceptsRoommates({ roommatesMax: 0 })).toBe(false);
    expect(acceptsRoommates({ roommatesMax: null })).toBe(true);
    expect(acceptsRoommates({ roommatesMax: 1 })).toBe(true);
  });
});

describe("candidato elegible (defensa en profundidad de la consulta)", () => {
  const VIEWER = "c0000000-0000-4000-8000-000000000001";
  const base: CandidateEligibility = {
    id: "c0000000-0000-4000-8000-000000000002",
    role: "user",
    deletedAt: null,
    onboardingCompletedAt: "2026-10-01T10:00:00Z",
    questionnaireVersion: 1,
    questionnaireCompletedAt: "2026-10-02T10:00:00Z",
  };

  it("un usuario activo con todo completo es elegible", () => {
    expect(isEligibleCandidate(base, VIEWER, 1)).toBe(true);
  });

  it.each<[string, Partial<CandidateEligibility>]>([
    ["uno mismo", { id: VIEWER }],
    ["cuenta eliminada", { deletedAt: "2026-10-03T10:00:00Z" }],
    ["onboarding sin completar", { onboardingCompletedAt: null }],
    ["admin", { role: "admin" }],
    ["sin test", { questionnaireVersion: null, questionnaireCompletedAt: null }],
    ["test en borrador", { questionnaireCompletedAt: null }],
    ["test de otra versión", { questionnaireVersion: 2 }],
  ])("%s no es elegible", (_label, overrides) => {
    expect(isEligibleCandidate({ ...base, ...overrides }, VIEWER, 1)).toBe(false);
  });

  it("seeking_status, fumar y mascotas no son entradas de ningún filtro", () => {
    expect(Object.keys(open).sort()).toEqual([
      "budgetMax",
      "budgetMin",
      "cityId",
      "moveInDate",
      "moveOutDate",
      "roommatesMax",
      "roommatesMin",
    ]);
  });
});
