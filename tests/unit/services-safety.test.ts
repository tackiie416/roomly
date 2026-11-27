import { describe, expect, it, vi } from "vitest";
import {
  blockUser,
  knownCounterpart,
  listBlockedPeople,
  unblockUser,
  type InterestsDeps,
} from "@/lib/services/interests";
import { evaluateCounterparts } from "@/lib/services/matching";
import { listReportsForAdmin, reportUser, resolveReport } from "@/lib/services/reports";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  getCurrentQuestionnaire,
} from "@/lib/matching/questionnaire";
import type { DbClient } from "@/lib/services/result";
import {
  createFakeSupabase,
  dbError,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";

// Sesión 83 — bloquear, desbloquear y reportar. Las reglas de fondo (quién no
// puede crear qué con un bloqueo, duplicados, límites, inmutabilidad) las
// prueban tests/db/28 y concurrency_blocks.sh; aquí, lo que decide el servidor.

const VIEWER = "00000000-0000-4000-8000-0000000000aa";
const TARGET = "d0000000-0000-4000-8000-000000000001";
const STRANGER = "d0000000-0000-4000-8000-000000000009";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const REPORT = "e0000000-0000-4000-8000-000000000001";
const BCN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const housing = () => ({
  city_id: BCN,
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
  answers: Object.fromEntries(getCurrentQuestionnaire().questions.map((q) => [q.id, 1])),
  completed_at: "2026-10-02T10:00:00Z",
});
const person = (id: string) => ({
  id,
  full_name: `Persona ${id.slice(-1)}`,
  date_of_birth: "2001-03-15",
  role: "user",
  deleted_at: null,
  onboarding_completed_at: "2026-10-01T10:00:00Z",
  housing_preferences: housing(),
  compatibility_responses: response(),
});

type Options = {
  userId?: string | null;
  profile?: unknown;
  /** Bloqueos propios (cliente del usuario). */
  ownBlocks?: unknown[];
  /** Bloqueos en los dos sentidos (lectura de service_role). */
  blocks?: unknown[];
  rpc?: FakeResponse;
  reportInsert?: FakeResponse;
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
      if (call.table === "user_blocks")
        return { data: options.ownBlocks ?? [], error: null };
      if (call.table === "reports" && call.operation === "insert")
        return options.reportInsert ?? { data: null, error: null };
      return { data: [], error: null };
    },
  });
  const admin = createFakeSupabase({
    userId: null,
    respond: (call) => {
      if (call.table === "user_blocks")
        return { data: options.blocks ?? [], error: null };
      const ids = (call.filters.find((f) => f.kind === "in")?.value ?? []) as string[];
      if (call.columns === "id, full_name")
        return {
          data: ids
            .filter((id) => id !== STRANGER)
            .map((id) => ({ id, full_name: "Persona bloqueada" })),
          error: null,
        };
      return { data: [person(TARGET)].filter((r) => ids.includes(r.id)), error: null };
    },
  });
  const rpc = vi.fn(async () => options.rpc ?? { data: "blocked", error: null });
  const deps: InterestsDeps = {
    adminClient: () => admin.client,
    interestsAdminClient: () => ({ rpc }) as unknown as DbClient,
    today: () => "2026-11-26",
  };
  return { user, admin, rpc, deps };
}

