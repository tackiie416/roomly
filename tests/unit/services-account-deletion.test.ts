import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("los tests inyectan el cliente admin");
  },
}));

import {
  ACCOUNT_DELETION_CONFIRMATION,
  deleteOwnAccount,
  type AccountDeletionDeps,
  type AccountDeletionEvent,
} from "@/lib/services/account-deletion";
import { removeAccountRoomObjects, type RecoveryEvent } from "@/lib/services/room-images";
import type { DbClient } from "@/lib/services/result";
import { createFakeSupabase } from "./helpers/fake-supabase";

// Sesión 87 — eliminación de la cuenta propia (20261201120000). El id sale
// siempre de la sesión; el orden es solicitud → Storage → datos → Auth →
// completar, y cualquier fallo deja la cuenta desactivada y la solicitud
// pendiente (se puede repetir).

const ME = "d0000000-0000-4000-8000-000000000001";
const ROOM_A = "f0000000-0000-4000-8000-00000000000a";
const ROOM_B = "f0000000-0000-4000-8000-00000000000b";
const VALID = { confirmation: "eliminar", acknowledge: true };

type Rpc = { name: string; args: unknown };
type RpcReply = { data: unknown; error: { code?: string; message?: string } | null };

function createAdmin(
  replies: Partial<Record<string, RpcReply>> = {},
  deleteUser: { error: { status?: number; message?: string } | null } = { error: null }
) {
  const rpcs: Rpc[] = [];
  const deleted: string[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return (
        replies[name] ??
        {
          request_account_deletion: {
            data: { status: "pending", rooms: [ROOM_A, ROOM_B] },
            error: null,
          },
          delete_account_data: { data: { status: "deleted" }, error: null },
          complete_account_deletion: { data: true, error: null },
        }[name] ?? { data: null, error: { code: "42883" } }
      );
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          deleted.push(id);
          return { data: null, ...deleteUser };
        },
      },
    },
  };
  return { client: client as unknown as DbClient, rpcs, deleted };
}

let events: AccountDeletionEvent[];
let cleaned: Array<[string, string]>;

function deps(
  admin: ReturnType<typeof createAdmin>,
  complete: (roomId: string) => boolean = () => true
): AccountDeletionDeps {
  return {
    deletionAdminClient: () => admin.client,
    removeRoomObjects: async (roomId, ownerId) => {
      cleaned.push([roomId, ownerId]);
      return { complete: complete(roomId) };
    },
    report: (event) => {
      events.push(event);
    },
  };
}

beforeEach(() => {
  events = [];
  cleaned = [];
});

describe("deleteOwnAccount: validación y sesión", () => {
  it.each([
    [{}],
    [{ confirmation: "borrar", acknowledge: true }],
    [{ confirmation: "ELIMINAR", acknowledge: false }],
    [{ confirmation: "ELIMINAR", acknowledge: "true" }],
    [{ ...VALID, userId: "d0000000-0000-4000-8000-000000000002" }],
  ])("rechaza %j sin crear el cliente admin", async (input) => {
    const admin = createAdmin();
    const fake = createFakeSupabase({ userId: ME });
    const spy = vi.fn(() => admin.client);
    const result = await deleteOwnAccount(fake.client, input, {
      ...deps(admin),
      deletionAdminClient: spy,
    });
    expect(result).toMatchObject({ ok: false, error: "validation" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("acepta la palabra con espacios y en minúsculas", async () => {
    expect(ACCOUNT_DELETION_CONFIRMATION).toBe("ELIMINAR");
    const admin = createAdmin();
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      { confirmation: "  Eliminar ", acknowledge: true },
      deps(admin)
    );
    expect(result).toEqual({ ok: true, data: { deleted: true } });
  });

  it("sin sesión: unauthenticated, sin cliente admin", async () => {
    const admin = createAdmin();
    const spy = vi.fn(() => admin.client);
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: null }).client,
      VALID,
      { ...deps(admin), deletionAdminClient: spy }
    );
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("deleteOwnAccount: orden e idempotencia", () => {
  it("solicitud → Storage de cada habitación → datos → Auth → completar, con el id de la sesión", async () => {
    const admin = createAdmin();
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin)
    );
    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(admin.rpcs).toEqual([
      { name: "request_account_deletion", args: { p_user_id: ME } },
      { name: "delete_account_data", args: { p_user_id: ME } },
      { name: "complete_account_deletion", args: { p_user_id: ME } },
    ]);
    expect(cleaned).toEqual([
      [ROOM_A, ME],
      [ROOM_B, ME],
    ]);
    expect(admin.deleted).toEqual([ME]);
    expect(events).toEqual([]);
  });

  it("si Storage no queda vacío, se detiene antes de borrar datos y Auth", async () => {
    const admin = createAdmin();
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin, (roomId) => roomId !== ROOM_B)
    );
    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(admin.rpcs.map((r) => r.name)).toEqual(["request_account_deletion"]);
    expect(admin.deleted).toEqual([]);
    expect(events).toEqual(["account_deletion_storage_pending"]);
  });

  it("si delete_account_data falla (fotos pendientes), no borra el usuario de Auth", async () => {
    const admin = createAdmin({
      delete_account_data: { data: null, error: { code: "55000", message: "x" } },
    });
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin)
    );
    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(admin.deleted).toEqual([]);
    expect(events).toEqual(["account_deletion_storage_pending"]);
  });

  it("un error de la solicitud no avanza", async () => {
    const admin = createAdmin({
      request_account_deletion: { data: null, error: { code: "P0002" } },
    });
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin)
    );
    expect(result).toEqual({ ok: false, error: "unknown" });
    expect(admin.rpcs).toHaveLength(1);
    expect(admin.deleted).toEqual([]);
  });

  it("reintento con el perfil ya borrado: salta Storage y datos, y termina", async () => {
    const admin = createAdmin(
      {
        request_account_deletion: {
          data: { status: "profile_absent", rooms: [] },
          error: null,
        },
      },
      { error: { status: 404, message: "User not found" } }
    );
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin)
    );
    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(admin.rpcs.map((r) => r.name)).toEqual([
      "request_account_deletion",
      "complete_account_deletion",
    ]);
    expect(cleaned).toEqual([]);
  });

  it("si Auth falla (no 404), queda pendiente y no marca la solicitud", async () => {
    const admin = createAdmin({}, { error: { status: 500, message: "down" } });
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin)
    );
    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(admin.rpcs.map((r) => r.name)).not.toContain("complete_account_deletion");
    expect(events).toEqual(["account_deletion_auth_failed"]);
  });

  it("si completar falla, la cuenta ya no existe: ok con aviso", async () => {
    const admin = createAdmin({
      complete_account_deletion: { data: false, error: null },
    });
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin)
    );
    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(events).toEqual(["account_deletion_complete_failed"]);
  });

  it("una respuesta inesperada de la solicitud no se usa (ids que no son UUID)", async () => {
    const admin = createAdmin({
      request_account_deletion: {
        data: { status: "pending", rooms: ["../otra-carpeta"] },
        error: null,
      },
    });
    const result = await deleteOwnAccount(
      createFakeSupabase({ userId: ME }).client,
      VALID,
      deps(admin)
    );
    expect(result.ok).toBe(false);
    expect(cleaned).toEqual([]);
  });
});

