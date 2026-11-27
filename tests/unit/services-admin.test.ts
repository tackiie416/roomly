import { describe, expect, it, vi } from "vitest";
import {
  getAdminMetrics,
  getUserForAdmin,
  listRoomsForAdmin,
  listUsersForAdmin,
  mapAdminError,
  moderateRoom,
  moderateUser,
} from "@/lib/services/admin";
import { parseRoomFilters, parseUserFilters } from "@/lib/validation/admin";
import { createFakeSupabase } from "./helpers/fake-supabase";

// Fase 7 — lib/services/admin.ts: comprobación de admin antes de cada
// llamada, validación de la entrada, una sola función admin_* por operación
// y errores de la base de datos traducidos sin detalles. Sin service_role: el
// cliente es siempre el del usuario.

const ADMIN = "a0000000-0000-4000-8000-000000000001";
const TARGET = "d0000000-0000-4000-8000-000000000001";
const ROOM = "f0000000-0000-4000-8000-000000000001";

function client(
  role: "admin" | "user" | null,
  rpcResponse: unknown = { data: null, error: null },
  opts: { deleted?: boolean; userId?: string | null } = {}
) {
  const fake = createFakeSupabase({
    userId: opts.userId === undefined ? ADMIN : opts.userId,
    respond: (call) =>
      call.table === "profiles" && call.terminal === "maybeSingle"
        ? {
            data:
              role === null
                ? null
                : {
                    role,
                    deleted_at: opts.deleted ? "2026-11-01T00:00:00Z" : null,
                  },
            error: null,
          }
        : { data: null, error: null },
  });
  const rpc = vi.fn().mockResolvedValue(rpcResponse);
  (fake.client as unknown as { rpc: typeof rpc }).rpc = rpc;
  return { ...fake, rpc };
}

const USER_FILTERS = parseUserFilters({});
const ROOM_FILTERS = parseRoomFilters({});

describe("mapAdminError", () => {
  it.each([
    [{ code: "42501", message: "admin_forbidden" }, "forbidden"],
    [{ code: "P0002", message: "admin_not_found: user" }, "not_found"],
    [{ code: "22023", message: "admin_invalid: reason" }, "validation"],
    [{ code: "23514", message: "admin_state: already_suspended" }, "conflict"],
    [{ code: "23505", message: "duplicate key" }, "conflict"],
    [{ code: "23514", message: "chk_otra_cosa" }, "unknown"],
    [{ code: "XX000", message: "boom" }, "unknown"],
  ])("%o → %s", (error, expected) => {
    expect(mapAdminError(error)).toEqual({ ok: false, error: expected });
  });
});

