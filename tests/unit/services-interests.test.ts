import { describe, expect, it, vi } from "vitest";
import {
  getInterestOverview,
  getPersonPage,
  getInterestStates,
  sendInterest,
  withdrawInterest,
  type InterestsDeps,
} from "@/lib/services/interests";
import { MAX_COUNTERPARTS, evaluateCounterparts } from "@/lib/services/matching";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";
import type { DbClient } from "@/lib/services/result";
import { createFakeSupabase, type Call } from "./helpers/fake-supabase";

// Fase 5.1 — «Me interesa» y match mutuo. Quién puede recibir un interés lo
// deciden las reglas de /explorar (evaluateCounterparts); el cliente admin
// solo se usa para las dos rpc; los intereses propios se leen con el cliente
// del usuario. La base de datos (tests/db/26) prueba el resto.

const VIEWER = "00000000-0000-4000-8000-0000000000aa";
const TARGET = "d0000000-0000-4000-8000-000000000001";
const OTHER = "d0000000-0000-4000-8000-000000000002";
const FAR = "d0000000-0000-4000-8000-000000000003";
const BCN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAD = "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb";
const TODAY = "2026-11-25";

const answers = () =>
  Object.fromEntries(getCurrentQuestionnaire().questions.map((q) => [q.id, 1]));
const housing = (city = BCN) => ({
  city_id: city,
  university_id: null,
  budget_min: null,
  budget_max: null,
  move_in_date: null,
  move_out_date: null,
  preferred_neighborhood_ids: [],
  roommates_wanted_min: null,
  roommates_wanted_max: null,
});
const response = () => ({
  questionnaire_version: CURRENT_QUESTIONNAIRE_VERSION,
  answers: answers(),
  completed_at: "2026-10-02T10:00:00Z",
});
const person = (id: string, city = BCN) => ({
  id,
  full_name: `Persona ${id.slice(-1)}`,
  date_of_birth: "2001-03-15",
  role: "user",
  deleted_at: null,
  onboarding_completed_at: "2026-10-01T10:00:00Z",
  housing_preferences: housing(city),
  compatibility_responses: response(),
});

type Options = {
  userId?: string | null;
  profile?: unknown;
  people?: unknown[];
  interests?: unknown[];
  matches?: unknown[];
  rpc?: { data: unknown; error: { code?: string; message?: string } | null };
  /** Fila de «Ver perfil» (bio, seeking_status, housing_preferences). */
  extras?: unknown;
};

function setup(options: Options = {}) {
  const user = createFakeSupabase({
    userId: options.userId === undefined ? VIEWER : options.userId,
    respond: (call: Call) => {
      if (call.table === "profiles")
        return {
          data:
            options.profile === undefined
              ? {
                  id: VIEWER,
                  deleted_at: null,
                  onboarding_completed_at: "2026-10-01T10:00:00Z",
                }
              : options.profile,
          error: null,
        };
      if (call.table === "housing_preferences") return { data: housing(), error: null };
      if (call.table === "compatibility_responses")
        return { data: response(), error: null };
      if (call.table === "interests")
        return { data: options.interests ?? [], error: null };
      if (call.table === "matches") return { data: options.matches ?? [], error: null };
      if (call.table === "universities" || call.table === "neighborhoods")
        return { data: [], error: null };
      return { data: null, error: null };
    },
  });
  const admin = createFakeSupabase({
    userId: null,
    respond: (call) => {
      if (call.columns?.includes("bio"))
        return {
          data:
            options.extras === undefined
              ? {
                  bio: "  Me gusta cocinar.  ",
                  seeking_status: "looking_for_room",
                  housing_preferences: { field_of_study: "", move_in_date: "2026-09-15" },
                }
              : options.extras,
          error: null,
        };
      const ids = (call.filters.find((f) => f.kind === "in")?.value ?? []) as string[];
      const rows = (options.people ?? [
        person(TARGET),
        person(OTHER),
        person(FAR, MAD),
      ]) as Array<{
        id: string;
      }>;
      return { data: rows.filter((r) => ids.includes(r.id)), error: null };
    },
  });
  const rpc = vi.fn(async () => options.rpc ?? { data: "sent", error: null });
  const deps: InterestsDeps = {
    adminClient: () => admin.client,
    interestsAdminClient: () => ({ rpc }) as unknown as DbClient,
    today: () => TODAY,
  };
  return { user, admin, rpc, deps };
}