describe("knownCounterpart", () => {
  it("alguien que te saldría en /explorar: su nombre", async () => {
    const s = setup();
    expect(await knownCounterpart(s.user.client, TARGET, s.deps)).toEqual({
      ok: true,
      data: { userId: VIEWER, targetId: TARGET, name: "Persona 1" },
    });
  });

  it("alguien a quien ya has bloqueado: también (para reportarla después)", async () => {
    const s = setup({
      ownBlocks: [{ blocked_id: TARGET, created_at: "2026-11-26T10:00:00Z" }],
      blocks: [{ blocker_id: VIEWER, blocked_id: TARGET }],
    });
    expect(await knownCounterpart(s.user.client, TARGET, s.deps)).toEqual({
      ok: true,
      data: { userId: VIEWER, targetId: TARGET, name: "Persona bloqueada" },
    });
  });

  it.each([
    ["un id que no conoces", STRANGER],
    ["una misma", VIEWER],
    ["un id no válido", "no-es-un-id"],
  ])("%s: not_found", async (_label, id) => {
    const s = setup();
    expect(await knownCounterpart(s.user.client, id, s.deps)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("quien te ha bloqueado a ti: not_found, igual que una cuenta que no existe", async () => {
    const s = setup({ blocks: [{ blocker_id: TARGET, blocked_id: VIEWER }] });
    expect(await knownCounterpart(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("evaluateCounterparts con bloqueos", () => {
  it.each([
    ["has bloqueado", { blocker_id: VIEWER, blocked_id: TARGET }],
    ["te ha bloqueado", { blocker_id: TARGET, blocked_id: VIEWER }],
  ])("la persona que %s no se evalúa", async (_label, block) => {
    const s = setup({ blocks: [block] });
    const result = await evaluateCounterparts(
      s.user.client,
      [TARGET],
      { requireHardFilters: false },
      s.deps
    );
    expect(result.ok && result.data.byId.has(TARGET)).toBe(false);
    const blockRead = s.admin.calls.find((c) => c.table === "user_blocks");
    expect(blockRead?.filters).toEqual([
      {
        kind: "or",
        column: "",
        value: `blocker_id.eq.${VIEWER},blocked_id.eq.${VIEWER}`,
      },
    ]);
  });
});

describe("blockUser y unblockUser", () => {
  it("bloquea con la rpc, con el usuario de la sesión", async () => {
    const s = setup();
    expect(await blockUser(s.user.client, TARGET, s.deps)).toEqual({
      ok: true,
      data: { status: "blocked" },
    });
    expect(s.rpc).toHaveBeenCalledWith("block_user", {
      p_blocker: VIEWER,
      p_blocked: TARGET,
    });
    // El cliente del usuario nunca escribe en user_blocks.
    expect(
      s.user.calls.filter((c) => c.table === "user_blocks" && c.operation !== "select")
    ).toEqual([]);
  });

  it("a alguien que no conoces: not_found, sin rpc", async () => {
    const s = setup();
    expect(await blockUser(s.user.client, STRANGER, s.deps)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("el límite de la base de datos: rate_limited", async () => {
    const s = setup({
      rpc: dbError("P0001", "rate_limit_exceeded: 50 bloqueos en 24 h"),
    });
    expect(await blockUser(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("una respuesta inesperada de la rpc es unknown", async () => {
    const s = setup({ rpc: { data: "otra cosa", error: null } });
    expect(await blockUser(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "unknown",
    });
  });

  it("desbloquea con la rpc; un id no válido o una misma, sin rpc", async () => {
    const s = setup({ rpc: { data: "unblocked", error: null } });
    expect(await unblockUser(s.user.client, TARGET, s.deps)).toEqual({
      ok: true,
      data: { status: "unblocked" },
    });
    expect(s.rpc).toHaveBeenCalledWith("unblock_user", {
      p_blocker: VIEWER,
      p_blocked: TARGET,
    });
    s.rpc.mockClear();
    expect((await unblockUser(s.user.client, VIEWER, s.deps)).ok).toBe(false);
    expect((await unblockUser(s.user.client, "x", s.deps)).ok).toBe(false);
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("con la cuenta desactivada no se bloquea", async () => {
    const s = setup({ profile: { id: VIEWER, deleted_at: "2026-11-01T00:00:00Z" } });
    expect(await blockUser(s.user.client, TARGET, s.deps)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });
});

describe("listBlockedPeople", () => {
  it("los bloqueos propios con sus nombres; una cuenta ya no disponible, sin nombre", async () => {
    const s = setup({
      ownBlocks: [
        { blocked_id: TARGET, created_at: "2026-11-26T10:00:00Z" },
        { blocked_id: STRANGER, created_at: "2026-11-25T10:00:00Z" },
      ],
    });
    expect(await listBlockedPeople(s.user.client, s.deps)).toEqual({
      ok: true,
      data: [
        { id: TARGET, name: "Persona bloqueada", blockedAt: "2026-11-26T10:00:00Z" },
        { id: STRANGER, name: null, blockedAt: "2026-11-25T10:00:00Z" },
      ],
    });
    const read = s.user.calls.find((c) => c.table === "user_blocks");
    expect(read?.filters).toContainEqual({
      kind: "eq",
      column: "blocker_id",
      value: VIEWER,
    });
  });
});

describe("reportUser", () => {
  it("inserta con el cliente del usuario: reporter de la sesión, motivo y descripción", async () => {
    const s = setup();
    expect(
      await reportUser(
        s.user.client,
        { targetId: TARGET, reason: "harassment", description: "  Me insulta.\r\n  " },
        s.deps
      )
    ).toEqual({ ok: true, data: { status: "created" } });
    const insert = s.user.calls.find(
      (c) => c.table === "reports" && c.operation === "insert"
    );
    expect(insert?.payload).toEqual({
      reporter_id: VIEWER,
      reported_user_id: TARGET,
      reason: "harassment",
      description: "Me insulta.",
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("sin descripción: null", async () => {
    const s = setup();
    await reportUser(
      s.user.client,
      { targetId: TARGET, reason: "spam", description: "   " },
      s.deps
    );
    const insert = s.user.calls.find((c) => c.operation === "insert");
    expect(insert?.payload?.description).toBeNull();
  });

  it("un reporte abierto ya existente: duplicate, sin error", async () => {
    const s = setup({
      reportInsert: dbError(
        "23505",
        'duplicate key value violates unique constraint "uq_reports_open_user"'
      ),
    });
    expect(
      await reportUser(
        s.user.client,
        { targetId: TARGET, reason: "spam", description: "" },
        s.deps
      )
    ).toEqual({ ok: true, data: { status: "duplicate" } });
  });

  it("el límite diario: rate_limited", async () => {
    const s = setup({
      reportInsert: dbError("P0001", "rate_limit_exceeded: 10 reportes en 24 h"),
    });
    expect(
      await reportUser(
        s.user.client,
        { targetId: TARGET, reason: "spam", description: "" },
        s.deps
      )
    ).toEqual({ ok: false, error: "rate_limited" });
  });

  it.each([
    ["un motivo fuera del catálogo", { reason: "otro", description: "" }, "reason"],
    [
      "una descripción demasiado larga",
      { reason: "spam", description: "a".repeat(1001) },
      "description",
    ],
  ])("%s: validation, sin insertar", async (_label, input, field) => {
    const s = setup();
    const result = await reportUser(
      s.user.client,
      { targetId: TARGET, ...input },
      s.deps
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation");
      expect(Object.keys(result.fieldErrors ?? {})).toEqual([field]);
    }
    expect(s.user.calls.filter((c) => c.operation === "insert")).toEqual([]);
  });

  it.each([STRANGER, VIEWER, "no-es-un-id"])(
    "a alguien que no conoces (%s): not_found, sin insertar",
    async (id) => {
      const s = setup();
      expect(
        await reportUser(
          s.user.client,
          { targetId: id, reason: "spam", description: "" },
          s.deps
        )
      ).toEqual({ ok: false, error: "not_found" });
      expect(s.user.calls.filter((c) => c.operation === "insert")).toEqual([]);
    }
  );
});

describe("revisión de reportes (admin)", () => {
  const adminClient = (role: string, extra: Partial<Record<string, FakeResponse>> = {}) =>
    createFakeSupabase({
      userId: ADMIN,
      respond: (call) => {
        if (call.table === "profiles" && call.terminal === "maybeSingle")
          return { data: { id: ADMIN, role, deleted_at: null }, error: null };
        if (call.table === "profiles")
          return {
            data: [
              { id: VIEWER, full_name: "Quien reporta", deleted_at: null },
              { id: TARGET, full_name: "Reportada", deleted_at: "2026-11-20T00:00:00Z" },
            ],
            error: null,
          };
        if (call.table === "reports" && call.operation === "select")
          return {
            data: [
              {
                id: REPORT,
                reporter_id: VIEWER,
                reported_user_id: TARGET,
                reported_room_id: null,
                reason: "harassment",
                description: "texto",
                status: "pending",
                created_at: "2026-11-26T10:00:00Z",
                resolved_at: null,
                resolution_notes: null,
              },
            ],
            error: null,
          };
        if (call.table === "reports" && call.operation === "update")
          return (
            extra.update ?? { data: [{ id: REPORT, status: "resolved" }], error: null }
          );
        return { data: null, error: null };
      },
    });

  it("un usuario que no es admin: forbidden, sin leer reportes", async () => {
    const fake = adminClient("user");
    expect(await listReportsForAdmin(fake.client, "open")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(fake.calls.filter((c) => c.table === "reports")).toEqual([]);
    expect(
      await resolveReport(fake.client, {
        reportId: REPORT,
        status: "resolved",
        notes: "",
      })
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("el admin ve los abiertos con nombres, en 3 consultas y sin emails", async () => {
    const fake = adminClient("admin");
    const result = await listReportsForAdmin(fake.client, "open");
    expect(result.ok && result.data).toEqual([
      expect.objectContaining({
        id: REPORT,
        reporter: { id: VIEWER, name: "Quien reporta" },
        reported: { id: TARGET, name: "Reportada", deactivated: true },
        room: null,
      }),
    ]);
    const reads = fake.calls.filter(
      (c) => c.table !== "profiles" || c.terminal !== "maybeSingle"
    );
    expect(reads.map((c) => c.table)).toEqual(["reports", "profiles"]);
    expect(reads.every((c) => !c.columns?.includes("email") && c.columns !== "*")).toBe(
      true
    );
    expect(reads[0].filters).toContainEqual({
      kind: "in",
      column: "status",
      value: ["pending", "in_review"],
    });
  });

  const withRpc = (fake: ReturnType<typeof adminClient>, response: unknown) => {
    const rpc = vi.fn().mockResolvedValue(response);
    (fake.client as unknown as { rpc: typeof rpc }).rpc = rpc;
    return rpc;
  };

  it("resolver: una sola llamada a admin_set_report_status, sin escribir tablas", async () => {
    const fake = adminClient("admin");
    const rpc = withRpc(fake, { data: "resolved", error: null });
    expect(
      await resolveReport(fake.client, {
        reportId: REPORT,
        status: "resolved",
        notes: " avisada ",
      })
    ).toEqual({ ok: true, data: { status: "resolved" } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_set_report_status", {
      p_report_id: REPORT,
      p_status: "resolved",
      p_notes: "avisada",
      p_measure: "none",
    });
    expect(fake.calls.filter((c) => c.operation !== "select")).toEqual([]);
    expect(fake.calls.filter((c) => c.table === "admin_action_logs")).toEqual([]);
  });

  it("un reporte que no existe: not_found", async () => {
    const fake = adminClient("admin");
    withRpc(fake, {
      data: null,
      error: { code: "P0002", message: "admin_not_found: report" },
    });
    expect(
      await resolveReport(fake.client, {
        reportId: REPORT,
        status: "dismissed",
        notes: "duplicado",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(fake.calls.filter((c) => c.table === "admin_action_logs")).toEqual([]);
  });

  it("un estado inventado: validation, sin consultas", async () => {
    const fake = adminClient("admin");
    expect(
      await resolveReport(fake.client, { reportId: REPORT, status: "borrado", notes: "" })
    ).toEqual({ ok: false, error: "validation" });
    expect(fake.calls).toEqual([]);
  });
});
