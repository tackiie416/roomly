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

// Fase 4.2 (sesión 65) — borrado seguro de una habitación propia. El servicio
// comprueba la sesión, la cuenta y la propiedad con el cliente del usuario y
// solo entonces crea el cliente admin, que únicamente llama a
// delete_own_room (20261030120000). Esa función borra en una transacción y
// devuelve las rutas de las fotos; el servicio de fotos borra solo esas y
// comprueba que la carpeta queda vacía. Nunca informa de una limpieza
// completa que no lo ha sido.

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
    objects: [photo1.storage_path, photo2.storage_path, theirs.storage_path],
    ...options,
  });
  adminMock.world = world;
  return world;
}

function imageDeps(world: RoomWorld): RoomImagesDeps {
  return {
    adminClient: world.createAdminClient,
    sanitize: async () => {
      throw new Error("el borrado no limpia imágenes");
    },
    newId: () => "no-se-usa",
    now: () => new Date("2026-10-30T10:00:00Z"),
    signedUrlTtlSeconds: 600,
    reportRecovery: (event, path) => recoveries.push({ event, path }),
  };
}

/** Dependencias con la limpieza real (y el admin del mundo), y avisos registrados. */
function deps(world: RoomWorld): RoomsDeps {
  return {
    adminClient: world.createAdminClient,
    removeRoomObjects: (roomId, paths) =>
      removeDeletedRoomObjects(roomId, paths, imageDeps(world)),
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
/** Nada cambió y no se creó el cliente admin. */
const untouched = (world: RoomWorld) => {
  expect(ownRoomGone(world)).toBe(false);
  expect(world.state.objects.size).toBe(3);
  expect(world.state.adminCreated).toBe(0);
  expect(world.state.rpcCalls).toEqual([]);
};

describe("deleteOwnRoom: autorización antes del cliente privilegiado", () => {
  it.each([
    ["sin sesión", { userId: null }, "unauthenticated"],
    [
      "cuenta desactivada",
      { profile: { deleted_at: "2026-10-20T10:00:00Z" } },
      "deleted",
    ],
    ["sin perfil", { profile: null }, "no_profile"],
  ] as const)(
    "%s → %s, sin crear el cliente admin ni borrar nada",
    async (_n, o, error) => {
      const world = setup(o);
      const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
      expect(result).toEqual({ ok: false, error });
      untouched(world);
    }
  );

  it("habitación ajena (pública) → not_found, sin llamar a la función", async () => {
    const world = setup();
    const result = await deleteOwnRoom(world.userClient, OTHER_ROOM_ID, deps(world));
    expect(result).toEqual({ ok: false, error: "not_found" });
    theirsIntact(world);
    untouched(world);
  });

  it.each(["../otra", `${ROOM_ID}/x.webp`, 42, null])(
    "id no válido (%s) → not_found, sin consultas de habitaciones",
    async (input) => {
      const world = setup();
      const result = await deleteOwnRoom(world.userClient, input, deps(world));
      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(world.userCalls.some((c) => c.table === "rooms")).toBe(false);
      untouched(world);
    }
  );

  it("el usuario de la llamada es el de la sesión, nunca otro", async () => {
    const world = setup();
    await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(world.state.rpcCalls).toEqual([
      { name: "delete_own_room", args: { p_room_id: ROOM_ID, p_user_id: TEST_USER } },
    ]);
  });

  it("el cliente del usuario ya no borra habitaciones: el servicio no lo intenta", async () => {
    const world = setup();
    await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(world.userCalls.some((c) => c.operation === "delete")).toBe(false);
  });
});

describe("deleteOwnRoom: borrado y limpieza", () => {
  it("borra con delete_own_room y después solo las rutas que devuelve; carpeta vacía → completa", async () => {
    const world = setup();
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: true } });
    expect(ownRoomGone(world)).toBe(true);
    expect(world.state.images).toEqual([theirs]);
    expect([...world.state.objects]).toEqual([theirs.storage_path]);
    theirsIntact(world);

    // Orden: comprobaciones del usuario; la función; la comprobación de que
    // ya no existe; Storage.
    const privileged = world.state.log.filter((e) => !e.startsWith("user:"));
    expect(privileged).toEqual([
      "admin:rpc.delete_own_room",
      "admin:rooms.select",
      "storage.remove",
      "storage.list",
    ]);
    const lastUser = world.state.log.lastIndexOf("user:rooms.select");
    expect(lastUser).toBeLessThan(world.state.log.indexOf("admin:rpc.delete_own_room"));
    expect(world.state.removes).toEqual([[photo1.storage_path, photo2.storage_path]]);
    expect(recoveries).toEqual([]);
  });

  it("sin fotos → array vacío, sin remove, y completa", async () => {
    const world = setup({ images: [theirs], objects: [theirs.storage_path] });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: true } });
    expect(world.state.removes).toEqual([]);
    theirsIntact(world);
  });

  it("retirada por moderación → la propietaria puede borrarla", async () => {
    const world = setup({
      rooms: [room({ status: "removed" })],
      images: [photo1],
      objects: [photo1.storage_path],
    });
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: true,
      data: { photosRemoved: true },
    });
    expect(world.state.objects.size).toBe(0);
  });

  it("un objeto que no estaba en la lista (huérfano anterior) no se borra: queda pendiente y se avisa", async () => {
    const world = setup({
      objects: [photo1.storage_path, photo2.storage_path, ORPHAN, theirs.storage_path],
    });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(world.state.removes.flat()).not.toContain(ORPHAN);
    expect(world.state.objects.has(ORPHAN)).toBe(true);
    expect(recoveries).toEqual([
      { event: "room_image_orphan_after_room_delete", path: ORPHAN },
    ]);
  });
});