describe("guard de admin en cada operación", () => {
  const operations: [string, (c: ReturnType<typeof client>) => Promise<unknown>][] = [
    ["listUsersForAdmin", (c) => listUsersForAdmin(c.client, USER_FILTERS)],
    ["listRoomsForAdmin", (c) => listRoomsForAdmin(c.client, ROOM_FILTERS)],
    ["getUserForAdmin", (c) => getUserForAdmin(c.client, TARGET)],
    ["getAdminMetrics", (c) => getAdminMetrics(c.client)],
    [
      "moderateUser",
      (c) =>
        moderateUser(c.client, "suspend", {
          targetId: TARGET,
          reason: "spam reiterado",
          confirm: "on",
        }),
    ],
    [
      "moderateRoom",
      (c) =>
        moderateRoom(c.client, "remove", {
          targetId: ROOM,
          reason: "anuncio falso",
          confirm: "on",
        }),
    ],
  ];

  it.each(operations)(
    "%s: un usuario normal recibe forbidden sin rpc",
    async (_n, run) => {
      const c = client("user");
      expect(await run(c)).toEqual({ ok: false, error: "forbidden" });
      expect(c.rpc).not.toHaveBeenCalled();
    }
  );

  it.each(operations)("%s: un admin desactivado recibe forbidden", async (_n, run) => {
    const c = client("admin", undefined, { deleted: true });
    expect(await run(c)).toEqual({ ok: false, error: "forbidden" });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(operations)("%s: sin sesión, unauthenticated", async (_n, run) => {
    const c = client(null, undefined, { userId: null });
    expect(await run(c)).toEqual({ ok: false, error: "unauthenticated" });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("si la base de datos rechaza (42501) aunque la app crea que es admin: forbidden", async () => {
    const c = client("admin", {
      data: null,
      error: { code: "42501", message: "admin_forbidden" },
    });
    expect(await getAdminMetrics(c.client)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("listados", () => {
  it("usuarios: filtros y paginación a la función, total y páginas", async () => {
    const row = {
      id: TARGET,
      full_name: "Ana",
      role: "user",
      seeking_status: "looking",
      created_at: "2026-11-01T00:00:00Z",
      onboarding_completed_at: null,
      deleted_at: "2026-11-20T00:00:00Z",
      open_reports: 2,
      rooms_count: 1,
      total_count: 51,
    };
    const c = client("admin", { data: [row], error: null });
    const result = await listUsersForAdmin(
      c.client,
      parseUserFilters({ q: "  ana ", estado: "suspended", reportados: "1", pagina: "3" })
    );
    expect(c.rpc).toHaveBeenCalledWith("admin_list_users", {
      p_search: "ana",
      p_status: "suspended",
      p_role: "all",
      p_onboarding: "all",
      p_reported: true,
      p_limit: 25,
      p_offset: 50,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: TARGET,
            fullName: "Ana",
            role: "user",
            seekingStatus: "looking",
            createdAt: "2026-11-01T00:00:00Z",
            onboardingCompleted: false,
            suspended: true,
            openReports: 2,
            roomsCount: 1,
          },
        ],
        total: 51,
        page: 3,
        pageCount: 3,
      },
    });
  });

  it("filtros desconocidos o enormes vuelven a los valores por defecto", () => {
    expect(
      parseUserFilters({
        q: "x".repeat(101),
        estado: "borrada",
        rol: "superadmin",
        onboarding: ["complete", "incomplete"],
        pagina: "-4",
      })
    ).toEqual({
      search: "",
      status: "all",
      role: "all",
      onboarding: "complete",
      reported: false,
      page: 1,
    });
    expect(parseRoomFilters({ estado: "deleted", pagina: "99999" })).toMatchObject({
      status: "all",
      page: 1,
    });
  });

  it("habitaciones vacías: página 1 de 1, sin error", async () => {
    const c = client("admin", { data: [], error: null });
    expect(await listRoomsForAdmin(c.client, ROOM_FILTERS)).toEqual({
      ok: true,
      data: { items: [], total: 0, page: 1, pageCount: 1 },
    });
  });
});

describe("ficha de usuario", () => {
  it("un id que no es UUID: not_found sin llamar a nada", async () => {
    const c = client("admin");
    expect(await getUserForAdmin(c.client, "../admin")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(c.calls).toEqual([]);
  });

  it("marca isSelf para que la página no ofrezca suspenderse a sí mismo", async () => {
    const c = client("admin", { data: { id: ADMIN, role: "admin" }, error: null });
    const result = await getUserForAdmin(c.client, ADMIN);
    expect(result.ok && result.data.isSelf).toBe(true);
    expect(result.ok && result.data.role).toBe("admin");
  });
});

describe("acciones sensibles", () => {
  it("suspender: motivo recortado y una sola llamada", async () => {
    const c = client("admin", { data: "suspended", error: null });
    expect(
      await moderateUser(c.client, "suspend", {
        targetId: TARGET,
        reason: "  spam reiterado \r\n",
        confirm: "on",
      })
    ).toEqual({ ok: true, data: { result: "suspended" } });
    expect(c.rpc).toHaveBeenCalledTimes(1);
    expect(c.rpc).toHaveBeenCalledWith("admin_suspend_user", {
      p_user_id: TARGET,
      p_reason: "spam reiterado",
    });
  });

  it("restaurar habitación usa admin_restore_room", async () => {
    const c = client("admin", { data: "paused", error: null });
    await moderateRoom(c.client, "restore", {
      targetId: ROOM,
      reason: "revisada",
      confirm: "on",
    });
    expect(c.rpc).toHaveBeenCalledWith("admin_restore_room", {
      p_room_id: ROOM,
      p_reason: "revisada",
    });
  });

  it.each([
    ["sin confirmar", { targetId: TARGET, reason: "spam reiterado", confirm: undefined }],
    ["motivo corto", { targetId: TARGET, reason: " a ", confirm: "on" }],
    ["motivo enorme", { targetId: TARGET, reason: "x".repeat(1001), confirm: "on" }],
    ["sin motivo", { targetId: TARGET, reason: null, confirm: "on" }],
  ])("%s: validation sin llamar a la base de datos", async (_n, input) => {
    const c = client("admin");
    const result = await moderateUser(c.client, "suspend", input);
    expect(result).toMatchObject({ ok: false, error: "validation" });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("un objetivo que no es UUID: not_found (IDOR sin pistas)", async () => {
    const c = client("admin");
    expect(
      await moderateRoom(c.client, "remove", {
        targetId: "1 or 1=1",
        reason: "anuncio falso",
        confirm: "on",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("suspender a otro admin o a uno mismo: la base de datos lo rechaza y se traduce", async () => {
    const c = client("admin", {
      data: null,
      error: { code: "23514", message: "admin_state: target_is_admin" },
    });
    expect(
      await moderateUser(c.client, "suspend", {
        targetId: TARGET,
        reason: "prueba",
        confirm: "on",
      })
    ).toEqual({ ok: false, error: "conflict" });
  });

  it("una excepción del cliente no se propaga: unknown", async () => {
    const c = client("admin");
    c.rpc.mockRejectedValue(new Error("red caída con detalles internos"));
    expect(await getAdminMetrics(c.client)).toEqual({ ok: false, error: "unknown" });
  });
});

describe("métricas", () => {
  it("solo números agregados; los ausentes cuentan 0", async () => {
    const c = client("admin", {
      data: {
        generated_at: "2026-11-27T10:00:00Z",
        users: { total: 10, active: 9 },
        reports: { pending: 2, avg_hours_to_close_30d: null },
        admin_actions_7d: 4,
      },
      error: null,
    });
    const result = await getAdminMetrics(c.client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.users).toMatchObject({ total: 10, active: 9, suspended: 0 });
    expect(result.data.reports.avg_hours_to_close_30d).toBeNull();
    expect(result.data.adminActions7d).toBe(4);
    expect(JSON.stringify(result.data)).not.toMatch(/email|full_name|@/);
  });
});
