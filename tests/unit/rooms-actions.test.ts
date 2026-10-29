import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OTHER_ROOM_ID,
  OTHER_USER,
  ROOM_ID,
  createRoomWorld,
  room,
  worldImage,
  type RoomWorld,
} from "./helpers/room-world";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const adminMock = vi.hoisted(() => ({ world: null as RoomWorld | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!adminMock.world) throw new Error("createAdminClient sin mundo simulado");
    return adminMock.world.createAdminClient();
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { deleteRoom } from "@/app/actions/rooms";

// Fase 4.2 — Server Action del borrado de una habitación, con el servicio
// real (lib/services/rooms.ts) y la limpieza real de Storage sobre un mundo
// en memoria. Del navegador solo llega roomId.

const DELETE_PATH = `/habitaciones/${ROOM_ID}/borrar`;
const redirectsTo = (url: string) => expect.objectContaining({ url });
const photo1 = worldImage(1);
const theirs = worldImage(3, OTHER_ROOM_ID);

beforeEach(() => {
  serverMock.createClient.mockReset();
  adminMock.world = null;
});

function setup(options: Parameters<typeof createRoomWorld>[0] = {}) {
  const world = createRoomWorld({
    rooms: [room(), room({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" })],
    owners: { [OTHER_USER]: null },
    images: [photo1, theirs],
    objects: [photo1.storage_path, theirs.storage_path],
    ...options,
  });
  serverMock.createClient.mockResolvedValue(world.userClient);
  adminMock.world = world;
  return world;
}

function form(roomId: string, extra: Array<[string, string]> = []) {
  const data = new FormData();
  data.append("roomId", roomId);
  for (const [key, value] of extra) data.append(key, value);
  data.append("$ACTION_ID_fake", "");
  return data;
}

const untouched = (world: RoomWorld) => {
  expect(world.state.rooms).toHaveLength(2);
  expect(world.state.objects.size).toBe(2);
  expect(world.state.adminCreated).toBe(0);
};

describe("deleteRoom", () => {
  it("sin sesión → /login con vuelta a la confirmación, sin borrar", async () => {
    const world = setup({ userId: null });
    await expect(deleteRoom({}, form(ROOM_ID))).rejects.toEqual(
      redirectsTo(`/login?next=${encodeURIComponent(DELETE_PATH)}`)
    );
    untouched(world);
  });

  it("cuenta desactivada → /cuenta-desactivada, sin borrar", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(deleteRoom({}, form(ROOM_ID))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    untouched(world);
  });

  it("habitación ajena → no encontrada, sin borrar", async () => {
    const world = setup();
    expect(await deleteRoom({}, form(OTHER_ROOM_ID))).toEqual({
      formError: "No encontramos esa habitación entre las tuyas.",
    });
    untouched(world);
  });

  it.each([
    ["storagePath", `${OTHER_ROOM_ID}/${theirs.id}.webp`],
    ["imageId", theirs.id],
    ["ownerId", OTHER_USER],
  ])("%s del navegador → rechazado, sin consultar ni borrar", async (key, value) => {
    const world = setup();
    expect(await deleteRoom({}, form(ROOM_ID, [[key, value]]))).toEqual({
      formError: "Campo no permitido",
    });
    expect(world.userCalls.some((c) => c.table === "rooms")).toBe(false);
    untouched(world);
  });

  it("roomId que no es un UUID → no encontrada, sin consultas", async () => {
    const world = setup();
    expect(await deleteRoom({}, form("../otra"))).toEqual({
      formError: "No encontramos esa habitación entre las tuyas.",
    });
    expect(world.userCalls.some((c) => c.table === "rooms")).toBe(false);
    untouched(world);
  });

  it("éxito → borrada con sus objetos y a la confirmación, sin aviso de pendientes", async () => {
    const world = setup();
    await expect(deleteRoom({}, form(ROOM_ID))).rejects.toEqual(
      redirectsTo("/habitaciones/borrada")
    );
    expect(world.state.rooms.map((r) => r.id)).toEqual([OTHER_ROOM_ID]);
    expect([...world.state.objects]).toEqual([theirs.storage_path]);
  });

  it("limpieza parcial → borrada, pero la confirmación dice que quedan fotos pendientes", async () => {
    const world = setup();
    world.state.undeletable.add(photo1.storage_path);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(deleteRoom({}, form(ROOM_ID))).rejects.toEqual(
      redirectsTo("/habitaciones/borrada?fotos=pendientes")
    );
    expect(world.state.rooms.map((r) => r.id)).toEqual([OTHER_ROOM_ID]);
    // El aviso solo lleva el evento y la ruta canónica.
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      `[room-images] room_image_orphan_after_room_delete: ${photo1.storage_path}`,
    ]);
    warn.mockRestore();
  });

  it("fallo de la base de datos → mensaje genérico, sin detalles y sin borrar", async () => {
    const world = setup();
    world.failures.user = (call) =>
      call.operation === "delete"
        ? { code: "XX000", message: "<detalle interno>" }
        : undefined;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = await deleteRoom({}, form(ROOM_ID));
    warn.mockRestore();
    expect(state).toEqual({
      formError:
        "No hemos podido borrar la habitación. Vuelve a intentarlo en un momento.",
    });
    untouched(world);
  });
});
