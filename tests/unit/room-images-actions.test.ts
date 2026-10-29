import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
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
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!adminMock.world) throw new Error("createAdminClient sin mundo simulado");
    return adminMock.world.createAdminClient();
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: cacheMock.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { deleteRoomPhoto, uploadRoomPhoto } from "@/app/actions/room-images";
import { ROOM_IMAGE_MAX_BYTES, ROOM_IMAGE_MESSAGES } from "@/lib/validation/room-images";

// Fase 4.2 — Server Actions de las fotos. Se prueban con los servicios
// reales (y sharp de verdad) sobre un mundo en memoria: el cliente del usuario
// comprueba sesión, cuenta, propiedad, estado y número de fotos; service_role
// (el admin simulado) solo se crea después. Lo que llega del navegador es
// `roomId` y la foto, o `roomId` e `imageId`.

const PHOTOS_PATH = `/habitaciones/${ROOM_ID}/fotos`;
const redirectsTo = (url: string) => expect.objectContaining({ url });

let jpeg: Buffer;
let png: Buffer;
beforeEach(async () => {
  serverMock.createClient.mockReset();
  cacheMock.revalidatePath.mockReset();
  adminMock.world = null;
  jpeg ??= await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#c33" },
  })
    .jpeg()
    .toBuffer();
  png ??= await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#3c3" },
  })
    .png()
    .toBuffer();
});

function setup(options: Parameters<typeof createRoomWorld>[0] = {}) {
  const world = createRoomWorld({ rooms: [room()], ...options });
  serverMock.createClient.mockResolvedValue(world.userClient);
  adminMock.world = world;
  return world;
}

/** Archivo que cuenta cuántas veces se leen sus bytes. */
class TrackedFile extends File {
  reads = 0;
  override arrayBuffer() {
    this.reads += 1;
    return super.arrayBuffer();
  }
}

function uploadForm(
  photo: File | string | null,
  extra: Array<[string, string]> = [],
  roomId = ROOM_ID
): FormData {
  const data = new FormData();
  data.append("roomId", roomId);
  if (photo !== null) data.append("photo", photo);
  for (const [key, value] of extra) data.append(key, value);
  data.append("$ACTION_ID_fake", "");
  return data;
}

const jpegFile = (name = "IMG_0001 casa de Ana.jpg") =>
  new TrackedFile([new Uint8Array(jpeg)], name, { type: "image/jpeg" });

/** Nada privilegiado: ni se creó el cliente admin ni se tocó Storage. */
function expectNoPrivilegedWork(world: RoomWorld) {
  expect(world.state.adminCreated).toBe(0);
  expect(world.state.log.filter((entry) => !entry.startsWith("user:"))).toEqual([]);
  expect(world.state.objects.size).toBe(0);
}

