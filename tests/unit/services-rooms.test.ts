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
import { TEST_USER } from "./helpers/profile-rows";

const adminMock = vi.hoisted(() => ({ world: null as RoomWorld | null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!adminMock.world) throw new Error("createAdminClient sin mundo simulado");
    return adminMock.world.createAdminClient();
  },
}));

import {
  deleteOwnRoom,
  getOwnRoomForDeletion,
  getRoomPhotos,
  type RoomRecoveryEvent,
  type RoomsDeps,
} from "@/lib/services/rooms";
import {
  removeDeletedRoomObjects,
  type RecoveryEvent,
  type RoomImagesDeps,
} from "@/lib/services/room-images";

// Fase 4.2 — borrado seguro de una habitación propia. El servicio de
// habitaciones no usa service_role: comprueba y borra la fila con el cliente
// del usuario (RLS) y deja los objetos al servicio de fotos, que comprueba con
// service_role que la habitación ya no existe y, al final, que no queda nada
// en su carpeta. Nunca informa de una limpieza completa que no lo ha sido.

const photo1 = worldImage(1);
const photo2 = worldImage(2);
const theirs = worldImage(3, OTHER_ROOM_ID);
/** Huérfano de una subida ambigua anterior (objeto sin fila). */
const ORPHAN = `${ROOM_ID}/0b9f7a52-1c3d-4e5f-8a6b-7c8d9e0f1a2b.webp`;

let recoveries: Array<{ event: RecoveryEvent; path: string }>;
let roomRecoveries: Array<{ event: RoomRecoveryEvent; roomId: string }>;

