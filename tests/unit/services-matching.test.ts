import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PAGE_SIZE,
  CANDIDATE_SELECT,
  ageOn,
  getCandidates,
  pickNeighborhoods,
  toBudgetRange,
  todayInMadrid,
  type CandidateDTO,
} from "@/lib/services/matching";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";
import { createFakeSupabase, writePayloads, type Call } from "./helpers/fake-supabase";

// Fase 3.4 — candidatos de /explorar. Lectura propia con el cliente del
// usuario; lectura cruzada con service_role en UNA consulta con columnas
// explícitas; filtros duros y score en Node; solo el DTO sale. Con la versión
// vigente (la v2): quien solo tiene el test v1 no mira ni sale como candidato.

const CURRENT = CURRENT_QUESTIONNAIRE_VERSION;
/** Una versión que el código no conoce (anomalía). */
const LATER = CURRENT_QUESTIONNAIRE_VERSION + 1;

const VIEWER = "00000000-0000-4000-8000-0000000000aa";
const BCN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GRACIA = "c1111111-1111-4111-8111-111111111111";
const SANTS = "c2222222-2222-4222-8222-222222222222";
const BORN = "c3333333-3333-4333-8333-333333333333";
const RAVAL = "c4444444-4444-4444-8444-444444444444";
const NAMES = [
  { id: GRACIA, name: "Gràcia" },
  { id: SANTS, name: "Sants" },
  { id: BORN, name: "El Born" },
  { id: RAVAL, name: "El Raval" },
];
const TODAY = "2026-10-07";

const answers = (value = 1, overrides: Record<string, number> = {}) => ({
  ...Object.fromEntries(getCurrentQuestionnaire().questions.map((q) => [q.id, value])),
  ...overrides,
});

type Housing = {
  city_id: string | null;
  university_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  move_in_date: string | null;
  move_out_date: string | null;
  preferred_neighborhood_ids: string[];
  roommates_wanted_min: number | null;
  roommates_wanted_max: number | null;
};
const housing = (overrides: Partial<Housing> = {}): Housing => ({
  city_id: BCN,
  university_id: null,
  budget_min: null,
  budget_max: null,
  move_in_date: null,
  move_out_date: null,
  preferred_neighborhood_ids: [],
  roommates_wanted_min: null,
  roommates_wanted_max: null,
  ...overrides,
});
/** Un test v1 completo: desde la v2 está desactualizado. */
const v1Answers = (value = 1) =>
  Object.fromEntries(QUESTIONNAIRE_V1.questions.map((q) => [q.id, value]));
const completedResponse = (a: Record<string, number> = answers()) => ({
  questionnaire_version: CURRENT,
  answers: a,
  completed_at: "2026-10-02T10:00:00Z",
});

