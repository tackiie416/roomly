import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BCN,
  GRACIA,
  LAVAPIES,
  MAD,
  OTHER_ROOM_ID,
  OTHER_USER,
  ROOMS_GRANT_INSERT,
  ROOMS_GRANT_UPDATE,
  ROOM_ID,
  SANTS,
  completeRoom,
  createRoomWorld,
  room,
  type RoomWorld,
} from "./helpers/room-world";
import { TEST_USER } from "./helpers/profile-rows";

const adminMock = vi.hoisted(() => ({ created: 0 }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminMock.created += 1;
    throw new Error("el CRUD no usa service_role");
  },
}));

import {
  changeOwnRoomStatus,
  createOwnRoom,
  getOwnRoomForEdit,
  listOwnRooms,
  updateOwnRoom,
} from "@/lib/services/rooms";

// CRUD de habitaciones de la propietaria (Fase 4, sesión 68): los servicios
// reales contra un mundo en memoria que emula la RLS de la 4.0, el GRANT por
// columnas de 4.1 (leído de la migración), los CHECK, la FK ciudad-barrio y el
// trigger de moderación H5. tests/db cubre la base de datos real.

beforeEach(() => {
  adminMock.created = 0;
});

const NEW_ROOM = {
  title: "Habitación exterior en Sants",
  city_id: BCN,
  price_month: 480,
  available_from: "2026-12-01",
  students_only: true,
  features: ["wifi", "desk"],
};