describe("uploadRoomPhoto: rechazos antes de cualquier operación privilegiada", () => {
  it("sin sesión → /login con vuelta a las fotos, sin leer la habitación", async () => {
    const world = setup({ userId: null });
    await expect(uploadRoomPhoto({}, uploadForm(jpegFile()))).rejects.toEqual(
      redirectsTo(`/login?next=${encodeURIComponent(PHOTOS_PATH)}`)
    );
    expectNoPrivilegedWork(world);
    expect(world.userCalls.some((call) => call.table === "rooms")).toBe(false);
  });

  it("cuenta desactivada → /cuenta-desactivada, sin leer la habitación", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(uploadRoomPhoto({}, uploadForm(jpegFile()))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expectNoPrivilegedWork(world);
    expect(world.userCalls.some((call) => call.table === "rooms")).toBe(false);
  });

  it("sin perfil → paso 1 del onboarding", async () => {
    const world = setup({ profile: null });
    await expect(uploadRoomPhoto({}, uploadForm(jpegFile()))).rejects.toEqual(
      redirectsTo("/bienvenida/perfil")
    );
    expectNoPrivilegedWork(world);
  });

  it("habitación ajena (aunque sea pública) → no encontrada, sin subir nada", async () => {
    const world = setup({
      rooms: [room({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" })],
      owners: { [OTHER_USER]: null },
    });
    const state = await uploadRoomPhoto({}, uploadForm(jpegFile(), [], OTHER_ROOM_ID));
    expect(state).toEqual({
      formError: "No encontramos esa habitación entre las tuyas.",
    });
    expectNoPrivilegedWork(world);
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("más de 4 MiB → rechazada por su tamaño, sin leer sus bytes ni consultar la habitación", async () => {
    const world = setup();
    const big = new TrackedFile(
      [new Uint8Array(ROOM_IMAGE_MAX_BYTES + 1)],
      "grande.jpg",
      {
        type: "image/jpeg",
      }
    );
    const state = await uploadRoomPhoto({}, uploadForm(big));
    expect(state).toEqual({ photoError: ROOM_IMAGE_MESSAGES.tooLarge });
    expect(big.reads).toBe(0);
    expectNoPrivilegedWork(world);
    expect(world.userCalls.some((call) => call.table === "rooms")).toBe(false);
  });

  it("4 MiB exactos pasan el filtro de tamaño (los rechaza después la firma, no el tamaño)", async () => {
    const world = setup();
    const exact = new File([new Uint8Array(ROOM_IMAGE_MAX_BYTES)], "justo.jpg", {
      type: "image/jpeg",
    });
    const state = await uploadRoomPhoto({}, uploadForm(exact));
    expect(state.photoError).not.toBe(ROOM_IMAGE_MESSAGES.tooLarge);
    expect(state.photoError).toBe(ROOM_IMAGE_MESSAGES.type);
    expectNoPrivilegedWork(world);
  });

  it.each([
    ["SVG", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg'/>"],
    ["HTML", "text/html", "<html></html>"],
    ["GIF", "image/gif", "GIF89a"],
  ])(
    "formato no admitido (%s) → error de tipo, sin limpiar ni subir",
    async (_n, type, body) => {
      const world = setup();
      const state = await uploadRoomPhoto(
        {},
        uploadForm(new File([body], "foto", { type }))
      );
      expect(state).toEqual({ photoError: ROOM_IMAGE_MESSAGES.type });
      expectNoPrivilegedWork(world);
    }
  );

  it("MIME falsificado: un PNG que dice ser JPEG → no coincide, sin subir", async () => {
    const world = setup();
    const spoofed = new File([new Uint8Array(png)], "foto.jpg", { type: "image/jpeg" });
    const state = await uploadRoomPhoto({}, uploadForm(spoofed));
    expect(state).toEqual({ photoError: ROOM_IMAGE_MESSAGES.mismatch });
    expectNoPrivilegedWork(world);
  });

  it("MIME falsificado: un texto que dice ser JPEG → formato no admitido, sin subir", async () => {
    const world = setup();
    const fake = new File(["no soy una imagen"], "foto.jpg", { type: "image/jpeg" });
    const state = await uploadRoomPhoto({}, uploadForm(fake));
    expect(state).toEqual({ photoError: ROOM_IMAGE_MESSAGES.type });
    expectNoPrivilegedWork(world);
  });

  it.each([
    ["retirada por moderación", { status: "removed" }],
    ["eliminada", { deleted_at: "2026-10-21T10:00:00Z" }],
  ])("habitación %s → no admite fotos, sin limpiar ni subir", async (_n, overrides) => {
    const world = setup({ rooms: [room(overrides)] });
    const file = jpegFile();
    const state = await uploadRoomPhoto({}, uploadForm(file));
    expect(state).toEqual({ formError: "Esta habitación no admite fotos nuevas." });
    expect(file.reads).toBe(0);
    expectNoPrivilegedWork(world);
  });

  it("ya tiene 8 fotos → límite, sin limpiar ni subir", async () => {
    const images = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => worldImage(n));
    const world = setup({ images });
    const file = jpegFile();
    const state = await uploadRoomPhoto({}, uploadForm(file));
    expect(state).toEqual({ photoError: ROOM_IMAGE_MESSAGES.limit });
    expect(file.reads).toBe(0);
    expectNoPrivilegedWork(world);
  });

  it("sin foto (campo vacío) → pide una foto", async () => {
    const world = setup();
    const state = await uploadRoomPhoto({}, uploadForm(new File([], "")));
    expect(state).toEqual({ photoError: ROOM_IMAGE_MESSAGES.required });
    expectNoPrivilegedWork(world);
  });

  it.each(["storagePath", "position", "ownerId", "id", "fileName"])(
    "%s del navegador → rechazado, sin subir",
    async (key) => {
      const world = setup();
      const state = await uploadRoomPhoto({}, uploadForm(jpegFile(), [[key, "x"]]));
      expect(state.formError).toContain("Campo no permitido");
      expect(state.success).toBeUndefined();
      expectNoPrivilegedWork(world);
    }
  );

  it("roomId que no es un UUID → no encontrada, sin consultar la habitación", async () => {
    const world = setup();
    const state = await uploadRoomPhoto({}, uploadForm(jpegFile(), [], "../otra"));
    expect(state).toEqual({
      formError: "No encontramos esa habitación entre las tuyas.",
    });
    expectNoPrivilegedWork(world);
    expect(world.userCalls.some((call) => call.table === "rooms")).toBe(false);
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("uploadRoomPhoto: subida", () => {
  it("foto válida → limpia, sube a la ruta canónica y registra la fila; revalida la página", async () => {
    const world = setup();
    const file = jpegFile();
    const state = await uploadRoomPhoto({}, uploadForm(file));
    expect(state).toEqual({ success: "Foto añadida." });

    expect(world.state.images).toHaveLength(1);
    const [row] = world.state.images;
    expect(row.room_id).toBe(ROOM_ID);
    expect(row.position).toBe(0);
    expect(row.storage_path).toBe(`${ROOM_ID}/${row.id}.webp`);
    expect([...world.state.objects]).toEqual([row.storage_path]);

    // Se sube la imagen limpia (WebP), no los bytes ni el nombre del navegador.
    const [upload] = world.state.uploads;
    const body = Buffer.from(upload.body as Uint8Array);
    expect(body.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(body.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(body.equals(jpeg)).toBe(false);
    expect(JSON.stringify(world.state.uploads)).not.toContain("IMG_0001");
    expect(upload.options).toEqual({
      contentType: "image/webp",
      upsert: false,
      cacheControl: "600",
    });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith(PHOTOS_PATH);
  });

  it("la séptima y la octava entran; la novena no", async () => {
    const images = [1, 2, 3, 4, 5, 6].map((n) => worldImage(n));
    const world = setup({ images, objects: images.map((i) => i.storage_path) });
    expect(await uploadRoomPhoto({}, uploadForm(jpegFile()))).toEqual({
      success: "Foto añadida.",
    });
    expect(await uploadRoomPhoto({}, uploadForm(jpegFile()))).toEqual({
      success: "Foto añadida.",
    });
    expect(await uploadRoomPhoto({}, uploadForm(jpegFile()))).toEqual({
      photoError: ROOM_IMAGE_MESSAGES.limit,
    });
    expect(world.state.images).toHaveLength(8);
    expect(world.state.objects.size).toBe(8);
  });

  it("error del servicio (Storage falla) → mensaje genérico, sin detalles, y sin fila", async () => {
    const world = setup();
    world.failures.storage.upload = () => ({
      message: "storage: bucket room-images 500 <detalle interno>",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = await uploadRoomPhoto({}, uploadForm(jpegFile()));
    expect(state).toEqual({
      formError: "No hemos podido subir la foto. Vuelve a intentarlo en un momento.",
    });
    expect(JSON.stringify(state)).not.toMatch(/detalle|storage|bucket|room-images/);
    expect(world.state.images).toHaveLength(0);
    // Aviso de recuperación: solo el evento y la ruta canónica.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(
      new RegExp(
        `^\\[room-images\\] room_image_upload_unconfirmed: ${ROOM_ID}/[0-9a-f-]{36}\\.webp$`
      )
    );
    warn.mockRestore();
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("el trigger rechaza la fila (cuenta desactivada en medio) → /cuenta-desactivada y el objeto se borra", async () => {
    const world = setup();
    world.failures.admin = (call) =>
      call.table === "room_images" && call.operation === "insert"
        ? { code: "23514", message: "account_deleted: <detalle>" }
        : undefined;
    await expect(uploadRoomPhoto({}, uploadForm(jpegFile()))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(world.state.images).toHaveLength(0);
    expect(world.state.objects.size).toBe(0);
  });
});

function deleteForm(
  imageId: string,
  extra: Array<[string, string]> = [],
  roomId = ROOM_ID
) {
  const data = new FormData();
  data.append("roomId", roomId);
  data.append("imageId", imageId);
  for (const [key, value] of extra) data.append(key, value);
  data.append("$ACTION_ID_fake", "");
  return data;
}

describe("deleteRoomPhoto: autorización en el servidor", () => {
  const photo1 = worldImage(1);

  it("sin sesión → /login, sin borrar", async () => {
    const world = setup({
      userId: null,
      images: [photo1],
      objects: [photo1.storage_path],
    });
    await expect(deleteRoomPhoto({}, deleteForm(photo1.id))).rejects.toEqual(
      redirectsTo(`/login?next=${encodeURIComponent(PHOTOS_PATH)}`)
    );
    expect(world.state.images).toHaveLength(1);
    expect(world.state.adminCreated).toBe(0);
  });

  it("cuenta desactivada → /cuenta-desactivada, sin borrar", async () => {
    const world = setup({
      profile: { deleted_at: "2026-10-20T10:00:00Z" },
      images: [photo1],
      objects: [photo1.storage_path],
    });
    await expect(deleteRoomPhoto({}, deleteForm(photo1.id))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(world.state.images).toHaveLength(1);
    expect(world.state.adminCreated).toBe(0);
  });

  it("foto de una habitación pública ajena → no está entre las tuyas, sin borrar", async () => {
    const theirs = worldImage(3, OTHER_ROOM_ID);
    const world = setup({
      rooms: [
        room(),
        room({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" }),
      ],
      owners: { [OTHER_USER]: null },
      images: [theirs],
      objects: [theirs.storage_path],
    });
    const state = await deleteRoomPhoto({}, deleteForm(theirs.id));
    expect(state).toEqual({ formError: "Esa foto ya no está en tu habitación." });
    expect(world.state.images).toEqual([theirs]);
    expect(world.state.objects.has(theirs.storage_path)).toBe(true);
    expect(world.state.adminCreated).toBe(0);
  });

  it("una ruta del navegador → rechazada, sin consultar ni borrar nada", async () => {
    const world = setup({ images: [photo1], objects: [photo1.storage_path] });
    const state = await deleteRoomPhoto(
      {},
      deleteForm(photo1.id, [["storagePath", `${OTHER_ROOM_ID}/x.webp`]])
    );
    expect(state).toEqual({ formError: "Campo no permitido" });
    expect(world.userCalls.some((call) => call.table === "room_images")).toBe(false);
    expect(world.state.adminCreated).toBe(0);
    expect(world.state.images).toHaveLength(1);
  });

  it("imageId que no es un UUID → no está, sin borrar", async () => {
    const world = setup({ images: [photo1], objects: [photo1.storage_path] });
    const state = await deleteRoomPhoto({}, deleteForm("../../otra"));
    expect(state).toEqual({ formError: "Esa foto ya no está en tu habitación." });
    expect(world.state.adminCreated).toBe(0);
  });

  it("propietaria → borra la fila y después su objeto (ruta del servidor); revalida", async () => {
    const photo2 = worldImage(2);
    const world = setup({
      images: [photo1, photo2],
      objects: [photo1.storage_path, photo2.storage_path],
    });
    const state = await deleteRoomPhoto({}, deleteForm(photo1.id));
    expect(state).toEqual({ success: "Foto quitada." });
    expect(world.state.images).toEqual([photo2]);
    expect([...world.state.objects]).toEqual([photo2.storage_path]);
    const order = world.state.log.filter((e) => !e.startsWith("user:"));
    expect(order).toEqual(["admin:room_images.delete", "storage.remove"]);
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith(PHOTOS_PATH);
  });

  it("si el servicio falla al borrar la fila → mensaje genérico y nada borrado", async () => {
    const world = setup({ images: [photo1], objects: [photo1.storage_path] });
    world.failures.admin = () => ({ code: "08006", message: "connection <detalle>" });
    const state = await deleteRoomPhoto({}, deleteForm(photo1.id));
    expect(state).toEqual({
      formError: "No hemos podido quitar la foto. Vuelve a intentarlo en un momento.",
    });
    expect(world.state.images).toHaveLength(1);
    expect(world.state.objects.size).toBe(1);
  });
});
