import type { DbClient } from "@/lib/services/result";
import { createFakeSupabase, type Call, type FakeResponse } from "./fake-supabase";
import { TEST_USER } from "./profile-rows";

/**
 * Habitaciones, fotos y objetos de Storage en memoria, para probar las Server
 * Actions, el borrado de habitaciones y las páginas de la Fase 4.2 con los
 * servicios reales. Emula lo justo de la base de datos y de Storage:
 *   - cliente del usuario (RLS): ve sus habitaciones, las públicas (activas,
 *     sin borrar y de una cuenta activa) y, si es admin activo, todas; borra
 *     solo las suyas con la cuenta activa (`rooms_delete_own`), y el borrado
 *     arrastra las filas de `room_images` (ON DELETE CASCADE), no los objetos;
 *   - cliente admin (service_role): INSERT y DELETE de `room_images` con las
 *     reglas del trigger (8 fotos, habitación escribible, cuenta activa y ruta
 *     canónica), lectura de `rooms` sin RLS y Storage (subir, borrar, firmar y
 *     listar).
 * No es PostgreSQL ni Storage: tests/db cubre la base de datos real.
 */

export const OTHER_USER = "99999999-8888-4777-8666-555555555555";
export const ROOM_ID = "22222222-3333-4444-8555-666666666666";
export const OTHER_ROOM_ID = "44444444-3333-4444-8555-666666666666";

export type WorldRoom = {
  id: string;
  owner_id: string;
  title: string;
  status: string;
  deleted_at: string | null;
};

export type WorldImage = {
  id: string;
  room_id: string;
  storage_path: string;
  position: number;
  created_at: string;
};

type Failure = { code?: string; message?: string } | null | undefined;
type StorageOp = "upload" | "remove" | "sign" | "list";

export type WorldOptions = {
  userId?: string | null;
  /** `null`: sin perfil. */
  profile?: { deleted_at?: string | null; role?: string } | null;
  rooms?: WorldRoom[];
  images?: WorldImage[];
  /** Objetos ya guardados en el bucket (rutas). */
  objects?: string[];
  /** Perfiles de otras personas (para la visibilidad pública): id → deleted_at. */
  owners?: Record<string, string | null>;
};

export const room = (overrides: Partial<WorldRoom> = {}): WorldRoom => ({
  id: ROOM_ID,
  owner_id: TEST_USER,
  title: "Habitación luminosa en Gràcia",
  status: "draft",
  deleted_at: null,
  ...overrides,
});

export const worldImage = (n: number, roomId = ROOM_ID): WorldImage => {
  const id = `${String(n).repeat(8)}-4444-4555-8666-777777777777`;
  return {
    id,
    room_id: roomId,
    storage_path: `${roomId}/${id}.webp`,
    position: n,
    created_at: `2026-10-2${n % 10}T10:00:00.000Z`,
  };
};

const signed = (path: string) =>
  `https://storage.test/sign/${path}?token=tok-${path.length}`;

