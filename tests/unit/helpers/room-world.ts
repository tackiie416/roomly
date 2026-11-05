import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DbClient } from "@/lib/services/result";
import { ROOM_FEATURE_KEYS } from "@/lib/validation/rooms";
import { createFakeSupabase, type Call, type FakeResponse } from "./fake-supabase";
import { TEST_USER } from "./profile-rows";

/**
 * Habitaciones, fotos y objetos de Storage en memoria, para probar las Server
 * Actions, el borrado de habitaciones y las páginas de la Fase 4.2 con los
 * servicios reales. Emula lo justo de la base de datos y de Storage:
 *   - cliente del usuario (RLS): ve sus habitaciones, las públicas (activas,
 *     sin borrar y de una cuenta activa) y, si es admin activo, todas. Desde
 *     20261030120000 no tiene DELETE sobre `rooms` (42501). INSERT y UPDATE
 *     de `rooms` (CRUD, sesión 68) con el GRANT por columnas de
 *     20261015120000 (leído de la propia migración), la RLS de la 4.0
 *     (propietaria con la cuenta activa; `rooms_admin_all` para un admin
 *     activo), los CHECK y las FK de `rooms` (con su nombre en el mensaje) y
 *     el trigger de moderación H5; y la lectura de `cities` y `neighborhoods`;
 *   - cliente admin (service_role): INSERT y DELETE de `room_images` con las
 *     reglas del trigger (8 fotos, habitación escribible, cuenta activa y ruta
 *     canónica), lectura de `rooms` sin RLS, `rpc("delete_own_room")` con las
 *     reglas de la función (cuenta activa, propietaria, rutas canónicas, FK
 *     sin cascada) y el borrado en cascada de las filas de `room_images` (no
 *     de los objetos), y Storage (subir, borrar, firmar y listar).
 * No es PostgreSQL ni Storage: tests/db cubre la base de datos real.
 */

export const OTHER_USER = "99999999-8888-4777-8666-555555555555";
export const ROOM_ID = "22222222-3333-4444-8555-666666666666";
export const OTHER_ROOM_ID = "44444444-3333-4444-8555-666666666666";

export const BCN = "11111111-1111-4111-8111-111111111111";
export const MAD = "33333333-3333-4333-8333-333333333333";
export const GRACIA = "55555555-5555-4555-8555-555555555555";
export const SANTS = "66666666-6666-4666-8666-666666666666";
export const LAVAPIES = "77777777-7777-4777-8777-777777777777";

export type WorldCity = { id: string; name: string; is_active: boolean };
export type WorldNeighborhood = { id: string; name: string; city_id: string };

export const WORLD_CITIES: WorldCity[] = [
  { id: BCN, name: "Barcelona", is_active: true },
  { id: MAD, name: "Madrid", is_active: false },
];
export const WORLD_NEIGHBORHOODS: WorldNeighborhood[] = [
  { id: GRACIA, name: "Gràcia", city_id: BCN },
  { id: SANTS, name: "Sants", city_id: BCN },
  { id: LAVAPIES, name: "Lavapiés", city_id: MAD },
];

/** Columnas de `rooms` que no son de identidad ni de estado (todas con valor por defecto en `room()`). */
export type WorldRoomData = {
  description: string | null;
  city_id: string;
  neighborhood_id: string | null;
  approx_lat: number | null;
  approx_lng: number | null;
  price_month: number;
  expenses_included: boolean;
  deposit_amount: number | null;
  available_from: string;
  min_stay_months: number | null;
  max_stay_months: number | null;
  total_roommates: number | null;
  total_rooms: number | null;
  features: string[];
  pets_allowed: boolean;
  smoking_allowed: boolean;
  students_only: boolean;
  house_rules: string | null;
  roommate_preferences: string | null;
  created_at: string;
  updated_at: string;
};

export type WorldRoom = {
  id: string;
  owner_id: string;
  title: string;
  status: string;
  deleted_at: string | null;
} & Partial<WorldRoomData>;