function setup(options: Parameters<typeof createRoomWorld>[0] = {}) {
  const world = createRoomWorld({
    rooms: [room(), room({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" })],
    owners: { [OTHER_USER]: null },
    images: [photo1, photo2, theirs],
    objects: [photo1.storage_path, photo2.storage_path, ORPHAN, theirs.storage_path],
    ...options,
  });
  adminMock.world = world;
  return world;
}

/** Dependencias con la limpieza real (y el admin del mundo), y avisos registrados. */
function deps(world: RoomWorld): RoomsDeps {
  const imageDeps: RoomImagesDeps = {
    adminClient: world.createAdminClient,
    sanitize: async () => {
      throw new Error("el borrado no limpia imágenes");
    },
    newId: () => "no-se-usa",
    now: () => new Date("2026-10-29T10:00:00Z"),
    signedUrlTtlSeconds: 600,
    reportRecovery: (event, path) => recoveries.push({ event, path }),
  };
  return {
    removeRoomObjects: (roomId, imageIds) =>
      removeDeletedRoomObjects(roomId, imageIds, imageDeps),
    reportRecovery: (event, roomId) => roomRecoveries.push({ event, roomId }),
  };
}

beforeEach(() => {
  adminMock.world = null;
  recoveries = [];
  roomRecoveries = [];
});

const ownRoomGone = (world: RoomWorld) =>
  !world.state.rooms.some((r) => r.id === ROOM_ID);
const theirsIntact = (world: RoomWorld) => {
  expect(world.state.rooms.some((r) => r.id === OTHER_ROOM_ID)).toBe(true);
  expect(world.state.images).toContainEqual(theirs);
  expect(world.state.objects.has(theirs.storage_path)).toBe(true);
};

describe("deleteOwnRoom: autorización antes de cambiar nada", () => {
  it.each([
    ["sin sesión", { userId: null }, "unauthenticated"],
    [
      "cuenta desactivada",
      { profile: { deleted_at: "2026-10-20T10:00:00Z" } },
      "deleted",
    ],
    ["sin perfil", { profile: null }, "no_profile"],
  ] as const)(
    "%s → %s, sin borrar nada ni crear el cliente admin",
    async (_n, o, error) => {
      const world = setup(o);
      const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
      expect(result).toEqual({ ok: false, error });
      expect(ownRoomGone(world)).toBe(false);
      expect(world.state.objects.size).toBe(4);
      expect(world.state.adminCreated).toBe(0);
      expect(world.userCalls.some((c) => c.operation === "delete")).toBe(false);
    }
  );

  it("habitación ajena (pública) → not_found, sin borrarla ni tocar sus fotos", async () => {
    const world = setup();
    const result = await deleteOwnRoom(world.userClient, OTHER_ROOM_ID, deps(world));
    expect(result).toEqual({ ok: false, error: "not_found" });
    theirsIntact(world);
    expect(world.state.adminCreated).toBe(0);
    expect(world.userCalls.some((c) => c.operation === "delete")).toBe(false);
  });

  it.each(["../otra", `${ROOM_ID}/x.webp`, 42, null])(
    "id no válido (%s) → not_found, sin consultas de habitaciones",
    async (input) => {
      const world = setup();
      const result = await deleteOwnRoom(world.userClient, input, deps(world));
      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(world.userCalls.some((c) => c.table === "rooms")).toBe(false);
      expect(world.state.adminCreated).toBe(0);
    }
  );
});

describe("deleteOwnRoom: borrado y limpieza", () => {
  it("borra la fila (cliente del usuario) y después todos sus objetos, también el huérfano", async () => {
    const world = setup();
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: true } });
    expect(ownRoomGone(world)).toBe(true);
    // La cascada se lleva las filas de sus fotos, no las de otras habitaciones.
    expect(world.state.images).toEqual([theirs]);
    expect([...world.state.objects]).toEqual([theirs.storage_path]);
    theirsIntact(world);

    // Orden: comprobaciones y DELETE del usuario; después, la comprobación
    // con service_role de que no existe; después, Storage.
    const order = world.state.log.filter(
      (e) => e === "user:rooms.delete" || !e.startsWith("user:")
    );
    expect(order).toEqual([
      "user:rooms.delete",
      "admin:rooms.select",
      "storage.list",
      "storage.remove",
      "storage.list",
    ]);
    const deleteCall = world.userCalls.find((c) => c.operation === "delete")!;
    expect(deleteCall.filters).toEqual([
      { kind: "eq", column: "id", value: ROOM_ID },
      { kind: "eq", column: "owner_id", value: TEST_USER },
    ]);
    // Solo rutas canónicas de su carpeta, construidas en el servidor.
    expect(world.state.removes).toHaveLength(1);
    expect([...world.state.removes[0]].sort()).toEqual(
      [photo1.storage_path, photo2.storage_path, ORPHAN].sort()
    );
    expect(recoveries).toEqual([]);
  });

  it("sin fotos → borrada y limpieza completa, sin llamar a remove", async () => {
    const world = setup({ images: [theirs], objects: [theirs.storage_path] });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: true } });
    expect(world.state.removes).toEqual([]);
    theirsIntact(world);
  });

  it("habitación retirada por moderación → la propietaria puede borrarla (RLS sin cambios)", async () => {
    const world = setup({
      rooms: [room({ status: "removed" })],
      images: [photo1],
      objects: [photo1.storage_path],
    });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: true } });
    expect(world.state.objects.size).toBe(0);
  });

  it("fallo de la base de datos al leer las fotos → error, sin borrar nada", async () => {
    const world = setup();
    world.failures.user = (call) =>
      call.table === "room_images" ? { code: "XX000", message: "<interno>" } : undefined;
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: false, error: "unknown" });
    expect(ownRoomGone(world)).toBe(false);
    expect(world.state.adminCreated).toBe(0);
  });

  it("DELETE rechazado de forma definitiva (42501) → forbidden, sin tocar Storage", async () => {
    const world = setup();
    world.failures.user = (call) =>
      call.operation === "delete" ? { code: "42501", message: "<rls>" } : undefined;
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(ownRoomGone(world)).toBe(false);
    expect(world.state.objects.size).toBe(4);
    expect(world.state.adminCreated).toBe(0);
  });

  it("DELETE ambiguo y la habitación sigue → error, sin borrar ningún objeto", async () => {
    const world = setup();
    world.failures.user = (call) =>
      call.operation === "delete" ? { code: "", message: "fetch failed" } : undefined;
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: false, error: "unknown" });
    expect(ownRoomGone(world)).toBe(false);
    expect(world.state.objects.size).toBe(4);
    expect(world.state.adminCreated).toBe(0);
  });

  it("DELETE ambiguo pero confirmado (la habitación ya no está) → se limpian sus objetos", async () => {
    const world = setup();
    world.failures.user = (call) => {
      if (call.operation !== "delete") return undefined;
      // La transacción se confirmó, pero se perdió la respuesta.
      world.state.rooms = world.state.rooms.filter((r) => r.id !== ROOM_ID);
      world.state.images = world.state.images.filter((i) => i.room_id !== ROOM_ID);
      return { code: "57014", message: "canceling statement due to statement timeout" };
    };
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: true } });
    expect([...world.state.objects]).toEqual([theirs.storage_path]);
  });

  it("DELETE ambiguo y no se puede comprobar → error y aviso, sin tocar Storage", async () => {
    const world = setup();
    let deletes = 0;
    world.failures.user = (call) => {
      if (call.operation === "delete") deletes += 1;
      return deletes > 0 && call.table === "rooms"
        ? { code: "08006", message: "connection failure" }
        : undefined;
    };
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: false, error: "unknown" });
    expect(roomRecoveries).toEqual([
      { event: "room_delete_unconfirmed", roomId: ROOM_ID },
    ]);
    expect(world.state.objects.size).toBe(4);
    expect(world.state.adminCreated).toBe(0);
  });

  it("la RLS no borra ninguna fila (otra petición la borró antes) → not_found, sin limpieza", async () => {
    const world = setup();
    world.failures.user = (call) => {
      if (call.operation === "delete")
        world.state.rooms = world.state.rooms.filter((r) => r.id !== ROOM_ID);
      return undefined;
    };
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(world.state.adminCreated).toBe(0);
  });

  it("fallo de Storage al borrar → habitación borrada, pero photosRemoved false y avisos por ruta", async () => {
    const world = setup();
    world.failures.storage.remove = () => ({ message: "storage 503 <interno>" });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(ownRoomGone(world)).toBe(true);
    expect(recoveries.map((r) => r.event)).toEqual([
      "room_image_orphan_after_room_delete",
      "room_image_orphan_after_room_delete",
      "room_image_orphan_after_room_delete",
    ]);
    expect(recoveries.map((r) => r.path).sort()).toEqual(
      [photo1.storage_path, photo2.storage_path, ORPHAN].sort()
    );
    theirsIntact(world);
  });

  it("limpieza parcial (Storage deja un objeto) → photosRemoved false y aviso de ese objeto", async () => {
    const world = setup();
    world.state.undeletable.add(photo2.storage_path);
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect([...world.state.objects].sort()).toEqual(
      [photo2.storage_path, theirs.storage_path].sort()
    );
    expect(recoveries).toEqual([
      { event: "room_image_orphan_after_room_delete", path: photo2.storage_path },
    ]);
  });

  it("no se puede listar al final → photosRemoved false (sin verificar no es completo)", async () => {
    const world = setup();
    world.failures.storage.list = (n) => (n === 2 ? { message: "list 500" } : undefined);
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(world.state.objects.has(photo1.storage_path)).toBe(false);
    expect(recoveries).toEqual([
      { event: "room_objects_unverified", path: `${ROOM_ID}/` },
    ]);
  });

  it("no se puede listar al principio → borra las conocidas y la verificación decide", async () => {
    const world = setup();
    world.failures.storage.list = (n) => (n === 1 ? { message: "list 500" } : undefined);
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    // El huérfano no se conocía: queda, y se avisa.
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(world.state.removes).toEqual([[photo1.storage_path, photo2.storage_path]]);
    expect(recoveries).toEqual([
      { event: "room_image_orphan_after_room_delete", path: ORPHAN },
    ]);
  });

  it("un nombre no canónico en su carpeta no se borra: queda y se avisa", async () => {
    const odd = `${ROOM_ID}/notas.txt`;
    const world = setup({ objects: [photo1.storage_path, odd, theirs.storage_path] });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(world.state.objects.has(odd)).toBe(true);
    expect(world.state.removes.flat()).not.toContain(odd);
    expect(recoveries).toEqual([
      { event: "room_image_orphan_after_room_delete", path: odd },
    ]);
  });
});