export function createRoomWorld(options: WorldOptions = {}) {
  const userId = options.userId === undefined ? TEST_USER : options.userId;
  const profile =
    options.profile === null
      ? null
      : {
          id: TEST_USER,
          full_name: "Ana García",
          date_of_birth: "2000-05-10",
          bio: null,
          seeking_status: "looking_for_room",
          email_notifications_enabled: true,
          onboarding_completed_at: "2026-09-20T10:00:00Z",
          deleted_at: options.profile?.deleted_at ?? null,
          role: options.profile?.role ?? "user",
        };
  const owners: Record<string, string | null> = { ...(options.owners ?? {}) };
  if (profile) owners[profile.id] = profile.deleted_at;

  const state = {
    rooms: [...(options.rooms ?? [])],
    images: [...(options.images ?? [])],
    objects: new Set(options.objects ?? []),
    uploads: [] as Array<{ path: string; body: unknown; options: unknown }>,
    /** Orden de todas las operaciones de los dos clientes y de Storage. */
    log: [] as string[],
    adminCreated: 0,
  };
  const failures = {
    user: undefined as ((call: Call) => Failure) | undefined,
    admin: undefined as ((call: Call) => Failure) | undefined,
    storage: {} as Partial<Record<StorageOp, (n: number) => Failure>>,
  };
  const storageCount: Record<StorageOp, number> = {
    upload: 0,
    remove: 0,
    sign: 0,
    list: 0,
  };

  const ownerActive = (ownerId: string) => owners[ownerId] === null;
  const isAdmin = () => profile?.role === "admin" && profile.deleted_at === null;
  const visibleRoom = (r: WorldRoom) =>
    r.owner_id === userId ||
    isAdmin() ||
    (r.status === "active" && r.deleted_at === null && ownerActive(r.owner_id));

  const applyFilters = <T extends Record<string, unknown>>(rows: T[], call: Call) =>
    rows.filter((row) =>
      call.filters.every((f) => {
        if (f.kind === "eq") return row[f.column] === f.value;
        if (f.kind === "in") return (f.value as unknown[]).includes(row[f.column]);
        if (f.kind === "is") return row[f.column] === f.value;
        throw new Error(`filtro no emulado: ${f.kind}`);
      })
    );

  const sortImages = (rows: WorldImage[]) =>
    [...rows].sort(
      (a, b) =>
        a.position - b.position ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id)
    );

  const finish = (call: Call, rows: unknown[]): FakeResponse => {
    if (call.terminal === "await") return { data: rows, error: null };
    if (call.terminal === "single")
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "0 o varias filas" } };
    return { data: rows[0] ?? null, error: null };
  };

  const cascadeDelete = (roomIds: string[]) => {
    state.rooms = state.rooms.filter((r) => !roomIds.includes(r.id));
    state.images = state.images.filter((i) => !roomIds.includes(i.room_id));
  };

  const userRespond = (call: Call): FakeResponse => {
    state.log.push(`user:${call.table}.${call.operation}`);
    const injected = failures.user?.(call);
    if (injected) return { data: null, error: injected };
    if (call.table === "profiles") return { data: profile, error: null };
    if (call.table === "housing_preferences") return { data: null, error: null };
    if (call.table === "rooms") {
      if (call.operation === "select")
        return finish(call, applyFilters(state.rooms.filter(visibleRoom), call));
      if (call.operation === "delete") {
        // rooms_delete_own: propietaria con la cuenta activa (RLS, 4.0).
        const targets = applyFilters(state.rooms, call).filter(
          (r) => r.owner_id === userId && profile !== null && profile.deleted_at === null
        );
        cascadeDelete(targets.map((r) => r.id));
        return finish(
          call,
          targets.map((r) => ({ id: r.id }))
        );
      }
    }
    if (call.table === "room_images" && call.operation === "select") {
      const visible = state.images.filter((i) => {
        const r = state.rooms.find((candidate) => candidate.id === i.room_id);
        return r !== undefined && visibleRoom(r);
      });
      return finish(call, sortImages(applyFilters(visible, call)));
    }
    // El cliente del usuario no escribe en room_images (sin GRANT).
    return { data: null, error: { code: "42501", message: "permission denied" } };
  };

  const triggerError = (prefix: string): FakeResponse => ({
    data: null,
    error: { code: "23514", message: `${prefix} <detalle interno del trigger>` },
  });

  const adminRespond = (call: Call): FakeResponse => {
    state.log.push(`admin:${call.table}.${call.operation}`);
    const injected = failures.admin?.(call);
    if (injected) return { data: null, error: injected };
    if (call.table === "rooms" && call.operation === "select")
      return finish(call, applyFilters(state.rooms, call));
    if (call.table === "room_images" && call.operation === "insert") {
      const payload = call.payload as Omit<WorldImage, "created_at">;
      const target = state.rooms.find((r) => r.id === payload.room_id);
      if (!target)
        return {
          data: null,
          error: { code: "23503", message: "room_images_room_id_fkey" },
        };
      if (target.deleted_at !== null || target.status === "removed")
        return triggerError("room_not_writable:");
      if (!ownerActive(target.owner_id)) return triggerError("account_deleted:");
      if (state.images.filter((i) => i.room_id === target.id).length >= 8)
        return triggerError("room_images_limit:");
      if (payload.storage_path !== `${payload.room_id}/${payload.id}.webp`)
        return {
          data: null,
          error: { code: "23514", message: "chk_room_images_storage_path" },
        };
      const row = { ...payload, created_at: new Date().toISOString() };
      state.images.push(row);
      return finish(call, [row]);
    }
    if (call.table === "room_images" && call.operation === "delete") {
      const targets = applyFilters(state.images, call);
      state.images = state.images.filter((i) => !targets.includes(i));
      return finish(
        call,
        targets.map((i) => ({ id: i.id }))
      );
    }
    throw new Error(`admin: operación no emulada ${call.table}.${call.operation}`);
  };

  const storageFailure = (op: StorageOp) => {
    storageCount[op] += 1;
    state.log.push(`storage.${op}`);
    return failures.storage[op]?.(storageCount[op]);
  };

  const storage = {
    from: (bucket: string) => {
      if (bucket !== "room-images") throw new Error(`bucket inesperado: ${bucket}`);
      return {
        upload: async (path: string, body: unknown, uploadOptions: unknown) => {
          const failure = storageFailure("upload");
          if (failure) return { data: null, error: failure };
          if (state.objects.has(path))
            return { data: null, error: { message: "The resource already exists" } };
          state.objects.add(path);
          state.uploads.push({ path, body, options: uploadOptions });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          const failure = storageFailure("remove");
          if (failure) return { data: null, error: failure };
          const removed = paths.filter((p) => state.objects.delete(p));
          return { data: removed.map((name) => ({ name })), error: null };
        },
        createSignedUrls: async (paths: string[]) => {
          const failure = storageFailure("sign");
          if (failure) return { data: null, error: failure };
          return {
            data: paths.map((path) =>
              state.objects.has(path)
                ? { path, signedUrl: signed(path), error: null }
                : { path, signedUrl: null, error: "Object not found" }
            ),
            error: null,
          };
        },
        list: async (prefix: string, listOptions?: { limit?: number }) => {
          const failure = storageFailure("list");
          if (failure) return { data: null, error: failure };
          const folder = `${prefix}/`;
          const names = [...state.objects]
            .filter((p) => p.startsWith(folder))
            .map((p) => p.slice(folder.length))
            .sort()
            .slice(0, listOptions?.limit ?? 100);
          return {
            data: names.map((name) => ({ name, id: `obj-${name}` })),
            error: null,
          };
        },
      };
    },
  };

  const user = createFakeSupabase({ userId, respond: userRespond });
  const admin = createFakeSupabase({ userId: null, respond: adminRespond });
  const adminClient = {
    ...(admin.client as unknown as object),
    storage,
  } as unknown as DbClient;

  return {
    state,
    failures,
    userClient: user.client,
    userCalls: user.calls,
    adminCalls: admin.calls,
    /** Lo que devuelve `createAdminClient()` simulado: cuenta cuántas veces se crea. */
    createAdminClient: () => {
      state.adminCreated += 1;
      return adminClient;
    },
  };
}

export type RoomWorld = ReturnType<typeof createRoomWorld>;