let seq = 0;
function candidate(
  overrides: Record<string, unknown> = {},
  h: Partial<Housing> = {},
  a = answers()
) {
  seq += 1;
  return {
    id: `d0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    full_name: `Candidata ${seq}`,
    date_of_birth: "2001-03-15",
    role: "user",
    deleted_at: null,
    onboarding_completed_at: "2026-10-01T10:00:00Z",
    housing_preferences: housing(h),
    compatibility_responses: completedResponse(a),
    ...overrides,
  };
}

type Viewer = {
  profile?: unknown;
  housing?: Housing | null;
  response?: unknown;
};

function setup(viewer: Viewer = {}, rows: unknown[] = []) {
  const user = createFakeSupabase({
    userId: VIEWER,
    respond: (call) => {
      if (call.table === "profiles")
        return {
          data:
            viewer.profile === undefined
              ? {
                  id: VIEWER,
                  deleted_at: null,
                  onboarding_completed_at: "2026-10-01T10:00:00Z",
                }
              : viewer.profile,
          error: null,
        };
      if (call.table === "housing_preferences")
        return {
          data: viewer.housing === undefined ? housing() : viewer.housing,
          error: null,
        };
      if (call.table === "compatibility_responses")
        return {
          data: viewer.response === undefined ? completedResponse() : viewer.response,
          error: null,
        };
      if (call.table === "universities")
        return { data: [{ id: UNI, name: "Universitat de Barcelona" }], error: null };
      if (call.table === "neighborhoods") return { data: NAMES, error: null };
      return { data: null, error: null };
    },
  });
  let adminCalls = 0;
  const admin = createFakeSupabase({
    userId: null,
    respond: () => ({ data: rows, error: null }),
  });
  const deps = {
    adminClient: () => {
      adminCalls += 1;
      return admin.client;
    },
    today: () => TODAY,
  };
  return { user, admin, deps, adminCalls: () => adminCalls };
}

async function run(viewer: Viewer, rows: unknown[], page = 1) {
  const s = setup(viewer, rows);
  const result = await getCandidates(s.user.client, page, s.deps);
  if (!result.ok) throw new Error(`fallo: ${result.error}`);
  return { ...s, data: result.data };
}

describe("comprobaciones de quien mira (sin lectura cruzada)", () => {
  it("sin sesión → unauthenticated", async () => {
    const user = createFakeSupabase({ userId: null });
    let created = 0;
    const result = await getCandidates(user.client, 1, {
      adminClient: () => {
        created += 1;
        return user.client;
      },
      today: () => TODAY,
    });
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(created).toBe(0);
  });

  it.each<[string, Viewer, string]>([
    ["sin perfil", { profile: null }, "no_profile"],
    [
      "cuenta eliminada",
      { profile: { id: VIEWER, deleted_at: "2026-10-05", onboarding_completed_at: "x" } },
      "deleted",
    ],
    [
      "onboarding sin completar",
      { profile: { id: VIEWER, deleted_at: null, onboarding_completed_at: null } },
      "forbidden",
    ],
    ["sin test", { response: null }, "forbidden"],
    [
      "test en borrador",
      { response: { ...completedResponse(), completed_at: null } },
      "forbidden",
    ],
    [
      "test completado en la v1 (desactualizado)",
      {
        response: {
          questionnaire_version: 1,
          answers: v1Answers(),
          completed_at: "2026-10-02T10:00:00Z",
        },
      },
      "forbidden",
    ],
    [
      "test de una versión posterior (anomalía)",
      { response: { ...completedResponse(), questionnaire_version: LATER } },
      "forbidden",
    ],
    ["sin ciudad", { housing: housing({ city_id: null }) }, "forbidden"],
  ])("%s → %s, sin service_role", async (_label, viewer, error) => {
    const s = setup(viewer);
    expect(await getCandidates(s.user.client, 1, s.deps)).toEqual({ ok: false, error });
    expect(s.adminCalls()).toBe(0);
  });

  it("max = 0 (sin compañeros): lista vacía y aviso, sin lectura cruzada", async () => {
    const { data, adminCalls } = await run(
      { housing: housing({ roommates_wanted_max: 0 }) },
      [candidate()]
    );
    expect(data).toMatchObject({
      candidates: [],
      total: 0,
      viewerAcceptsRoommates: false,
    });
    expect(adminCalls()).toBe(0);
  });
});

describe("la lectura cruzada", () => {
  it("es UNA consulta con service_role, columnas explícitas y los filtros en SQL", async () => {
    const { admin, adminCalls } = await run({}, [candidate()]);
    expect(adminCalls()).toBe(1);
    expect(admin.calls).toHaveLength(1);
    const [call] = admin.calls;
    expect(call).toMatchObject({
      table: "profiles",
      operation: "select",
      terminal: "await",
    });
    expect(call.columns).toBe(CANDIDATE_SELECT);
    expect(call.columns).not.toContain("*");
    for (const forbidden of ["bio", "email", "avatar_url", "seeking_status"]) {
      expect(call.columns).not.toContain(forbidden);
    }
    expect(call.filters).toEqual([
      { kind: "neq", column: "id", value: VIEWER },
      { kind: "is", column: "deleted_at", value: null },
      { kind: "not", column: "onboarding_completed_at", operator: "is", value: null },
      { kind: "neq", column: "role", value: "admin" },
      { kind: "eq", column: "housing_preferences.city_id", value: BCN },
      {
        kind: "eq",
        column: "compatibility_responses.questionnaire_version",
        value: CURRENT,
      },
      {
        kind: "not",
        column: "compatibility_responses.completed_at",
        operator: "is",
        value: null,
      },
    ]);
  });

  it("los datos propios y los nombres se leen con el cliente del usuario, que nunca escribe", async () => {
    const { user, admin } = await run({}, [
      candidate({}, { university_id: UNI, preferred_neighborhood_ids: [GRACIA] }),
    ]);
    const tables = user.calls.map((c: Call) => c.table).sort();
    expect(tables).toEqual([
      "compatibility_responses",
      "housing_preferences",
      "neighborhoods",
      "profiles",
      "universities",
    ]);
    expect(user.calls.every((c) => c.operation === "select")).toBe(true);
    expect(
      user.calls
        .filter((c) =>
          ["profiles", "housing_preferences", "compatibility_responses"].includes(c.table)
        )
        .every((c) => c.filters.some((f) => f.value === VIEWER))
    ).toBe(true);
    expect(writePayloads(user.calls)).toHaveLength(0);
    expect(writePayloads(admin.calls)).toHaveLength(0);
  });
});

describe("defensa en profundidad y filtros duros", () => {
  it("descarta filas que la consulta no debería devolver (admin, eliminada, uno mismo, otra versión, borrador)", async () => {
    const good = candidate();
    const rows = [
      good,
      candidate({ role: "admin" }),
      candidate({ deleted_at: "2026-10-03T10:00:00Z" }),
      candidate({ id: VIEWER }),
      candidate({ onboarding_completed_at: null }),
      candidate({
        compatibility_responses: {
          questionnaire_version: 1,
          answers: v1Answers(),
          completed_at: "2026-10-02T10:00:00Z",
        },
      }),
      candidate({
        compatibility_responses: { ...completedResponse(), questionnaire_version: LATER },
      }),
      candidate({
        compatibility_responses: { ...completedResponse(), completed_at: null },
      }),
      candidate({ housing_preferences: null }),
    ];
    const { data } = await run({}, rows);
    expect(data.candidates.map((c) => c.id)).toEqual([good.id]);
  });

  it("aplica los filtros duros antes del score: presupuesto (hueco > 150), fechas, compañeros", async () => {
    const viewer = {
      housing: housing({
        budget_min: 300,
        budget_max: 400,
        move_in_date: "2026-09-01",
        move_out_date: "2027-06-30",
        roommates_wanted_min: 1,
        roommates_wanted_max: 2,
      }),
    };
    const ok150 = candidate({}, { budget_min: 550, budget_max: 700 });
    const rows = [
      ok150,
      candidate({}, { budget_min: 551, budget_max: 700 }),
      candidate({}, { move_in_date: "2027-07-01" }),
      candidate({}, { roommates_wanted_min: 3 }),
      candidate({}, { roommates_wanted_max: 0 }),
      candidate({}, { city_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    ];
    const { data } = await run(viewer, rows);
    expect(data.candidates.map((c) => c.id)).toEqual([ok150.id]);
  });

  it("un candidato no comparable (respuestas corruptas) se omite sin error", async () => {
    const good = candidate();
    const { data } = await run({}, [
      good,
      candidate({}, {}, { ...answers(), smoke_own: 9 }),
    ]);
    expect(data.candidates.map((c) => c.id)).toEqual([good.id]);
  });

  it("una fila marcada con la versión vigente pero con respuestas de la v1 no se puntúa", async () => {
    const good = candidate();
    const { data } = await run({}, [good, candidate({}, {}, v1Answers())]);
    expect(data.candidates.map((c) => c.id)).toEqual([good.id]);
  });

  it("acepta la fila embebida como objeto o como lista", async () => {
    const asList = candidate();
    asList.housing_preferences = [asList.housing_preferences] as never;
    asList.compatibility_responses = [asList.compatibility_responses] as never;
    const { data } = await run({}, [asList]);
    expect(data.candidates).toHaveLength(1);
  });
});

describe("orden y paginación", () => {
  it("score descendente y, a igual score, id ascendente", async () => {
    const high = candidate();
    const tieB = candidate(
      { id: "d0000000-0000-4000-8000-00000000ffff" },
      {},
      answers(1, { smoke_own: 3, smoke_tolerance: 3 })
    );
    const tieA = candidate(
      { id: "d0000000-0000-4000-8000-00000000aaaa" },
      {},
      answers(1, { smoke_own: 3, smoke_tolerance: 3 })
    );
    const { data } = await run({}, [tieB, high, tieA]);
    expect(data.candidates.map((c) => c.id)).toEqual([high.id, tieA.id, tieB.id]);
    expect(data.candidates[0].score).toBeGreaterThan(data.candidates[1].score);
    expect(data.candidates[1].score).toBe(data.candidates[2].score);
  });

  it("páginas de 20; sin tope total; página fuera de rango vacía; página inválida → 1", async () => {
    const rows = Array.from({ length: 45 }, () => candidate());
    const first = await run({}, rows, 1);
    expect(CANDIDATES_PAGE_SIZE).toBe(20);
    expect(first.data).toMatchObject({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    expect(first.data.candidates).toHaveLength(20);
    const third = await run({}, rows, 3);
    expect(third.data.candidates).toHaveLength(5);
    const fourth = await run({}, rows, 4);
    expect(fourth.data.candidates).toHaveLength(0);
    expect(fourth.data.total).toBe(45);
    for (const invalid of [0, -2, 1.5, Number.NaN]) {
      expect((await run({}, rows, invalid)).data.page).toBe(1);
    }
    const all = [
      ...first.data.candidates,
      ...(await run({}, rows, 2)).data.candidates,
      ...third.data.candidates,
    ].map((c) => c.id);
    expect(new Set(all).size).toBe(45);
  });
});

describe("DTO", () => {
  it("lleva exactamente los campos permitidos", async () => {
    const { data } = await run({}, [candidate()]);
    expect(Object.keys(data.candidates[0]).sort()).toEqual(
      [
        "age",
        "budgetRange",
        "differences",
        "fullName",
        "id",
        "neighborhoods",
        "neighborhoodsTotal",
        "score",
        "strengths",
        "university",
      ].sort()
    );
  });

  it("no expone respuestas, fecha de nacimiento, rol, presupuesto exacto ni categoryScores", async () => {
    const c = candidate(
      { date_of_birth: "2001-03-15" },
      {
        budget_min: 437,
        budget_max: 612,
        university_id: UNI,
        preferred_neighborhood_ids: [GRACIA],
      },
      answers(2)
    );
    const { data } = await run(
      { housing: housing({ budget_min: 400, budget_max: 600 }) },
      [c]
    );
    const json = JSON.stringify(data);
    for (const forbidden of [
      "2001-03-15",
      "437",
      "612",
      "date_of_birth",
      "answers",
      "role",
      "deleted_at",
      "seeking_status",
      "categoryScores",
      "clean_frequency",
      "questionnaire_version",
      "avatar",
      "email",
      UNI,
      GRACIA,
      BCN,
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("construye cada campo: edad, universidad, barrios, presupuesto, score y textos sin cifras", async () => {
    const c = candidate(
      { full_name: "Laura Pérez", date_of_birth: "2004-10-08" },
      {
        university_id: UNI,
        preferred_neighborhood_ids: [RAVAL, SANTS, GRACIA, BORN],
        budget_min: 437,
        budget_max: 612,
      }
    );
    const { data } = await run(
      { housing: housing({ preferred_neighborhood_ids: [SANTS] }) },
      [c]
    );
    const dto: CandidateDTO = data.candidates[0];
    expect(dto).toMatchObject({
      id: c.id,
      fullName: "Laura Pérez",
      age: 21, // cumple 22 el 8 de octubre; hoy es 7
      university: "Universitat de Barcelona",
      neighborhoods: ["Sants", "El Born", "El Raval"],
      neighborhoodsTotal: 4,
      budgetRange: { min: 400, max: 650 },
    });
    expect(Number.isInteger(dto.score)).toBe(true);
    expect(dto.strengths.length).toBeLessThanOrEqual(3);
    expect(dto.differences.length).toBeLessThanOrEqual(3);
    for (const text of [...dto.strengths, ...dto.differences])
      expect(text).not.toMatch(/\d/);
  });

  it("sin universidad, sin barrios y sin presupuesto", async () => {
    const { data } = await run({}, [candidate()]);
    expect(data.candidates[0]).toMatchObject({
      university: null,
      neighborhoods: [],
      neighborhoodsTotal: 0,
      budgetRange: null,
    });
  });
});

describe("utilidades del DTO", () => {
  it("ageOn: años cumplidos", () => {
    expect(ageOn("2000-10-07", "2026-10-07")).toBe(26);
    expect(ageOn("2000-10-08", "2026-10-07")).toBe(25);
    expect(ageOn("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOn("2000-02-29", "2026-03-01")).toBe(26);
  });

  it("toBudgetRange: escalones de 50 €", () => {
    expect(toBudgetRange(437, 612)).toEqual({ min: 400, max: 650 });
    expect(toBudgetRange(400, 600)).toEqual({ min: 400, max: 600 });
    expect(toBudgetRange(null, 612)).toEqual({ min: null, max: 650 });
    expect(toBudgetRange(437, null)).toEqual({ min: 400, max: null });
    expect(toBudgetRange(null, null)).toBeNull();
  });

  it("pickNeighborhoods: compartidos primero, alfabético, máximo 3, total sin duplicados", () => {
    const names = new Map(NAMES.map((n) => [n.id, n.name]));
    expect(
      pickNeighborhoods([RAVAL, SANTS, GRACIA, BORN, SANTS], [GRACIA], names)
    ).toEqual({
      shown: ["Gràcia", "El Born", "El Raval"],
      total: 4,
    });
    expect(pickNeighborhoods([], [GRACIA], names)).toEqual({ shown: [], total: 0 });
  });

  it("todayInMadrid: fecha local de Madrid", () => {
    // 23:30 UTC del 6 de octubre = 01:30 del 7 en Madrid (CEST).
    expect(todayInMadrid(new Date("2026-10-06T23:30:00Z"))).toBe("2026-10-07");
    expect(todayInMadrid(new Date("2026-10-06T21:30:00Z"))).toBe("2026-10-06");
  });
});