function setup(options: Parameters<typeof createRoomWorld>[0] = {}) {
  return createRoomWorld({
    rooms: [
      room(),
      completeRoom({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" }),
    ],
    owners: { [OTHER_USER]: null },
    ...options,
  });
}

const roomCalls = (world: RoomWorld) =>
  world.userCalls.filter((c) => c.table === "rooms");
const writes = (world: RoomWorld) =>
  world.userCalls.filter((c) => c.table === "rooms" && c.operation !== "select");
const stored = (world: RoomWorld, id: string) =>
  world.state.rooms.find((r) => r.id === id);

describe("el mundo en memoria lee el GRANT de la migración", () => {
  it("INSERT con owner_id y sin status; UPDATE con status y sin id ni owner_id", () => {
    expect(ROOMS_GRANT_INSERT).toContain("owner_id");
    expect(ROOMS_GRANT_INSERT).not.toContain("status");
    expect(ROOMS_GRANT_UPDATE).toContain("status");
    for (const column of ["id", "owner_id", "deleted_at", "approx_lat", "approx_lng"])
      expect(ROOMS_GRANT_UPDATE).not.toContain(column);
  });
});

describe("createOwnRoom", () => {
  it("crea un borrador propio: owner_id de la sesión, sin status y solo columnas del GRANT", async () => {
    const world = setup();
    const result = await createOwnRoom(world.userClient, NEW_ROOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("draft");
    expect(result.data.title).toBe(NEW_ROOM.title);
    expect(result.data).not.toHaveProperty("owner_id");
    expect(result.data).not.toHaveProperty("deleted_at");

    const [insert] = writes(world);
    expect(insert.operation).toBe("insert");
    expect(insert.payload).toEqual({ ...NEW_ROOM, owner_id: TEST_USER });
    for (const column of Object.keys(insert.payload ?? {}))
      expect(ROOMS_GRANT_INSERT).toContain(column);
    // Lee de vuelta columnas explícitas: nunca approx_* ni room_addresses.
    expect(insert.columns).not.toMatch(/approx_|address|\*/);
    expect(stored(world, result.data.id)).toMatchObject({
      owner_id: TEST_USER,
      status: "draft",
      deleted_at: null,
    });
    expect(adminMock.created).toBe(0);
  });

  it("sin sesión → unauthenticated, sin consultar habitaciones", async () => {
    const world = setup({ userId: null });
    expect(await createOwnRoom(world.userClient, NEW_ROOM)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(roomCalls(world)).toEqual([]);
  });

  it("cuenta desactivada → deleted; sin perfil → no_profile; nada escrito", async () => {
    const deactivated = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    expect(await createOwnRoom(deactivated.userClient, NEW_ROOM)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(writes(deactivated)).toEqual([]);
    const noProfile = setup({ profile: null });
    expect(await createOwnRoom(noProfile.userClient, NEW_ROOM)).toEqual({
      ok: false,
      error: "no_profile",
    });
    expect(writes(noProfile)).toEqual([]);
  });

  it.each([
    ["owner_id", OTHER_USER],
    ["id", OTHER_ROOM_ID],
    ["status", "active"],
    ["deleted_at", "2026-10-20T10:00:00Z"],
    ["approx_lat", 41.4],
  ])("%s del navegador → validation, sin escribir", async (key, value) => {
    const world = setup();
    const result = await createOwnRoom(world.userClient, { ...NEW_ROOM, [key]: value });
    expect(result).toMatchObject({ ok: false, error: "validation" });
    expect(writes(world)).toEqual([]);
  });

  it("ciudad inactiva o inexistente → error de campo, sin escribir", async () => {
    const world = setup();
    expect(await createOwnRoom(world.userClient, { ...NEW_ROOM, city_id: MAD })).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { city_id: ["Esta ciudad todavía no está disponible"] },
    });
    expect(
      await createOwnRoom(world.userClient, {
        ...NEW_ROOM,
        city_id: "12121212-1212-4212-8212-121212121212",
      })
    ).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { city_id: ["La ciudad no existe"] },
    });
    expect(writes(world)).toEqual([]);
  });

  it("barrio de otra ciudad: la FK compuesta lo rechaza y se traduce sin detalles", async () => {
    const world = setup();
    const result = await createOwnRoom(world.userClient, {
      ...NEW_ROOM,
      neighborhood_id: LAVAPIES,
    });
    expect(result).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { neighborhood_id: ["El barrio no pertenece a la ciudad elegida"] },
    });
    expect(JSON.stringify(result)).not.toContain("foreign key");
    expect(world.state.rooms).toHaveLength(2);
  });

  it("CHECK de la base de datos y errores desconocidos: sin texto de PostgreSQL", async () => {
    const world = setup();
    world.failures.user = (call) =>
      call.table === "rooms" && call.operation === "insert"
        ? {
            code: "23514",
            message:
              'new row for relation "rooms" violates check constraint "chk_price_positive"',
          }
        : undefined;
    expect(await createOwnRoom(world.userClient, NEW_ROOM)).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { price_month: ["El precio tiene que ser mayor que 0"] },
    });
    world.failures.user = (call) =>
      call.operation === "insert" ? { code: "XX000", message: "<interno>" } : undefined;
    const unknown = await createOwnRoom(world.userClient, NEW_ROOM);
    expect(unknown).toEqual({ ok: false, error: "unknown" });
    world.failures.user = (call) =>
      call.operation === "insert"
        ? { code: "42501", message: "new row violates row-level security policy" }
        : undefined;
    expect(await createOwnRoom(world.userClient, NEW_ROOM)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("listOwnRooms", () => {
  it("solo las propias y sin borrado lógico, en una consulta, con lo que falta para publicar", async () => {
    const world = setup({
      rooms: [
        room({ id: ROOM_ID, created_at: "2026-10-01T10:00:00.000Z" }),
        completeRoom({
          id: "abababab-3333-4444-8555-666666666666",
          status: "active",
          created_at: "2026-10-05T10:00:00.000Z",
        }),
        room({
          id: "cdcdcdcd-3333-4444-8555-666666666666",
          deleted_at: "2026-10-06T10:00:00Z",
        }),
        completeRoom({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" }),
      ],
    });
    const result = await listOwnRooms(world.userClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.id)).toEqual([
      "abababab-3333-4444-8555-666666666666",
      ROOM_ID,
    ]);
    expect(result.data[0].missingForPublication).toEqual([]);
    expect(result.data[1].missingForPublication).toEqual([
      "neighborhood_id",
      "total_roommates",
      "total_rooms",
    ]);
    // Una sola consulta a rooms (sin N+1), filtrada por la propietaria.
    const calls = roomCalls(world);
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "owner_id", value: TEST_USER },
        { kind: "is", column: "deleted_at", value: null },
      ])
    );
    expect(calls[0].order).toEqual(["created_at.desc"]);
    expect(calls[0].columns).not.toMatch(/approx_|address|\*/);
  });

  it("un admin activo ve solo las suyas en su listado, no las de los demás", async () => {
    const world = setup({ profile: { role: "admin" } });
    const result = await listOwnRooms(world.userClient);
    expect(result.ok && result.data.map((r) => r.id)).toEqual([ROOM_ID]);
  });

  it("cuenta desactivada → deleted, sin leer habitaciones", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    expect(await listOwnRooms(world.userClient)).toEqual({ ok: false, error: "deleted" });
    expect(roomCalls(world)).toEqual([]);
  });
});