/** GRANT de `authenticated` sobre `rooms`, leído de 20261015120000 (no se copia a mano). */
function roomsGrant(kind: "insert" | "update"): string[] {
  const migration = readFileSync(
    "supabase/migrations/20261015120000_rooms_integrity_publication.sql",
    "utf8"
  ).replace(/--.*$/gm, "");
  const list = migration.match(
    new RegExp(`grant ${kind} \\(([\\s\\S]*?)\\) on public\\.rooms to authenticated`)
  )?.[1];
  if (!list) throw new Error(`GRANT ${kind} de rooms no encontrado`);
  return list.split(",").map((column) => column.trim());
}
export const ROOMS_GRANT_INSERT = roomsGrant("insert");
export const ROOMS_GRANT_UPDATE = roomsGrant("update");

export type WorldImage = {
  id: string;
  room_id: string;
  storage_path: string;
  position: number;
  created_at: string;
};

type Failure = { code?: string; message?: string } | null | undefined;
export type RpcArgs = { p_room_id: string; p_user_id: string };
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
  cities?: WorldCity[];
  neighborhoods?: WorldNeighborhood[];
};

export const room = (overrides: Partial<WorldRoom> = {}): WorldRoom => ({
  id: ROOM_ID,
  owner_id: TEST_USER,
  title: "Habitación luminosa en Gràcia",
  status: "draft",
  deleted_at: null,
  description: null,
  city_id: BCN,
  neighborhood_id: null,
  approx_lat: null,
  approx_lng: null,
  price_month: 450,
  expenses_included: false,
  deposit_amount: null,
  available_from: "2026-11-01",
  min_stay_months: null,
  max_stay_months: null,
  total_roommates: null,
  total_rooms: null,
  features: [],
  pets_allowed: false,
  smoking_allowed: false,
  students_only: false,
  house_rules: null,
  roommate_preferences: null,
  created_at: "2026-10-20T10:00:00.000Z",
  updated_at: "2026-10-20T10:00:00.000Z",
  ...overrides,
});

