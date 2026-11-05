import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BCN,
  GRACIA,
  LAVAPIES,
  OTHER_ROOM_ID,
  OTHER_USER,
  ROOM_ID,
  completeRoom,
  createRoomWorld,
  room,
  type RoomWorld,
} from "./helpers/room-world";
import { TEST_USER } from "./helpers/profile-rows";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const adminMock = vi.hoisted(() => ({ created: 0 }));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminMock.created += 1;
    throw new Error("el CRUD no usa service_role");
  },
}));
vi.mock("next/cache", () => cacheMock);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { changeRoomStatus, createRoom, updateRoom } from "@/app/actions/rooms";

// CRUD de habitaciones (sesión 68): las Server Actions con los servicios
// reales sobre el mundo en memoria (RLS, GRANT por columnas, CHECK, FK y H5).
// Del navegador llegan los campos del formulario y, al editar o cambiar el
// estado, roomId: nunca owner_id, status al crear, deleted_at ni approx_*.

const NEW_PATH = "/habitaciones/nueva";
const EDIT_PATH = `/habitaciones/${ROOM_ID}/editar`;
const NOT_FOUND = "No encontramos esa habitación entre las tuyas.";
const LOCKED = "Esta habitación está retirada por moderación: no se puede cambiar.";
const redirectsTo = (url: string) => expect.objectContaining({ url });

beforeEach(() => {
  serverMock.createClient.mockReset();
  cacheMock.revalidatePath.mockReset();
  adminMock.created = 0;
});