describe("deleteOwnRoom: rechazos de la función (no se borra nada)", () => {
  it("la cuenta se desactivó entre la comprobación y la función → deleted", async () => {
    const world = setup();
    world.failures.rpcBefore = () => {
      // La función ve la cuenta desactivada (lo comprueba bajo bloqueo).
      return {
        code: "42501",
        message: "account_deleted: la cuenta no existe o está desactivada",
      };
    };
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(ownRoomGone(world)).toBe(false);
    expect(world.state.removes).toEqual([]);
  });

  it.each([
    ["P0002", "room_not_found: <interno>", "not_found"],
    [
      "23503",
      'update or delete on table "rooms" violates foreign key constraint',
      "conflict",
    ],
    ["42501", "permission denied for function delete_own_room", "unknown"],
    ["P0001", "room_delete_isolation: <interno>", "unknown"],
    ["22004", "room_delete_invalid: <interno>", "unknown"],
  ])("%s (%s) → %s, sin tocar Storage", async (code, message, error) => {
    const world = setup();
    world.failures.rpcBefore = () => ({ code, message });
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: false,
      error,
    });
    expect(ownRoomGone(world)).toBe(false);
    expect(world.state.removes).toEqual([]);
    expect(world.state.objects.size).toBe(3);
  });

  it("referencias sin cascada (FK) → conflict, emulado por la función", async () => {
    const world = setup();
    world.state.referenced.add(ROOM_ID);
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(ownRoomGone(world)).toBe(false);
  });

  it("una ruta no canónica en la base de datos → la función no borra nada, error y aviso", async () => {
    const odd = { ...photo2, storage_path: `${OTHER_ROOM_ID}/${photo2.id}.webp` };
    const world = setup({ images: [photo1, odd, theirs] });
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(ownRoomGone(world)).toBe(false);
    expect(world.state.images).toHaveLength(3);
    expect(world.state.objects.size).toBe(3);
    expect(world.state.removes).toEqual([]);
    expect(roomRecoveries).toEqual([
      { event: "room_delete_path_invalid", roomId: ROOM_ID },
    ]);
  });
});