describe("removeDeletedRoomObjects: nunca borra objetos de una habitación que existe", () => {
  function imageDeps(world: RoomWorld): RoomImagesDeps {
    return {
      adminClient: world.createAdminClient,
      sanitize: async () => {
        throw new Error("no");
      },
      newId: () => "x",
      now: () => new Date(),
      signedUrlTtlSeconds: 600,
      reportRecovery: (event, path) => recoveries.push({ event, path }),
    };
  }

  it("habitación de otra persona que existe → no borra nada y avisa", async () => {
    const world = setup();
    const result = await removeDeletedRoomObjects(
      OTHER_ROOM_ID,
      [theirs.id],
      imageDeps(world)
    );
    expect(result).toEqual({ complete: false });
    theirsIntact(world);
    expect(world.state.removes).toEqual([]);
    expect(recoveries).toEqual([
      { event: "room_objects_cleanup_skipped", path: `${OTHER_ROOM_ID}/` },
    ]);
  });

  it("no se puede comprobar que no existe → no borra nada", async () => {
    const world = setup({ rooms: [] });
    world.failures.admin = () => ({ code: "08006", message: "connection" });
    const result = await removeDeletedRoomObjects(ROOM_ID, [photo1.id], imageDeps(world));
    expect(result).toEqual({ complete: false });
    expect(world.state.removes).toEqual([]);
    expect(world.state.objects.size).toBe(4);
  });

  it("id no válido → no crea el cliente admin", async () => {
    const world = setup();
    expect(await removeDeletedRoomObjects("../x", [], imageDeps(world))).toEqual({
      complete: false,
    });
    expect(world.state.adminCreated).toBe(0);
  });

  it("ids de fotos no válidos (rutas) se ignoran: solo rutas canónicas de su carpeta", async () => {
    const world = setup({ rooms: [], images: [], objects: [theirs.storage_path] });
    const result = await removeDeletedRoomObjects(
      ROOM_ID,
      [`../${OTHER_ROOM_ID}/${theirs.id}`, theirs.storage_path, 7],
      imageDeps(world)
    );
    expect(result).toEqual({ complete: true });
    expect(world.state.removes).toEqual([]);
    expect(world.state.objects.has(theirs.storage_path)).toBe(true);
  });
});