describe("sendInterest", () => {
  it("envía el interés con el score del motor, sin datos del navegador", async () => {
    const s = setup();
    const result = await sendInterest(s.user.client, TARGET, s.deps);
    expect(result).toEqual({ ok: true, data: { status: "sent" } });
    expect(s.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = s.rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe("record_interest");
    expect(args).toEqual({ p_from: VIEWER, p_to: TARGET, p_score: expect.any(Number) });
    expect(args.p_score as number).toBeGreaterThanOrEqual(0);
    expect(args.p_score as number).toBeLessThanOrEqual(100);
    // El cliente del usuario no escribe en interests ni en matches.
    expect(
      s.user.calls.filter((c) => c.table === "interests" || c.table === "matches")
    ).toEqual([]);
  });

  it.each([
    ["already_sent", "already_sent"],
    ["matched", "matched"],
  ])("devuelve el estado de la rpc: %s", async (data, status) => {
    const s = setup({ rpc: { data, error: null } });
    expect(await sendInterest(s.user.client, TARGET, s.deps)).toEqual({
      ok: true,
      data: { status },
    });
  });

  it("una respuesta inesperada de la rpc es unknown", async () => {
    const s = setup({ rpc: { data: "otra cosa", error: null } });
    expect(await sendInterest(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "unknown",
    });
  });

  it.each([undefined, "", "no-es-uuid", 42, VIEWER.toUpperCase() + "x"])(
    "id no válido (%s): validation, sin consultas",
    async (id) => {
      const s = setup();
      expect(await sendInterest(s.user.client, id, s.deps)).toEqual({
        ok: false,
        error: "validation",
      });
      expect(s.user.calls).toEqual([]);
      expect(s.rpc).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["no existe o no es elegible", "d0000000-0000-4000-8000-000000000009"],
    ["no pasa los filtros duros (otra ciudad)", FAR],
    ["es quien envía", VIEWER],
  ])("%s: not_found, sin rpc", async (_label, id) => {
    const s = setup();
    expect(await sendInterest(s.user.client, id, s.deps)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("sin sesión: unauthenticated, sin rpc", async () => {
    const s = setup({ userId: null });
    expect(await sendInterest(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("cuenta desactivada: deleted, sin rpc", async () => {
    const s = setup({
      profile: { id: VIEWER, deleted_at: "2026-11-01", onboarding_completed_at: "x" },
    });
    expect(await sendInterest(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["rate_limit_exceeded: máximo 30 intereses en 24h", "rate_limited"],
    ["interest_party_invalid: alguna de las dos cuentas…", "not_found"],
    ["otro error", "unknown"],
  ])("error de la rpc «%s» → %s, sin el mensaje", async (message, error) => {
    const s = setup({ rpc: { data: null, error: { code: "P0001", message } } });
    expect(await sendInterest(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error,
    });
  });
});

describe("withdrawInterest", () => {
  it.each([
    ["withdrawn", { ok: true, data: { status: "withdrawn" } }],
    ["not_found", { ok: true, data: { status: "not_found" } }],
    ["matched", { ok: false, error: "conflict" }],
    ["raro", { ok: false, error: "unknown" }],
  ])("rpc «%s»", async (data, expected) => {
    const s = setup({ rpc: { data, error: null } });
    expect(await withdrawInterest(s.user.client, OTHER, s.deps)).toEqual(expected);
    expect(s.rpc).toHaveBeenCalledWith("withdraw_interest", {
      p_from: VIEWER,
      p_to: OTHER,
    });
  });

  it("no exige que la otra persona siga siendo elegible", async () => {
    const s = setup({ people: [], rpc: { data: "withdrawn", error: null } });
    expect(await withdrawInterest(s.user.client, FAR, s.deps)).toEqual({
      ok: true,
      data: { status: "withdrawn" },
    });
    expect(s.admin.calls).toEqual([]);
  });

  it.each([
    ["id no válido", {}, "x", "validation"],
    ["a sí misma", {}, VIEWER, "validation"],
    ["sin sesión", { userId: null }, OTHER, "unauthenticated"],
    ["sin perfil", { profile: null }, OTHER, "no_profile"],
    [
      "cuenta desactivada",
      { profile: { id: VIEWER, deleted_at: "2026-11-01" } },
      OTHER,
      "deleted",
    ],
  ])("%s: %s sin rpc", async (_label, options, id, error) => {
    const s = setup(options as Options);
    expect(await withdrawInterest(s.user.client, id, s.deps)).toEqual({
      ok: false,
      error,
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });
});

describe("getInterestOverview y getInterestStates", () => {
  const interests = [
    { from_user_id: TARGET, to_user_id: VIEWER, created_at: "2026-11-24T10:00:00Z" },
    { from_user_id: VIEWER, to_user_id: OTHER, created_at: "2026-11-23T10:00:00Z" },
    { from_user_id: VIEWER, to_user_id: FAR, created_at: "2026-11-22T10:00:00Z" },
    // Con match: no sale como recibido ni enviado.
    {
      from_user_id: VIEWER,
      to_user_id: "d0000000-0000-4000-8000-000000000004",
      created_at: "2026-11-20T10:00:00Z",
    },
    {
      from_user_id: "d0000000-0000-4000-8000-000000000004",
      to_user_id: VIEWER,
      created_at: "2026-11-21T10:00:00Z",
    },
  ];
  const MATCHED = "d0000000-0000-4000-8000-000000000004";
  const matches = [
    {
      user_a_id: VIEWER,
      user_b_id: MATCHED,
      compatibility_score: 77,
      created_at: "2026-11-21T10:00:00Z",
    },
  ];

  it("separa matches, recibidos y enviados; solo DTO, con el score guardado del match", async () => {
    const s = setup({
      interests,
      matches,
      people: [person(TARGET), person(OTHER), person(FAR, MAD), person(MATCHED, MAD)],
    });
    const result = await getInterestOverview(s.user.client, s.deps);
    if (!result.ok) throw new Error(result.error);
    const { data } = result;
    // El match se ve aunque ya no pase los filtros duros (otra ciudad).
    expect(data.matches.map((m) => [m.id, m.score, m.matchedAt])).toEqual([
      [MATCHED, 77, "2026-11-21T10:00:00Z"],
    ]);
    expect(data.received.map((i) => i.id)).toEqual([TARGET]);
    // FAR ya no pasa los filtros duros: no se muestra.
    expect(data.sent.map((i) => i.id)).toEqual([OTHER]);
    expect(data.sentIds.sort()).toEqual([OTHER, FAR, MATCHED].sort());
    expect(data.matchedIds).toEqual([MATCHED]);
    for (const p of [...data.matches, ...data.received, ...data.sent]) {
      expect(p).not.toHaveProperty("answers");
      expect(p).not.toHaveProperty("date_of_birth");
      expect(p).not.toHaveProperty("categoryScores");
    }
    // Lecturas propias con el cliente del usuario, filtradas por participante.
    const own = s.user.calls.filter(
      (c) => c.table === "interests" || c.table === "matches"
    );
    expect(own).toHaveLength(2);
    for (const c of own) {
      expect(c.operation).toBe("select");
      expect(
        c.filters.some((f) => f.kind === "or" && String(f.value).includes(VIEWER))
      ).toBe(true);
      expect(c.columns).not.toContain("*");
    }
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("sin intereses: listas vacías y sin lectura cruzada", async () => {
    const s = setup();
    const result = await getInterestOverview(s.user.client, s.deps);
    expect(result).toEqual({
      ok: true,
      data: { matches: [], received: [], sent: [], sentIds: [], matchedIds: [] },
    });
    expect(s.admin.calls).toEqual([]);
  });

  it(`no evalúa más de ${MAX_COUNTERPARTS} personas a la vez`, async () => {
    const many = Array.from({ length: MAX_COUNTERPARTS + 50 }, (_, n) => ({
      from_user_id: VIEWER,
      to_user_id: `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      created_at: "2026-11-01T10:00:00Z",
    }));
    const s = setup({ interests: many });
    const result = await getInterestOverview(s.user.client, s.deps);
    expect(result.ok).toBe(true);
    const ins = s.admin.calls.flatMap((c) => c.filters.filter((f) => f.kind === "in"));
    for (const f of ins)
      expect((f.value as string[]).length).toBeLessThanOrEqual(MAX_COUNTERPARTS);
  });

  it("getInterestStates: enviado, recibido y match por persona", async () => {
    const s = setup({ interests, matches });
    const result = await getInterestStates(s.user.client);
    if (!result.ok) throw new Error(result.error);
    expect(Object.fromEntries(result.data)).toEqual({
      [TARGET]: "received",
      [OTHER]: "sent",
      [FAR]: "sent",
      [MATCHED]: "matched",
    });
  });

  it("sin sesión: unauthenticated", async () => {
    const s = setup({ userId: null });
    expect(await getInterestStates(s.user.client)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
});

describe("evaluateCounterparts", () => {
  it(`más de ${MAX_COUNTERPARTS} ids: validation, sin lectura cruzada`, async () => {
    const s = setup();
    const ids = Array.from(
      { length: MAX_COUNTERPARTS + 1 },
      (_, n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`
    );
    expect(
      await evaluateCounterparts(s.user.client, ids, { requireHardFilters: true }, s.deps)
    ).toEqual({ ok: false, error: "validation" });
    expect(s.admin.calls).toEqual([]);
  });

  it("una consulta con columnas explícitas y los filtros de elegibilidad, sin el de ciudad", async () => {
    const s = setup();
    const result = await evaluateCounterparts(
      s.user.client,
      [TARGET, FAR, TARGET],
      { requireHardFilters: false },
      s.deps
    );
    if (!result.ok) throw new Error(result.error);
    expect([...result.data.byId.keys()].sort()).toEqual([TARGET, FAR].sort());
    expect(s.admin.calls).toHaveLength(1);
    const [call] = s.admin.calls;
    expect(call.columns).not.toContain("*");
    expect(call.filters).toEqual(
      expect.arrayContaining([
        { kind: "in", column: "id", value: [TARGET, FAR] },
        expect.objectContaining({ kind: "is", column: "deleted_at", value: null }),
        expect.objectContaining({ kind: "neq", column: "role", value: "admin" }),
      ])
    );
  });
});

describe("getPersonPage («Ver perfil», Fase 5.2)", () => {
  it("perfil de quien saldría en /explorar: DTO más bio, estudios, qué busca y el mes", async () => {
    const s = setup();
    const result = await getPersonPage(s.user.client, TARGET, s.deps);
    if (!result.ok) throw new Error(result.error);
    const { profile, state, matchedAt } = result.data;
    expect(profile).toMatchObject({
      id: TARGET,
      bio: "Me gusta cocinar.",
      fieldOfStudy: null,
      seekingStatus: "looking_for_room",
      moveInMonth: "2026-09",
    });
    expect(state).toBeUndefined();
    expect(matchedAt).toBeNull();
    expect(Object.keys(profile).sort()).toEqual(
      [
        "age",
        "bio",
        "budgetRange",
        "differences",
        "fieldOfStudy",
        "fullName",
        "id",
        "moveInMonth",
        "neighborhoods",
        "neighborhoodsTotal",
        "score",
        "seekingStatus",
        "strengths",
        "university",
      ].sort()
    );
    // Columnas explícitas en la lectura extra, filtrada por ese id.
    const extra = s.admin.calls.find((c) => c.columns?.includes("bio"));
    expect(extra?.columns).not.toContain("*");
    expect(extra?.columns).not.toMatch(/email|date_of_birth|budget|answers/);
    expect(extra?.filters).toEqual([{ kind: "eq", column: "id", value: TARGET }]);
  });

  it.each([
    ["id no válido", "x"],
    ["uno mismo", VIEWER],
    ["inexistente o no elegible", "d0000000-0000-4000-8000-000000000009"],
    ["no pasa los filtros duros y no hay match", FAR],
  ])("%s: not_found indistinguible", async (_label, id) => {
    const s = setup();
    expect(await getPersonPage(s.user.client, id, s.deps)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(s.admin.calls.some((c) => c.columns?.includes("bio"))).toBe(false);
  });

  it("con match se ve aunque ya no pase los filtros duros, con el score del match", async () => {
    const s = setup({
      matches: [
        {
          user_a_id: VIEWER,
          user_b_id: FAR,
          compatibility_score: 64,
          created_at: "2026-11-20T10:00:00Z",
        },
      ],
    });
    const result = await getPersonPage(s.user.client, FAR, s.deps);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.state).toBe("matched");
    expect(result.data.profile.score).toBe(64);
    expect(result.data.matchedAt).toBe("2026-11-20T10:00:00Z");
  });

  it("un seeking_status desconocido es unknown (fallo cerrado)", async () => {
    const s = setup({
      extras: { bio: null, seeking_status: "otro", housing_preferences: null },
    });
    expect(await getPersonPage(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "unknown",
    });
  });
});
