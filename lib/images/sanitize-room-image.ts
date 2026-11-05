import "server-only";

import sharp, { type Metadata, type OutputInfo, type SharpOptions } from "sharp";
import {
  ROOM_IMAGE_MAX_BYTES,
  ROOM_IMAGE_MAX_DIMENSION,
  ROOM_IMAGE_MAX_INPUT_PIXELS,
  ROOM_IMAGE_STORED_TYPE,
} from "@/lib/validation/room-images";

/**
 * Limpieza de una foto de habitación antes de guardarla (Fase 4.2).
 *
 * La imagen se vuelve a codificar desde sus píxeles: se decodifica, se aplica
 * la orientación EXIF, se reduce a 2048 px de lado mayor (sin ampliar) y se
 * codifica como WebP. sharp no copia ningún metadato a la salida salvo que se
 * pida (`withMetadata`, `keepExif`, `keepIccProfile`, `keepMetadata`), y aquí
 * no se pide nunca: EXIF (con la ubicación GPS, el modelo del móvil, la
 * fecha), XMP, IPTC, el perfil ICC y los comentarios se quedan fuera. Después
 * se vuelve a leer la salida y se rechaza si le quedara alguno.
 *
 * Rechaza, por el CONTENIDO y no por el tipo que declare el navegador:
 *   - formatos que no sean JPEG, PNG o WebP (SVG, GIF, HEIC/AVIF, TIFF…):
 *     se reconocen por la firma de sus primeros bytes ANTES de llamar a
 *     sharp (N1), así que el contenido de otro formato no llega a ningún
 *     decodificador de libvips;
 *   - un archivo cuyo tipo declarado no coincide con su firma (un JPEG que
 *     dice ser PNG, un SVG que dice ser JPEG);
 *   - imágenes animadas (más de una página o fotograma);
 *   - archivos vacíos, dañados o truncados (`failOn: "warning"`), también
 *     los que empiezan con una firma válida;
 *   - más de 4 MiB, a la entrada o a la salida, o más de 40 MP.
 * La firma es un primer filtro: no valida el resto del archivo. Lo valida la
 * decodificación de sharp, y después se comprueba que sharp ha leído el
 * mismo formato que dice la firma.
 *
 * No cambia la configuración global de sharp (caché, concurrencia ni
 * cargadores): es del proceso entero y la comparte el optimizador de
 * imágenes de Next.js (L3).
 *
 * No guarda el original ni su nombre en ningún sitio, y no registra nada.
 */

export type SanitizeRejection =
  | "empty"
  | "too_large"
  | "unsupported_format"
  | "type_mismatch"
  | "animated"
  | "too_many_pixels"
  | "invalid_image"
  | "output_too_large"
  | "metadata_remaining";

export type SanitizedRoomImage = {
  data: Buffer;
  width: number;
  height: number;
  contentType: typeof ROOM_IMAGE_STORED_TYPE;
};

export type SanitizeResult =
  { ok: true; image: SanitizedRoomImage } | { ok: false; reason: SanitizeRejection };

/** Límites; solo los tests pasan otros (p. ej. para provocar `output_too_large`). */
export type SanitizeLimits = {
  maxBytes: number;
  maxDimension: number;
  maxInputPixels: number;
};

export type SanitizeOptions = {
  /** Tipo MIME que declara el archivo; si se da, tiene que coincidir con su firma. */
  declaredType?: string;
  limits?: SanitizeLimits;
};

const DEFAULT_LIMITS: SanitizeLimits = {
  maxBytes: ROOM_IMAGE_MAX_BYTES,
  maxDimension: ROOM_IMAGE_MAX_DIMENSION,
  maxInputPixels: ROOM_IMAGE_MAX_INPUT_PIXELS,
};