// --------------------------------------------------- removeAccountRoomObjects
function storageWorld(options: {
  room?: { owner_id: string } | null;
  profile?: { deleted_at: string | null } | null;
  request?: { completed_at: string | null } | null;
  objects: string[];
  stuck?: string[];
}) {
  const objects = new Set(options.objects);
  const removed: string[][] = [];
  const reply = (table: string) => {
    if (table === "rooms")
      return options.room === undefined ? { owner_id: ME } : options.room;
    if (table === "profiles")
      return options.profile === undefined
        ? { deleted_at: "2026-11-28T00:00:00Z" }
        : options.profile;
    return options.request === undefined ? { completed_at: null } : options.request;
  };
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: reply(table), error: null }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        list: async (prefix: string) => ({
          data: [...objects]
            .filter((path) => path.startsWith(`${prefix}/`))
            .map((path) => ({ name: path.slice(prefix.length + 1) })),
          error: null,
        }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          for (const path of paths)
            if (!options.stuck?.includes(path)) objects.delete(path);
          return { data: [], error: null };
        },
      }),
    },
  };
  return { client: client as unknown as DbClient, objects, removed };
}

function imageDeps(world: ReturnType<typeof storageWorld>, recoveries: RecoveryEvent[]) {
  return {
    adminClient: () => world.client,
    sanitize: async () => {
      throw new Error("no se usa");
    },
    newId: () => "x",
    now: () => new Date(),
    signedUrlTtlSeconds: 600,
    reportRecovery: (event: RecoveryEvent) => {
      recoveries.push(event);
    },
  };
}

describe("removeAccountRoomObjects", () => {
  const A1 = `${ROOM_A}/a0000000-0000-4000-8000-000000000001.webp`;
  const A2 = `${ROOM_A}/a0000000-0000-4000-8000-000000000002.webp`;
  const B1 = `${ROOM_B}/b0000000-0000-4000-8000-000000000001.webp`;

  it("vacía solo la carpeta de esa habitación y lo comprueba", async () => {
    const world = storageWorld({ objects: [A1, A2, B1] });
    const recoveries: RecoveryEvent[] = [];
    expect(
      await removeAccountRoomObjects(ROOM_A, ME, imageDeps(world, recoveries))
    ).toEqual({ complete: true });
    expect([...world.objects]).toEqual([B1]);
    expect(world.removed.flat().every((path) => path.startsWith(`${ROOM_A}/`))).toBe(
      true
    );
  });

  it.each([
    [
      "la habitación es de otra persona",
      { room: { owner_id: "d0000000-0000-4000-8000-000000000002" } },
    ],
    ["la cuenta sigue activa", { profile: { deleted_at: null } }],
    ["no hay solicitud", { request: null }],
    [
      "la solicitud ya está completada",
      { request: { completed_at: "2026-11-28T00:00:00Z" } },
    ],
  ])("no borra nada si %s", async (_label, options) => {
    const world = storageWorld({ objects: [A1], ...options });
    const recoveries: RecoveryEvent[] = [];
    expect(
      await removeAccountRoomObjects(ROOM_A, ME, imageDeps(world, recoveries))
    ).toEqual({ complete: false });
    expect(world.removed).toEqual([]);
    expect(recoveries).toEqual(["account_room_objects_skipped"]);
  });

  it("ids que no son UUID: no hace nada", async () => {
    const world = storageWorld({ objects: [A1] });
    expect(await removeAccountRoomObjects("../x", ME, imageDeps(world, []))).toEqual({
      complete: false,
    });
    expect(world.removed).toEqual([]);
  });

  it("si un objeto no se borra, nunca informa de una limpieza completa", async () => {
    const world = storageWorld({ objects: [A1, A2], stuck: [A2] });
    const recoveries: RecoveryEvent[] = [];
    expect(
      await removeAccountRoomObjects(ROOM_A, ME, imageDeps(world, recoveries))
    ).toEqual({ complete: false });
    expect(recoveries).toEqual(["account_room_objects_remaining"]);
  });
});