describe("deleteOwnRoom: resultados ambiguos", () => {
  it("ambiguo y la habitación sigue → error, sin borrar ningún objeto", async () => {
    const world = setup();
    world.failures.rpcBefore = () => ({ code: "", message: "fetch failed" });
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(ownRoomGone(world)).toBe(false);
    expect(world.state.removes).toEqual([]);
  });

  it("ambiguo pero confirmado (respuesta perdida) → borrada, limpieza pendiente y aviso; nada se borra de Storage", async () => {
    const world = setup();
    world.failures.rpcAfter = () => ({ code: "57014", message: "statement timeout" });
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: true,
      data: { photosRemoved: false },
    });
    expect(ownRoomGone(world)).toBe(true);
    expect(world.state.removes).toEqual([]);
    expect(world.state.objects.size).toBe(3);
    expect(roomRecoveries).toEqual([
      { event: "room_delete_paths_unknown", roomId: ROOM_ID },
    ]);
  });

  it("ambiguo y no se puede comprobar → error y aviso, sin tocar Storage", async () => {
    const world = setup();
    world.failures.rpcBefore = () => ({ code: "08006", message: "connection failure" });
    world.failures.user = (call) =>
      world.state.rpcCalls.length > 0 && call.table === "rooms"
        ? { code: "08006", message: "connection failure" }
        : undefined;
    expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(roomRecoveries).toEqual([
      { event: "room_delete_unconfirmed", roomId: ROOM_ID },
    ]);
    expect(world.state.removes).toEqual([]);
  });

  it.each([
    ["no es una lista", () => "ruta"],
    ["con algo que no es texto", (paths: string[]) => [...paths, 7]],
    ["nula", () => null],
  ])(
    "respuesta mal formada (%s) → borrada, limpieza pendiente, sin tocar Storage",
    async (_n, data) => {
      const world = setup();
      world.failures.rpcData = data;
      expect(await deleteOwnRoom(world.userClient, ROOM_ID, deps(world))).toEqual({
        ok: true,
        data: { photosRemoved: false },
      });
      expect(world.state.removes).toEqual([]);
      expect(roomRecoveries).toEqual([
        { event: "room_delete_paths_unknown", roomId: ROOM_ID },
      ]);
    }
  );
});

describe("deleteOwnRoom: fallos de Storage después de confirmar el borrado", () => {
  it("remove falla → habitación borrada, photosRemoved false y un aviso por ruta", async () => {
    const world = setup();
    world.failures.storage.remove = () => ({ message: "storage 503 <interno>" });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(ownRoomGone(world)).toBe(true);
    expect(recoveries.map((r) => r.path).sort()).toEqual(
      [photo1.storage_path, photo2.storage_path].sort()
    );
    expect(new Set(recoveries.map((r) => r.event))).toEqual(
      new Set(["room_image_orphan_after_room_delete"])
    );
    theirsIntact(world);
  });

  it("limpieza parcial (Storage deja un objeto) → photosRemoved false y aviso de ese objeto", async () => {
    const world = setup();
    world.state.undeletable.add(photo2.storage_path);
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(recoveries).toEqual([
      { event: "room_image_orphan_after_room_delete", path: photo2.storage_path },
    ]);
  });

  it("no se puede listar al final → photosRemoved false (sin verificar no es completo)", async () => {
    const world = setup();
    world.failures.storage.list = () => ({ message: "list 500" });
    const result = await deleteOwnRoom(world.userClient, ROOM_ID, deps(world));
    expect(result).toEqual({ ok: true, data: { photosRemoved: false } });
    expect(world.state.objects.has(photo1.storage_path)).toBe(false);
    expect(recoveries).toEqual([
      { event: "room_objects_unverified", path: `${ROOM_ID}/` },
    ]);
  });
});

describe("removeDeletedRoomObjects: solo rutas canónicas de una habitación que ya no existe", () => {
  it("habitación de otra persona que existe → no borra nada y avisa", async () => {
    const world = setup();
    const result = await removeDeletedRoomObjects(
      OTHER_ROOM_ID,
      [theirs.storage_path],
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
    const result = await removeDeletedRoomObjects(
      ROOM_ID,
      [photo1.storage_path],
      imageDeps(world)
    );
    expect(result).toEqual({ complete: false });
    expect(world.state.removes).toEqual([]);
  });

  it("id no válido → no crea el cliente admin", async () => {
    const world = setup();
    expect(await removeDeletedRoomObjects("../x", [], imageDeps(world))).toEqual({
      complete: false,
    });
    expect(world.state.adminCreated).toBe(0);
  });

  it("rutas de otra carpeta, con «..», en mayúsculas o que no son texto: no se borran, se avisa y no es completa", async () => {
    const world = setup({ rooms: [], images: [], objects: [theirs.storage_path] });
    const result = await removeDeletedRoomObjects(
      ROOM_ID,
      [
        theirs.storage_path,
        `${ROOM_ID}/../${theirs.storage_path}`,
        // Con letras: en mayúsculas no es la ruta canónica.
        ORPHAN.toUpperCase().replace(ROOM_ID.toUpperCase(), ROOM_ID),
        7,
      ],
      imageDeps(world)
    );
    expect(result).toEqual({ complete: false });
    expect(world.state.removes).toEqual([]);
    expect(world.state.objects.has(theirs.storage_path)).toBe(true);
    expect(recoveries).toEqual([
      { event: "room_objects_invalid_path", path: `${ROOM_ID}/` },
    ]);
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