/** Una habitación completa para publicar (barrio de su ciudad y ocupación). */
export const completeRoom = (overrides: Partial<WorldRoom> = {}): WorldRoom =>
  room({ neighborhood_id: GRACIA, total_roommates: 2, total_rooms: 3, ...overrides });

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
    /** Rutas que `remove` da por borradas sin borrarlas (limpieza parcial). */
    undeletable: new Set<string>(),
    /** Rutas pedidas en cada `remove`. */
    removes: [] as string[][],
    /** Habitaciones referenciadas sin cascada (interests, matches, reports): 23503. */
    referenced: new Set<string>(),
    /** Orden de todas las operaciones de los dos clientes y de Storage. */
    log: [] as string[],
    /** Llamadas a `rpc` del cliente admin, con sus argumentos. */
    rpcCalls: [] as Array<{ name: string; args: RpcArgs }>,
    adminCreated: 0,
    cities: [...(options.cities ?? WORLD_CITIES)],
    neighborhoods: [...(options.neighborhoods ?? WORLD_NEIGHBORHOODS)],
  };
  const failures = {
    user: undefined as ((call: Call) => Failure) | undefined,
    admin: undefined as ((call: Call) => Failure) | undefined,
    storage: {} as Partial<Record<StorageOp, (n: number) => Failure>>,
    /** Antes de ejecutar delete_own_room: un error aquí no cambia nada. */
    rpcBefore: undefined as ((args: RpcArgs) => Failure) | undefined,
    /** Después de ejecutarla (y confirmarla): una respuesta perdida. */
    rpcAfter: undefined as ((args: RpcArgs) => Failure) | undefined,
    /** Sustituye los datos de una respuesta correcta (respuesta mal formada). */
    rpcData: undefined as ((paths: string[]) => unknown) | undefined,
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
        if (f.kind === "is") return (row[f.column] ?? null) === f.value;
        throw new Error(`filtro no emulado: ${f.kind}`);
      })
    );

  /** `order()` del cliente: solo columnas de texto (created_at...), como las usa el CRUD. */
  const orderRows = <T extends Record<string, unknown>>(rows: T[], call: Call) =>
    [...rows].sort((a, b) => {
      for (const entry of call.order ?? []) {
        const [column, direction] = entry.split(".");
        const cmp = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
        if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });

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

  // ---- CRUD de rooms con el cliente del usuario (sesión 68) ----
  const pgError = (code: string, message: string): FakeResponse => ({
    data: null,
    error: { code, message },
  });
  const permissionDenied = () => pgError("42501", "permission denied for table rooms");
  /** CHECK y FK de `rooms` sobre la fila resultante, con el nombre de la restricción. */
  const roomConstraintError = (row: WorldRoom): FakeResponse | null => {
    const check = (name: string) =>
      pgError(
        "23514",
        `new row for relation "rooms" violates check constraint "${name}"`
      );
    const fk = (name: string) =>
      pgError(
        "23503",
        `insert or update on table "rooms" violates foreign key constraint "${name}"`
      );
    if (typeof row.title !== "string")
      return pgError(
        "23502",
        'null value in column "title" violates not-null constraint'
      );
    if (!state.cities.some((c) => c.id === row.city_id)) return fk("rooms_city_id_fkey");
    if (row.neighborhood_id != null) {
      const n = state.neighborhoods.find((c) => c.id === row.neighborhood_id);
      if (!n) return fk("rooms_neighborhood_id_fkey");
      if (n.city_id !== row.city_id) return fk("fk_rooms_neighborhood_city");
    }
    if (!((row.price_month ?? 0) > 0)) return check("chk_price_positive");
    if (row.deposit_amount != null && row.deposit_amount < 0)
      return check("chk_deposit_nonneg");
    if (
      row.min_stay_months != null &&
      row.max_stay_months != null &&
      row.min_stay_months > row.max_stay_months
    )
      return check("chk_stay_range");
    if (row.total_roommates != null && row.total_roommates < 0)
      return check("chk_rooms_total_roommates");
    if (row.total_rooms != null && row.total_rooms < 1)
      return check("chk_rooms_total_rooms");
    const features = row.features ?? [];
    if (features.some((f) => !(ROOM_FEATURE_KEYS as readonly string[]).includes(f)))
      return check("chk_rooms_features_catalog");
    if (new Set(features).size !== features.length)
      return check("chk_rooms_features_unique");
    if (
      row.status === "active" &&
      (row.neighborhood_id == null ||
        row.total_roommates == null ||
        row.total_rooms == null)
    )
      return check("chk_rooms_publishable");
    return null;
  };
  const insertRoom = (call: Call): FakeResponse => {
    const payload = (call.payload ?? {}) as Partial<WorldRoom>;
    if (Object.keys(payload).some((column) => !ROOMS_GRANT_INSERT.includes(column)))
      return permissionDenied();
    // rooms_insert_own (4.0): la propia fila, con la cuenta activa.
    if (payload.owner_id !== userId || !userId || !ownerActive(userId))
      return pgError(
        "42501",
        'new row violates row-level security policy for table "rooms"'
      );
    const now = new Date().toISOString();
    const row = room({
      created_at: now,
      updated_at: now,
      ...payload,
      id: payload.id ?? randomUUID(),
      status: "draft",
      deleted_at: null,
    });
    const failure = roomConstraintError(row);
    if (failure) return failure;
    state.rooms.push(row);
    return finish(call, [row]);
  };
  const updateRooms = (call: Call): FakeResponse => {
    const payload = (call.payload ?? {}) as Partial<WorldRoom>;
    if (Object.keys(payload).some((column) => !ROOMS_GRANT_UPDATE.includes(column)))
      return permissionDenied();
    // rooms_update_own (4.0): propietaria con la cuenta activa; rooms_admin_all: admin activo.
    const writable = (r: WorldRoom) =>
      isAdmin() || (r.owner_id === userId && userId !== null && ownerActive(userId));
    const targets = applyFilters(state.rooms.filter(visibleRoom), call).filter(writable);
    const updated: WorldRoom[] = [];
    for (const target of targets) {
      const next = { ...target, ...payload, updated_at: new Date().toISOString() };
      // trg_rooms_moderation (H5): solo un admin entra o sale de removed.
      if (
        next.status !== target.status &&
        (target.status === "removed" || next.status === "removed") &&
        !isAdmin()
      )
        return pgError(
          "42501",
          "room_moderation: solo un admin puede cambiar el estado desde o hacia removed"
        );
      const failure = roomConstraintError(next);
      if (failure) return failure;
      updated.push(next);
    }
    for (const next of updated) {
      state.rooms = state.rooms.map((r) => (r.id === next.id ? next : r));
    }
    return finish(call, updated);
  };

  const userRespond = (call: Call): FakeResponse => {
    state.log.push(`user:${call.table}.${call.operation}`);
    const injected = failures.user?.(call);
    if (injected) return { data: null, error: injected };
    if (call.table === "profiles") return { data: profile, error: null };
    if (call.table === "housing_preferences") return { data: null, error: null };
    if (call.table === "cities" && call.operation === "select")
      return finish(call, applyFilters(state.cities, call));
    if (call.table === "neighborhoods" && call.operation === "select")
      return finish(call, applyFilters(state.neighborhoods, call));
    if (call.table === "rooms") {
      if (call.operation === "select")
        return finish(
          call,
          orderRows(applyFilters(state.rooms.filter(visibleRoom), call), call)
        );
      if (call.operation === "delete")
        // 20261030120000: ningún cliente tiene DELETE sobre rooms.
        return {
          data: null,
          error: { code: "42501", message: "permission denied for table rooms" },
        };
      if (call.operation === "insert") return insertRoom(call);
      if (call.operation === "update") return updateRooms(call);
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
          state.removes.push([...paths]);
          const removed = paths.filter(
            (p) => !state.undeletable.has(p) && state.objects.delete(p)
          );
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

  const CANONICAL =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
  const rpcError = (code: string, message: string) => ({
    data: null,
    error: { code, message: `${message} <detalle interno>` },
  });
  /** delete_own_room (20261030120000), con sus reglas y en su orden. */
  const deleteOwnRoomRpc = (args: RpcArgs) => {
    if (!args.p_room_id || !args.p_user_id)
      return rpcError("22004", "room_delete_invalid:");
    if (owners[args.p_user_id] !== null) return rpcError("42501", "account_deleted:");
    const target = state.rooms.find(
      (r) => r.id === args.p_room_id && r.owner_id === args.p_user_id
    );
    if (!target) return rpcError("P0002", "room_not_found:");
    const own = sortImages(state.images.filter((i) => i.room_id === target.id));
    if (
      own.some(
        (i) =>
          i.storage_path !== `${i.room_id}/${i.id}.webp` ||
          !CANONICAL.test(i.storage_path)
      )
    )
      return rpcError("23514", "room_delete_path_invalid:");
    if (state.referenced.has(target.id))
      return rpcError(
        "23503",
        'update or delete on table "rooms" violates foreign key constraint'
      );
    cascadeDelete([target.id]);
    return { data: own.map((i) => i.storage_path), error: null };
  };
  const rpc = async (name: string, args: RpcArgs) => {
    state.log.push(`admin:rpc.${name}`);
    state.rpcCalls.push({ name, args });
    if (name !== "delete_own_room") throw new Error(`rpc no emulada: ${name}`);
    const before = failures.rpcBefore?.(args);
    if (before) return { data: null, error: before };
    const result = deleteOwnRoomRpc(args);
    if (result.error) return result;
    const after = failures.rpcAfter?.(args);
    if (after) return { data: null, error: after };
    return {
      data: failures.rpcData ? failures.rpcData(result.data) : result.data,
      error: null,
    };
  };

  const user = createFakeSupabase({ userId, respond: userRespond });
  const admin = createFakeSupabase({ userId: null, respond: adminRespond });
  const adminClient = {
    ...(admin.client as unknown as object),
    storage,
    rpc,
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