describe("getRoomPhotos y getOwnRoomForDeletion: quién ve la gestión", () => {
  it("propietaria: gestiona, con URL firmadas de sus fotos", async () => {
    const world = setup();
    const result = await getRoomPhotos(world.userClient, ROOM_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      room: { id: ROOM_ID, title: "Habitación luminosa en Gràcia", status: "draft" },
      access: "owner",
      canUpload: true,
      canDelete: true,
      maxImages: 8,
    });
    expect(result.data.images?.map((i) => i.id)).toEqual([photo1.id, photo2.id]);
    expect(result.data.images?.every((i) => i.url?.includes("token="))).toBe(true);
  });

  it("propietaria de una habitación retirada: puede quitar fotos, no añadir", async () => {
    const world = setup({ rooms: [room({ status: "removed" })] });
    const result = await getRoomPhotos(world.userClient, ROOM_ID);
    expect(result.ok && result.data).toMatchObject({ canUpload: false, canDelete: true });
  });

  it("con 8 fotos no se ofrece la subida", async () => {
    const images = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => worldImage(n));
    const world = setup({ images, objects: images.map((i) => i.storage_path) });
    const result = await getRoomPhotos(world.userClient, ROOM_ID);
    expect(result.ok && result.data.canUpload).toBe(false);
  });

  it("admin activo: solo mira, sin controles de escritura", async () => {
    const world = setup({ profile: { role: "admin" } });
    const result = await getRoomPhotos(world.userClient, OTHER_ROOM_ID);
    expect(result.ok && result.data).toMatchObject({
      access: "admin",
      canUpload: false,
      canDelete: false,
    });
  });

  it("otra persona, aunque la habitación sea pública → not_found", async () => {
    const world = setup();
    expect(await getRoomPhotos(world.userClient, OTHER_ROOM_ID)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("cuenta desactivada → deleted, sin leer la habitación", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    expect(await getRoomPhotos(world.userClient, ROOM_ID)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(world.userCalls.some((c) => c.table === "rooms")).toBe(false);
  });

  it("si la firma falla, la página se muestra sin fotos (images null) y sin subida", async () => {
    const world = setup();
    world.failures.storage.sign = () => ({ message: "sign 500" });
    const result = await getRoomPhotos(world.userClient, ROOM_ID);
    expect(result.ok && result.data).toMatchObject({ images: null, canUpload: false });
  });

  it("confirmación del borrado: solo la propietaria, con el número de fotos", async () => {
    const world = setup();
    expect(await getOwnRoomForDeletion(world.userClient, ROOM_ID)).toEqual({
      ok: true,
      data: {
        room: { id: ROOM_ID, title: "Habitación luminosa en Gràcia", status: "draft" },
        photoCount: 2,
      },
    });
    expect(await getOwnRoomForDeletion(world.userClient, OTHER_ROOM_ID)).toEqual({
      ok: false,
      error: "not_found",
    });
    const admin = setup({ profile: { role: "admin" } });
    expect(await getOwnRoomForDeletion(admin.userClient, OTHER_ROOM_ID)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(world.state.adminCreated).toBe(0);
  });
});
