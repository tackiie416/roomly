import { z } from "zod";
import { uuidSchema } from "@/lib/validation/common";

/**
 * Fotos de habitaciones (Fase 4.2, R5): límites y validación de la subida.
 *
 * Sin `server-only`: la futura interfaz puede usar las constantes (`accept`,
 * textos de ayuda). La limpieza de la imagen vive en
 * lib/images/sanitize-room-image.ts y la escritura en
 * lib/services/room-images.ts (service_role, D17).
 *
 * La base de datos impone su parte aunque la escritura no pase por aquí
 * (`20261024120000_room_images_storage_visibility.sql`): 8 fotos por
 * habitación, ruta `room_id/id.webp` y un bucket que solo admite
 * `image/webp` de hasta 5 MiB. `tests/unit/validation-infra.test.ts`
 * comprueba que estas constantes y la migración coinciden.
 */

/**
 * Bucket de Storage de las fotos (lo crea
 * `20261024120000_room_images_storage_visibility.sql`). Solo escribe el
 * servidor, y las fotos se sirven con URL firmadas que emite el servidor (D1).
 */
export const ROOM_IMAGES_BUCKET = "room-images";

/**
 * Validez de una URL firmada de foto, en segundos (10 minutos, D1). Es corta
 * porque la URL no revoca nada mientras dura: si la habitación se oculta (R7)
 * o la foto se borra, quien ya tenga la URL la puede seguir usando hasta que
 * caduque. Después, la interfaz pide otra al servidor, que vuelve a comprobar
 * los permisos. También es el `Cache-Control` de los objetos al subirlos, para
 * que ninguna caché guarde la foto más tiempo que el que vale su URL.
 */
export const ROOM_IMAGE_SIGNED_URL_TTL_SECONDS = 600;

/** Fotos por habitación, como el trigger `trg_room_images_integrity`. */
export const ROOM_IMAGE_MAX_COUNT = 8;

/**
 * Tamaño máximo de una foto en la aplicación: 4 MiB exactos (4 194 304
 * bytes), para la entrada y para la imagen ya limpiada. Más bajo que el del
 * bucket por si el alojamiento limita el cuerpo de las peticiones (sin
 * verificar; ver docs/SECURITY.md, «Subida de archivos»).
 */
export const ROOM_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Límite del bucket (5 MiB): defensa adicional, también para service_role. */
export const ROOM_IMAGES_BUCKET_MAX_BYTES = 5 * 1024 * 1024;

/** Lado mayor de la imagen guardada, en píxeles (no se amplía si es menor). */
export const ROOM_IMAGE_MAX_DIMENSION = 2048;

/**
 * Píxeles máximos de la imagen de entrada (40 MP, p. ej. 8000×5000): frena
 * imágenes que pesan poco comprimidas y ocupan mucho al decodificarse.
 */
export const ROOM_IMAGE_MAX_INPUT_PIXELS = 40_000_000;

/** Tipos que se aceptan al subir. El formato real lo comprueba el sanitizador. */
export const ROOM_IMAGE_ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Único tipo que se guarda: lo que produce el sanitizador. */
export const ROOM_IMAGE_STORED_TYPE = "image/webp";

/** Ruta del objeto en el bucket, la misma que exige `chk_room_images_storage_path`. */
export function roomImageStoragePath(roomId: string, imageId: string): string {
  return `${roomId}/${imageId}.webp`;
}

export const ROOM_IMAGE_MESSAGES = {
  required: "Elige una foto",
  empty: "La foto está vacía",
  tooLarge: "La foto no puede superar los 4 MB",
  type: "Solo se admiten fotos JPEG, PNG o WebP",
  mismatch: "La foto no es del tipo que indica el archivo. Prueba con otra",
  limit: `Una habitación puede tener como máximo ${ROOM_IMAGE_MAX_COUNT} fotos`,
} as const;

/**
 * Archivo subido. El tipo MIME lo declara el navegador y es solo un primer
 * filtro: el sanitizador decide por el contenido (un SVG renombrado a
 * `.jpg` no pasa).
 */
export const roomImageFileSchema = z
  .file({ error: ROOM_IMAGE_MESSAGES.required })
  .min(1, { error: ROOM_IMAGE_MESSAGES.empty })
  .max(ROOM_IMAGE_MAX_BYTES, { error: ROOM_IMAGE_MESSAGES.tooLarge })
  .mime([...ROOM_IMAGE_ACCEPTED_TYPES], { error: ROOM_IMAGE_MESSAGES.type });

/** Entrada de `addRoomImage`. Nunca se aceptan ruta, posición ni propietario. */
export const roomImageUploadSchema = z.strictObject(
  {
    roomId: uuidSchema,
    photo: roomImageFileSchema,
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? "Campo no permitido" : undefined,
  }
);

export type RoomImageUploadInput = z.input<typeof roomImageUploadSchema>;
