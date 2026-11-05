import { describe, expect, it } from "vitest";
import {
  ROOM_IMAGE_ACCEPTED_TYPES,
  ROOM_IMAGE_MAX_BYTES,
  ROOM_IMAGE_MAX_COUNT,
  ROOM_IMAGE_MESSAGES,
  ROOM_IMAGE_SIGNED_URL_TTL_SECONDS,
  ROOM_IMAGE_STORED_TYPE,
  ROOM_IMAGES_BUCKET,
  ROOM_IMAGES_BUCKET_MAX_BYTES,
  roomImageFileSchema,
  roomImageStoragePath,
  roomImageUploadSchema,
} from "@/lib/validation/room-images";

const ROOM = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const file = (size: number, type: string, name = "foto.jpg") =>
  new File([new Uint8Array(size)], name, { type });

const messages = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.message));

describe("lib/validation/room-images: límites (R5) y ruta", () => {
  it("4 MiB exactos en la aplicación y 5 MiB en el bucket, 8 fotos y URL de 10 minutos", () => {
    expect(ROOM_IMAGE_MAX_BYTES).toBe(4_194_304);
    expect(ROOM_IMAGES_BUCKET_MAX_BYTES).toBe(5_242_880);
    expect(ROOM_IMAGE_MAX_BYTES).toBeLessThan(ROOM_IMAGES_BUCKET_MAX_BYTES);
    expect(ROOM_IMAGE_MAX_COUNT).toBe(8);
    expect(ROOM_IMAGE_SIGNED_URL_TTL_SECONDS).toBe(600);
    expect(ROOM_IMAGES_BUCKET).toBe("room-images");
    expect(ROOM_IMAGE_STORED_TYPE).toBe("image/webp");
    expect([...ROOM_IMAGE_ACCEPTED_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("la ruta es room_id/id.webp, como exige chk_room_images_storage_path", () => {
    expect(roomImageStoragePath(ROOM, "0b9f7a52-1c3d-4e5f-8a6b-7c8d9e0f1a2b")).toBe(
      `${ROOM}/0b9f7a52-1c3d-4e5f-8a6b-7c8d9e0f1a2b.webp`
    );
  });
});

describe("roomImageFileSchema: primer filtro de la subida", () => {
  it("acepta JPEG, PNG y WebP de hasta 4 MiB exactos", () => {
    for (const type of ROOM_IMAGE_ACCEPTED_TYPES) {
      expect(roomImageFileSchema.safeParse(file(1, type)).success, type).toBe(true);
    }
    expect(
      roomImageFileSchema.safeParse(file(ROOM_IMAGE_MAX_BYTES, "image/jpeg")).success
    ).toBe(true);
  });

  it("rechaza un archivo de más de 4 MiB, vacío o de otro tipo, con su mensaje", () => {
    expect(
      messages(
        roomImageFileSchema.safeParse(file(ROOM_IMAGE_MAX_BYTES + 1, "image/jpeg"))
      )
    ).toEqual([ROOM_IMAGE_MESSAGES.tooLarge]);
    expect(messages(roomImageFileSchema.safeParse(file(0, "image/jpeg")))).toEqual([
      ROOM_IMAGE_MESSAGES.empty,
    ]);
    for (const type of [
      "image/svg+xml",
      "image/gif",
      "image/heic",
      "image/avif",
      "text/html",
      "",
    ]) {
      expect(messages(roomImageFileSchema.safeParse(file(10, type))), type).toEqual([
        ROOM_IMAGE_MESSAGES.type,
      ]);
    }
  });

  it("sin archivo, o con un texto en su lugar, pide una foto", () => {
    expect(messages(roomImageFileSchema.safeParse(undefined))).toEqual([
      ROOM_IMAGE_MESSAGES.required,
    ]);
    expect(messages(roomImageFileSchema.safeParse("foto.jpg"))).toEqual([
      ROOM_IMAGE_MESSAGES.required,
    ]);
  });
});

describe("roomImageUploadSchema: solo habitación y foto", () => {
  it("acepta la habitación (normalizada a minúsculas) y la foto", () => {
    const photo = file(10, "image/png");
    const result = roomImageUploadSchema.safeParse({ roomId: ROOM.toUpperCase(), photo });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ roomId: ROOM, photo });
  });

  it("nunca acepta la ruta, la posición ni el propietario del cliente", () => {
    for (const extra of ["storagePath", "position", "ownerId", "id"]) {
      const result = roomImageUploadSchema.safeParse({
        roomId: ROOM,
        photo: file(10, "image/png"),
        [extra]: "x",
      });
      expect(result.success, extra).toBe(false);
      expect(messages(result), extra).toContain("Campo no permitido");
    }
  });

  it("rechaza un id de habitación que no es un UUID", () => {
    const result = roomImageUploadSchema.safeParse({
      roomId: "../otra",
      photo: file(10, "image/png"),
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toEqual(["Identificador no válido"]);
  });
});