function setup(options: Parameters<typeof createRoomWorld>[0] = {}) {
  const world = createRoomWorld({
    rooms: [
      room(),
      completeRoom({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" }),
    ],
    owners: { [OTHER_USER]: null },
    ...options,
  });
  serverMock.createClient.mockResolvedValue(world.userClient);
  return world;
}

/** Lo que envía el formulario de habitación (los checkboxes marcados como `on`). */
const FIELDS: Array<[string, string]> = [
  ["title", "Habitación con balcón"],
  ["description", ""],
  ["city_id", BCN],
  ["neighborhood_id", GRACIA],
  ["price_month", "520"],
  ["expenses_included", "on"],
  ["deposit_amount", "520"],
  ["available_from", "2026-12-01"],
  ["min_stay_months", "6"],
  ["max_stay_months", ""],
  ["total_roommates", "2"],
  ["total_rooms", "3"],
  ["features", "wifi"],
  ["features", "balcony"],
  ["students_only", "true"],
  ["house_rules", ""],
  ["roommate_preferences", ""],
];

function form(
  fields: Array<[string, string]> = FIELDS,
  options: { roomId?: string | string[]; without?: string[] } = {}
) {
  const data = new FormData();
  const ids = options.roomId === undefined ? [] : [options.roomId].flat();
  for (const id of ids) data.append("roomId", id);
  for (const [key, value] of fields)
    if (!options.without?.includes(key)) data.append(key, value);
  data.append("$ACTION_ID_fake", "");
  return data;
}

const statusForm = (
  roomId: string,
  status: string,
  extra: Array<[string, string]> = []
) => form([["status", status], ...extra], { roomId });

const writes = (world: RoomWorld) =>
  world.userCalls.filter((c) => c.table === "rooms" && c.operation !== "select");

describe("createRoom", () => {
  it("crea un borrador propio y lleva a sus fotos con el aviso de creada", async () => {
    const world = setup();
    let url = "";
    await createRoom({}, form()).catch((error: { url: string }) => {
      url = error.url;
    });
    const created = world.state.rooms.find((r) => r.title === "Habitación con balcón");
    expect(created).toMatchObject({
      owner_id: TEST_USER,
      status: "draft",
      price_month: 520,
      expenses_included: true,
      pets_allowed: false,
      smoking_allowed: false,
      students_only: true,
      features: ["wifi", "balcony"],
      description: null,
      max_stay_months: null,
      deleted_at: null,
    });
    expect(url).toBe(`/habitaciones/${created?.id}/fotos?creada=1`);
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/habitaciones");
    expect(adminMock.created).toBe(0);
    const [insert] = writes(world);
    expect(insert.payload).not.toHaveProperty("status");
    expect(insert.payload).toHaveProperty("owner_id", TEST_USER);
  });

  it("sin sesión → /login con vuelta al alta; cuenta desactivada → /cuenta-desactivada; sin perfil → onboarding", async () => {
    const anonymous = setup({ userId: null });
    await expect(createRoom({}, form())).rejects.toEqual(
      redirectsTo(`/login?next=${encodeURIComponent(NEW_PATH)}`)
    );
    expect(writes(anonymous)).toEqual([]);
    const deactivated = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(createRoom({}, form())).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(deactivated)).toEqual([]);
    const noProfile = setup({ profile: null });
    await expect(createRoom({}, form())).rejects.toEqual(
      redirectsTo("/bienvenida/perfil")
    );
    expect(writes(noProfile)).toEqual([]);
  });

  it.each([
    ["owner_id", OTHER_USER],
    ["id", OTHER_ROOM_ID],
    ["status", "active"],
    ["deleted_at", "2026-10-20T10:00:00Z"],
    ["approx_lat", "41.4"],
    ["address_exact", "Carrer de Verdi 1"],
    ["roomId", ROOM_ID],
  ])("%s inyectado → error general, sin escribir", async (key, value) => {
    const world = setup();
    const state = await createRoom({}, form([...FIELDS, [key, value]]));
    expect(state.formError).toContain("Campo no permitido");
    expect(state.formError).toContain(key);
    expect(writes(world)).toEqual([]);
  });

  it("errores de campo, con lo enviado para volver a rellenar el formulario", async () => {
    const world = setup();
    const state = await createRoom(
      {},
      form(
        FIELDS.map(([key, value]): [string, string] =>
          key === "price_month" ? [key, "0"] : [key, value]
        ),
        { without: ["title", "students_only"] }
      )
    );
    expect(state.fieldErrors).toMatchObject({
      title: expect.any(Array),
      price_month: ["El precio tiene que ser mayor que 0"],
      students_only: ["Indica si la habitación es solo para estudiantes"],
    });
    expect(state.formError).toBeUndefined();
    expect(state.values).toMatchObject({
      price_month: "0",
      features: ["wifi", "balcony"],
    });
    expect(writes(world)).toEqual([]);
  });

  it("barrio de otra ciudad: error del campo barrio, sin texto de PostgreSQL", async () => {
    setup();
    const state = await createRoom(
      {},
      form(
        FIELDS.map(([key, value]): [string, string] =>
          key === "neighborhood_id" ? [key, LAVAPIES] : [key, value]
        )
      )
    );
    expect(state.fieldErrors).toEqual({
      neighborhood_id: ["El barrio no pertenece a la ciudad elegida"],
    });
    expect(JSON.stringify(state)).not.toMatch(/constraint|foreign key|fk_/);
  });
});

describe("updateRoom", () => {
  it("la propietaria guarda los cambios (sin tocar el estado) y se revalidan las rutas", async () => {
    const world = setup();
    const state = await updateRoom({}, form(FIELDS, { roomId: ROOM_ID }));
    expect(state).toMatchObject({
      success: "Cambios guardados.",
      values: { title: "Habitación con balcón", expenses_included: "on" },
    });
    expect(world.state.rooms.find((r) => r.id === ROOM_ID)).toMatchObject({
      title: "Habitación con balcón",
      neighborhood_id: GRACIA,
      status: "draft",
    });
    const [update] = writes(world);
    expect(update.payload).not.toHaveProperty("roomId");
    expect(update.payload).not.toHaveProperty("status");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/habitaciones");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith(EDIT_PATH);
    expect(adminMock.created).toBe(0);
  });

  it("ajena → no encontrada, sin escribir; un admin tampoco la edita", async () => {
    const world = setup();
    expect(await updateRoom({}, form(FIELDS, { roomId: OTHER_ROOM_ID }))).toMatchObject({
      formError: NOT_FOUND,
    });
    expect(writes(world)).toEqual([]);
    const admin = setup({ profile: { role: "admin" } });
    expect(await updateRoom({}, form(FIELDS, { roomId: OTHER_ROOM_ID }))).toMatchObject({
      formError: NOT_FOUND,
    });
    expect(writes(admin)).toEqual([]);
  });

  it.each([
    ["sin roomId", undefined],
    ["roomId no válido", "../otra"],
    ["roomId repetido", [ROOM_ID, OTHER_ROOM_ID]],
  ])("%s → no encontrada, sin escribir", async (_label, roomId) => {
    const world = setup();
    expect(await updateRoom({}, form(FIELDS, { roomId }))).toMatchObject({
      formError: NOT_FOUND,
    });
    expect(writes(world)).toEqual([]);
  });

  it("status u owner_id en la edición → error general, sin escribir", async () => {
    const world = setup();
    for (const extra of [
      ["status", "active"],
      ["owner_id", OTHER_USER],
    ] as Array<[string, string]>) {
      const state = await updateRoom({}, form([...FIELDS, extra], { roomId: ROOM_ID }));
      expect(state.formError).toContain("Campo no permitido");
    }
    expect(writes(world)).toEqual([]);
  });

  it("retirada → bloqueada, sin escribir", async () => {
    const world = setup({ rooms: [completeRoom({ status: "removed" })] });
    expect(await updateRoom({}, form(FIELDS, { roomId: ROOM_ID }))).toMatchObject({
      formError: LOCKED,
    });
    expect(writes(world)).toEqual([]);
  });

  it("publicada: quitarle el barrio («Sin barrio», vacío) no se guarda (error del campo)", async () => {
    const world = setup({ rooms: [completeRoom({ status: "active" })] });
    const state = await updateRoom(
      {},
      form(
        FIELDS.map(([key, value]): [string, string] =>
          key === "neighborhood_id" ? [key, ""] : [key, value]
        ),
        { roomId: ROOM_ID }
      )
    );
    expect(state.fieldErrors).toEqual({
      neighborhood_id: ["Para publicar, elige un barrio"],
    });
    expect(writes(world)).toEqual([]);
  });

  it("sin sesión → /login con vuelta a la edición; cuenta desactivada → /cuenta-desactivada", async () => {
    setup({ userId: null });
    await expect(updateRoom({}, form(FIELDS, { roomId: ROOM_ID }))).rejects.toEqual(
      redirectsTo(`/login?next=${encodeURIComponent(EDIT_PATH)}`)
    );
    const deactivated = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(updateRoom({}, form(FIELDS, { roomId: ROOM_ID }))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(deactivated)).toEqual([]);
  });
});

describe("changeRoomStatus", () => {
  it("publica, pausa, marca como alquilada y vuelve a borrador", async () => {
    const world = setup({ rooms: [completeRoom()] });
    for (const [status, label] of [
      ["active", "Publicada"],
      ["paused", "Pausada"],
      ["rented", "Alquilada"],
      ["draft", "Borrador"],
    ]) {
      expect(await changeRoomStatus({}, statusForm(ROOM_ID, status))).toEqual({
        success: `Estado actualizado: ${label}.`,
      });
      expect(world.state.rooms[0].status).toBe(status);
    }
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith(EDIT_PATH);
    expect(adminMock.created).toBe(0);
  });

  it("incompleta: no se publica y dice qué falta (no exige fotos)", async () => {
    const world = setup();
    const state = await changeRoomStatus({}, statusForm(ROOM_ID, "active"));
    expect(state.formError).toContain("Todavía no se puede publicar");
    expect(state.formError).toContain("Para publicar, elige un barrio");
    expect(state.formError).not.toMatch(/foto/i);
    expect(writes(world)).toEqual([]);
  });

  it("removed o un estado desconocido → no disponible; campo extra → no permitido", async () => {
    const world = setup({ rooms: [completeRoom({ status: "active" })] });
    expect(await changeRoomStatus({}, statusForm(ROOM_ID, "removed"))).toEqual({
      formError: "Ese estado no está disponible.",
    });
    expect(await changeRoomStatus({}, statusForm(ROOM_ID, "published"))).toEqual({
      formError: "Ese estado no está disponible.",
    });
    const extra = await changeRoomStatus(
      {},
      statusForm(ROOM_ID, "paused", [["owner_id", OTHER_USER]])
    );
    expect(extra.formError).toContain("Campo no permitido");
    expect(writes(world)).toEqual([]);
  });

  it("ajena (también para un admin) → no encontrada; retirada → bloqueada", async () => {
    const world = setup();
    expect(await changeRoomStatus({}, statusForm(OTHER_ROOM_ID, "paused"))).toEqual({
      formError: NOT_FOUND,
    });
    setup({ profile: { role: "admin" } });
    expect(await changeRoomStatus({}, statusForm(OTHER_ROOM_ID, "paused"))).toEqual({
      formError: NOT_FOUND,
    });
    const removed = setup({ rooms: [completeRoom({ status: "removed" })] });
    expect(await changeRoomStatus({}, statusForm(ROOM_ID, "active"))).toEqual({
      formError: LOCKED,
    });
    expect([...writes(world), ...writes(removed)]).toEqual([]);
  });

  it("H5 en la base de datos (42501 room_moderation) → bloqueada, sin detalles", async () => {
    const world = setup({ rooms: [completeRoom()] });
    world.failures.user = (call) =>
      call.operation === "update"
        ? { code: "42501", message: "room_moderation: <interno>" }
        : undefined;
    const state = await changeRoomStatus({}, statusForm(ROOM_ID, "active"));
    expect(state).toEqual({ formError: LOCKED });
  });

  it("sin roomId válido → no encontrada; cuenta desactivada → /cuenta-desactivada", async () => {
    const world = setup();
    expect(await changeRoomStatus({}, form([["status", "paused"]]))).toEqual({
      formError: NOT_FOUND,
    });
    expect(writes(world)).toEqual([]);
    setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(changeRoomStatus({}, statusForm(ROOM_ID, "paused"))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
  });
});