/** Formatos que se aceptan, y el tipo MIME de cada uno. */
export type RasterFormat = "jpeg" | "png" | "webp";
const FORMAT_TYPES: Record<RasterFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const WEBP_QUALITY = 80;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X"]);
const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/**
 * Formato por la firma de los primeros bytes, sin decodificar nada (N1):
 *   - JPEG: `FF D8 FF` (inicio de imagen y primer marcador);
 *   - PNG: la firma de 8 bytes y, como exige el formato, `IHDR` como primer
 *     bloque;
 *   - WebP: `RIFF`, el tamaño, `WEBP` y un primer bloque `VP8 `, `VP8L` o
 *     `VP8X`.
 * `null` para cualquier otra cosa (SVG, GIF, HEIF/AVIF, TIFF, BMP…). Es un
 * filtro previo, no una validación del archivo: el resto lo decide la
 * decodificación.
 */
export function detectRasterFormat(input: Uint8Array): RasterFormat | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff)
    return "jpeg";
  if (
    input.length >= 16 &&
    PNG_SIGNATURE.every((byte, i) => input[i] === byte) &&
    ascii(input, 12, 16) === "IHDR"
  )
    return "png";
  if (
    input.length >= 16 &&
    ascii(input, 0, 4) === "RIFF" &&
    ascii(input, 8, 12) === "WEBP" &&
    WEBP_CHUNKS.has(ascii(input, 12, 16))
  )
    return "webp";
  return null;
}

const reject = (reason: SanitizeRejection): SanitizeResult => ({ ok: false, reason });

function isPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

/** Metadatos que conserva una imagen codificada (vacío = ninguno). */
export async function remainingMetadata(data: Uint8Array): Promise<string[]> {
  const meta = await sharp(data).metadata();
  const found: string[] = [];
  if (meta.exif) found.push("exif");
  if (meta.xmp) found.push("xmp");
  if (meta.iptc) found.push("iptc");
  if (meta.icc) found.push("icc");
  if (meta.comments && meta.comments.length > 0) found.push("comments");
  return found;
}

export async function sanitizeRoomImage(
  input: Uint8Array,
  options: SanitizeOptions = {}
): Promise<SanitizeResult> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  if (input.byteLength === 0) return reject("empty");
  if (input.byteLength > limits.maxBytes) return reject("too_large");

  // Antes de sharp: solo la firma de un formato aceptado llega a decodificarse.
  const detected = detectRasterFormat(input);
  if (!detected) return reject("unsupported_format");
  if (
    options.declaredType !== undefined &&
    options.declaredType !== FORMAT_TYPES[detected]
  )
    return reject("type_mismatch");

  const inputOptions: SharpOptions = {
    limitInputPixels: limits.maxInputPixels,
    failOn: "warning",
    animated: false,
  };

  let meta: Metadata;
  try {
    meta = await sharp(input, inputOptions).metadata();
  } catch (error) {
    return reject(isPixelLimitError(error) ? "too_many_pixels" : "invalid_image");
  }
  // sharp elige su cargador por el contenido: tiene que ser el de la firma.
  if (meta.format !== detected) return reject("invalid_image");
  if ((meta.pages ?? 1) > 1) return reject("animated");
  if (!meta.width || !meta.height) return reject("invalid_image");
  if (meta.width * meta.height > limits.maxInputPixels) return reject("too_many_pixels");

  let output: { data: Buffer; info: OutputInfo };
  try {
    output = await sharp(input, inputOptions)
      .autoOrient()
      .resize({
        width: limits.maxDimension,
        height: limits.maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    return reject(isPixelLimitError(error) ? "too_many_pixels" : "invalid_image");
  }

  // Comprobación independiente de lo que se va a guardar.
  let check: Metadata;
  let remaining: string[];
  try {
    check = await sharp(output.data).metadata();
    remaining = await remainingMetadata(output.data);
  } catch {
    return reject("invalid_image");
  }
  if (check.format !== "webp" || (check.pages ?? 1) > 1) return reject("invalid_image");
  if (remaining.length > 0) return reject("metadata_remaining");
  if (output.data.byteLength > limits.maxBytes) return reject("output_too_large");

  return {
    ok: true,
    image: {
      data: output.data,
      width: output.info.width,
      height: output.info.height,
      contentType: ROOM_IMAGE_STORED_TYPE,
    },
  };
}