describe("getOwnRoomForEdit", () => {
  it("la propietaria lee todos sus datos, sin owner_id ni deleted_at", async () => {
    const world = setup();
    const result = await getOwnRoomForEdit(world.userClient, ROOM_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ id: ROOM_ID, status: "draft", city_id: BCN });
    expect(result.data).not.toHaveProperty("owner_id");
    expect(result.data).not.toHaveProperty("deleted_at");
  });

  it("habitación ajena (también pública), para un usuario o un admin → not_found", async () => {
    expect(await getOwnRoomForEdit(setup().userClient, OTHER_ROOM_ID)).toEqual({
      ok: false,
      error: "not_found",
    });
    const admin = setup({ profile: { role: "admin" } });
    expect(await getOwnRoomForEdit(admin.userClient, OTHER_ROOM_ID)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("con borrado lógico → not_found; id no válido → not_found sin consultar rooms", async () => {
    const world = setup({ rooms: [room({ deleted_at: "2026-10-06T10:00:00Z" })] });
    expect(await getOwnRoomForEdit(world.userClient, ROOM_ID)).toEqual({
      ok: false,
      error: "not_found",
    });
    const fresh = setup();
    expect(await getOwnRoomForEdit(fresh.userClient, "../otra")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(roomCalls(fresh)).toEqual([]);
  });

  it("cuenta desactivada → deleted", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    expect(await getOwnRoomForEdit(world.userClient, ROOM_ID)).toEqual({
      ok: false,
      error: "deleted",
    });
  });
});

const EDIT = {
  ...NEW_ROOM,
  title: "Habitación reformada",
  neighborhood_id: SANTS,
  total_roommates: 1,
  total_rooms: 2,
  description: "Luminosa",
};

describe("updateOwnRoom", () => {
  it("UPDATE de la propia, filtrado por id, propietaria y sin borrado lógico; solo columnas del GRANT", async () => {
    const world = setup();
    const result = await updateOwnRoom(world.userClient, ROOM_ID, EDIT);
    expect(result.ok).toBe(true);
    const [update] = writes(world);
    expect(update.operation).toBe("update");
    expect(update.payload).toEqual(EDIT);
    for (const column of Object.keys(update.payload ?? {}))
      expect(ROOMS_GRANT_UPDATE).toContain(column);
    expect(update.payload).not.toHaveProperty("status");
    expect(update.filters).toEqual([
      { kind: "eq", column: "id", value: ROOM_ID },
      { kind: "eq", column: "owner_id", value: TEST_USER },
      { kind: "is", column: "deleted_at", value: null },
    ]);
    expect(stored(world, ROOM_ID)).toMatchObject({
      title: "Habitación reformada",
      neighborhood_id: SANTS,
      status: "draft",
    });
    expect(adminMock.created).toBe(0);
  });

  it("habitación ajena → not_found sin UPDATE; un admin tampoco la edita desde aquí", async () => {
    const world = setup();
    expect(await updateOwnRoom(world.userClient, OTHER_ROOM_ID, EDIT)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(writes(world)).toEqual([]);
    // La RLS dejaría escribir a un admin (rooms_admin_all): el servicio no lo intenta.
    const admin = setup({ profile: { role: "admin" } });
    expect(await updateOwnRoom(admin.userClient, OTHER_ROOM_ID, EDIT)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(writes(admin)).toEqual([]);
    expect(stored(admin, OTHER_ROOM_ID)?.title).not.toBe(EDIT.title);
  });

  it("publicada: no se le puede quitar lo que exige la publicación (antes de escribir)", async () => {
    const world = setup({ rooms: [completeRoom({ status: "active" })] });
    const result = await updateOwnRoom(world.userClient, ROOM_ID, {
      ...EDIT,
      neighborhood_id: null,
      total_rooms: null,
    });
    expect(result).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: {
        neighborhood_id: ["Para publicar, elige un barrio"],
        total_rooms: ["Para publicar, indica cuántos dormitorios tiene la vivienda"],
      },
    });
    expect(writes(world)).toEqual([]);
  });

  it("si el CHECK de publicación salta igualmente, error general sin detalles", async () => {
    const world = setup({ rooms: [completeRoom({ status: "active" })] });
    world.failures.user = (call) =>
      call.operation === "update"
        ? {
            code: "23514",
            message: 'violates check constraint "chk_rooms_publishable" <interno>',
          }
        : undefined;
    expect(await updateOwnRoom(world.userClient, ROOM_ID, EDIT)).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: {
        _form: [
          "Una habitación publicada necesita barrio, número de compañeros y número de dormitorios.",
        ],
      },
    });
  });

  it("retirada (removed) → forbidden, sin escribir", async () => {
    const world = setup({ rooms: [completeRoom({ status: "removed" })] });
    expect(await updateOwnRoom(world.userClient, ROOM_ID, EDIT)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(writes(world)).toEqual([]);
  });

  it("status, owner_id o id en la edición → validation, sin escribir", async () => {
    const world = setup();
    for (const extra of [
      { status: "active" },
      { owner_id: OTHER_USER },
      { id: OTHER_ROOM_ID },
    ]) {
      expect(
        await updateOwnRoom(world.userClient, ROOM_ID, { ...EDIT, ...extra })
      ).toMatchObject({ ok: false, error: "validation" });
    }
    expect(writes(world)).toEqual([]);
  });

  it("ciudad: una nueva tiene que estar activa; la guardada se conserva aunque ya no lo esté", async () => {
    const world = setup({
      rooms: [room({ city_id: MAD, neighborhood_id: LAVAPIES })],
    });
    expect(
      await updateOwnRoom(world.userClient, ROOM_ID, {
        ...EDIT,
        city_id: MAD,
        neighborhood_id: LAVAPIES,
      })
    ).toMatchObject({ ok: true });
    const other = setup();
    expect(
      await updateOwnRoom(other.userClient, ROOM_ID, {
        ...EDIT,
        city_id: MAD,
        neighborhood_id: null,
      })
    ).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { city_id: ["Esta ciudad todavía no está disponible"] },
    });
  });

  it("cambiar a una ciudad sin cambiar el barrio: lo rechaza la FK compuesta", async () => {
    const world = setup({ rooms: [room({ neighborhood_id: GRACIA })] });
    world.state.cities = world.state.cities.map((c) =>
      c.id === MAD ? { ...c, is_active: true } : c
    );
    expect(
      await updateOwnRoom(world.userClient, ROOM_ID, {
        ...EDIT,
        city_id: MAD,
        neighborhood_id: GRACIA,
      })
    ).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { neighborhood_id: ["El barrio no pertenece a la ciudad elegida"] },
    });
    expect(stored(world, ROOM_ID)?.city_id).toBe(BCN);
  });

  it("si el UPDATE no alcanza ninguna fila (la habitación cambió entretanto) → not_found", async () => {
    const world = setup();
    // Entre la lectura y el UPDATE la habitación deja de cumplir los filtros.
    world.failures.user = (call) => {
      if (call.table === "rooms" && call.operation === "update")
        world.state.rooms = world.state.rooms.map((r) =>
          r.id === ROOM_ID ? { ...r, deleted_at: "2026-10-30T10:00:00Z" } : r
        );
      return undefined;
    };
    expect(await updateOwnRoom(world.userClient, ROOM_ID, EDIT)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("cuenta desactivada → deleted, sin leer ni escribir habitaciones", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    expect(await updateOwnRoom(world.userClient, ROOM_ID, EDIT)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(roomCalls(world)).toEqual([]);
  });
});

describe("changeOwnRoomStatus (R7, opción A, y H5)", () => {
  it("publica una habitación completa: UPDATE solo de status, con sus filtros", async () => {
    const world = setup({ rooms: [completeRoom()] });
    const result = await changeOwnRoomStatus(world.userClient, {
      roomId: ROOM_ID,
      status: "active",
    });
    expect(result).toMatchObject({ ok: true, data: { status: "active" } });
    const [update] = writes(world);
    expect(update.payload).toEqual({ status: "active" });
    expect(update.filters).toEqual([
      { kind: "eq", column: "id", value: ROOM_ID },
      { kind: "eq", column: "owner_id", value: TEST_USER },
      { kind: "is", column: "deleted_at", value: null },
    ]);
    expect(adminMock.created).toBe(0);
  });

  it("no publica una incompleta: dice qué falta, sin escribir (no exige fotos)", async () => {
    const world = setup({ rooms: [room({ neighborhood_id: GRACIA })] });
    expect(
      await changeOwnRoomStatus(world.userClient, { roomId: ROOM_ID, status: "active" })
    ).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: {
        total_roommates: ["Para publicar, indica con cuántas personas convivirá"],
        total_rooms: ["Para publicar, indica cuántos dormitorios tiene la vivienda"],
      },
    });
    expect(writes(world)).toEqual([]);
  });

  it("recorre draft → active → paused → rented → draft", async () => {
    const world = setup({ rooms: [completeRoom()] });
    for (const status of ["active", "paused", "rented", "draft"] as const) {
      expect(
        await changeOwnRoomStatus(world.userClient, { roomId: ROOM_ID, status })
      ).toMatchObject({ ok: true, data: { status } });
      expect(stored(world, ROOM_ID)?.status).toBe(status);
    }
  });

  it("el mismo estado no escribe", async () => {
    const world = setup();
    expect(
      await changeOwnRoomStatus(world.userClient, { roomId: ROOM_ID, status: "draft" })
    ).toMatchObject({ ok: true });
    expect(writes(world)).toEqual([]);
  });

  it("retirada → forbidden sin escribir; removed nunca se acepta", async () => {
    const world = setup({ rooms: [completeRoom({ status: "removed" })] });
    expect(
      await changeOwnRoomStatus(world.userClient, { roomId: ROOM_ID, status: "active" })
    ).toEqual({ ok: false, error: "forbidden" });
    const other = setup({ rooms: [completeRoom({ status: "active" })] });
    expect(
      await changeOwnRoomStatus(other.userClient, { roomId: ROOM_ID, status: "removed" })
    ).toMatchObject({ ok: false, error: "validation" });
    expect([...writes(world), ...writes(other)]).toEqual([]);
  });

  it("si H5 rechaza en la base de datos (room_moderation, 42501) → forbidden", async () => {
    const world = setup({ rooms: [completeRoom()] });
    world.failures.user = (call) =>
      call.operation === "update"
        ? { code: "42501", message: "room_moderation: <interno>" }
        : undefined;
    expect(
      await changeOwnRoomStatus(world.userClient, { roomId: ROOM_ID, status: "active" })
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("ajena (también para un admin) → not_found; cuenta desactivada → deleted; sin sesión", async () => {
    const world = setup();
    expect(
      await changeOwnRoomStatus(world.userClient, {
        roomId: OTHER_ROOM_ID,
        status: "paused",
      })
    ).toEqual({ ok: false, error: "not_found" });
    const admin = setup({ profile: { role: "admin" } });
    expect(
      await changeOwnRoomStatus(admin.userClient, {
        roomId: OTHER_ROOM_ID,
        status: "paused",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(stored(admin, OTHER_ROOM_ID)?.status).toBe("active");
    const deactivated = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    expect(
      await changeOwnRoomStatus(deactivated.userClient, {
        roomId: ROOM_ID,
        status: "paused",
      })
    ).toEqual({ ok: false, error: "deleted" });
    const anonymous = setup({ userId: null });
    expect(
      await changeOwnRoomStatus(anonymous.userClient, {
        roomId: ROOM_ID,
        status: "paused",
      })
    ).toEqual({ ok: false, error: "unauthenticated" });
    expect([...writes(world), ...writes(admin), ...writes(deactivated)]).toEqual([]);
  });
});
