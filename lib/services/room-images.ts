import "server-only";

import { randomUUID } from "node:crypto";
import {
  sanitizeRoomImage,
  type SanitizeRejection,
  type SanitizeResult,
} from "@/lib/images/sanitize-room-image";
import { createAdminClient } from "@/lib/supabase/admin";
import { toFieldErrors, uuidSchema } from "@/lib/validation/common";
import {
  ROOM_IMAGE_MAX_COUNT,
  ROOM_IMAGE_MESSAGES,
  ROOM_IMAGE_SIGNED_URL_TTL_SECONDS,
  ROOM_IMAGE_STORED_TYPE,
  ROOM_IMAGES_BUCKET,
  roomImageStoragePath,
  roomImageUploadSchema,
} from "@/lib/validation/room-images";
import {
  type DbClient,
  type DbError,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";

/**
 * Fotos de las habitaciones (Fase 4.2). Tercer servicio con service_role
 * (D17 ampliada por el propietario el 2026-10-24 y, para firmar URL, el
 * 2026-10-25 con D1), único escritor de `room_images` y del bucket
 * `room-images`, y único que emite URL de las fotos.
 *
 * Reparto de clientes:
 *   - LECTURA y comprobaciones previas (sesión, cuenta activa, propiedad y
 *     estado de la habitación, fotos que se pueden ver): cliente del usuario
 *     (`DbClient`, RLS). Nunca service_role.
 *   - ESCRITURA (Storage y `room_images`) y FIRMA de URL:
 *     `createAdminClient()`, porque ningún cliente tiene escritura en la
 *     tabla ni ninguna política en `storage.objects`. Solo después de las
 *     comprobaciones (y, al subir, de limpiar la imagen:
 *     lib/images/sanitize-room-image.ts).
 *
 * URL firmadas (D1: el bucket es privado desde 20261025120000). Solo se
 * firman las rutas de las filas que el cliente del usuario acaba de leer, así
 * que la autorización es la de la RLS: R7 (habitación activa de una cuenta
 * activa), la propietaria o el admin activo. Una URL firmada no autoriza
 * nada por sí misma: dura `ROOM_IMAGE_SIGNED_URL_TTL_SECONDS` (10 minutos) y
 * mientras tanto no se puede revocar; después, la interfaz pide otra y se
 * vuelven a comprobar los permisos. Nunca se devuelve una URL pública ni se
 * registra una URL firmada (lleva un token).
 *
 * El trigger `trg_room_images_integrity` repite en la base de datos lo que
 * importa también para service_role: 8 fotos por habitación (también con
 * subidas simultáneas), habitación ni retirada ni eliminada, cuenta activa y
 * ruta `room_id/id.webp`.
 *
 * Objetos huérfanos: se sube primero el objeto y después se registra la
 * fila, y el objeto solo se borra cuando es seguro que la fila no existe ni
 * va a existir. Así nunca queda una fila que apunte a un objeto inexistente;
 * a cambio, puede quedar un objeto sin fila (un huérfano, con un UUID
 * aleatorio como nombre y sin datos personales).
 *   - INSERT rechazado de forma definitiva por la base de datos
 *     (`isDefinitiveInsertRejection`) y comprobado que la fila no existe: se
 *     borra el objeto (compensación).
 *   - Resultado ambiguo (fallo de red, tiempo agotado, respuesta sin código
 *     SQLSTATE…): no se borra nada todavía. Se busca la fila por su id, su
 *     habitación y su ruta exactos. Si está, la subida se completó. Si no está,
 *     el objeto se conserva igualmente, porque la transacción pudo quedar en
 *     curso y confirmarse después; se avisa para revisarlo
 *     (`room_image_insert_unconfirmed`).
 *   - Si esa comprobación también falla, se conserva el objeto y se avisa
 *     (`room_image_insert_unverified`).
 * Si falla la propia subida, no se registra ninguna fila, pero el objeto pudo
 * quedar guardado (por ejemplo, si se perdió la respuesta): se avisa
 * (`room_image_upload_unconfirmed`) y no se intenta nada más.
 * Al borrar una foto, primero se borra la fila (deja de verse) y después el
 * objeto; si el objeto no se puede borrar, queda huérfano y se avisa. Los
 * avisos llevan solo el evento y la ruta (`room_id/id.webp`), para
 * conciliarlos después.
 */

export type RoomImage = {
  id: string;
  position: number;
  /**
   * URL firmada (bucket privado), o `null` si no se pudo firmar: la
   * interfaz muestra un hueco y la vuelve a pedir. No se guarda ni se
   * registra.
   */
  url: string | null;
  /**
   * Hasta cuándo vale `url` como mínimo (ISO 8601, calculado antes de pedir
   * la firma), o `null` si no hay URL. Antes de esa hora, la interfaz pide
   * otra.
   */
  expiresAt: string | null;
};

type ImageRow = { id: string; storage_path: string; position: number };

const IMAGE_COLUMNS = "id, storage_path, position" as const;

/** Mensajes de la limpieza, sin detalles técnicos. */
const SANITIZE_MESSAGES: Record<SanitizeRejection, string> = {
  empty: ROOM_IMAGE_MESSAGES.empty,
  too_large: ROOM_IMAGE_MESSAGES.tooLarge,
  unsupported_format: ROOM_IMAGE_MESSAGES.type,
  type_mismatch: ROOM_IMAGE_MESSAGES.mismatch,
  animated: "No se admiten imágenes animadas",
  too_many_pixels: "La foto tiene demasiada resolución",
  invalid_image: "No hemos podido leer la foto. Prueba con otra",
  output_too_large: ROOM_IMAGE_MESSAGES.tooLarge,
  metadata_remaining: "No hemos podido procesar la foto. Prueba con otra",
};

/**
 * Avisos de recuperación (posibles objetos huérfanos), sin datos sensibles:
 *   - room_image_upload_unconfirmed: la subida no se confirmó; puede haber un
 *     objeto sin fila en esa ruta. Se avisa ante cualquier error de la
 *     subida, sin distinguir los rechazos definitivos de Storage: con la
 *     imagen ya limpia y validada, ninguno es esperable;
 *   - room_image_orphan_after_insert: INSERT rechazado y fila ausente, pero
 *     no se pudo borrar el objeto;
 *   - room_image_insert_unconfirmed: resultado ambiguo y fila no encontrada;
 *     el objeto se conserva;
 *   - room_image_insert_unverified: no se pudo comprobar si la fila existe;
 *     el objeto se conserva;
 *   - room_image_orphan_after_delete: fila borrada, pero no el objeto.
 * Al borrar una habitación (`removeDeletedRoomObjects`), con la ruta de la
 * carpeta (`room_id/`) o la de cada objeto:
 *   - room_objects_cleanup_skipped: no se ha podido confirmar que la
 *     habitación ya no existe; no se ha borrado ningún objeto;
 *   - room_image_orphan_after_room_delete: el objeto sigue en el bucket
 *     después de la limpieza;
 *   - room_objects_unverified: no se ha podido comprobar si quedan objetos.
 */
export type RecoveryEvent =
  | "room_image_upload_unconfirmed"
  | "room_image_orphan_after_insert"
  | "room_image_insert_unconfirmed"
  | "room_image_insert_unverified"
  | "room_image_orphan_after_delete"
  | "room_objects_cleanup_skipped"
  | "room_image_orphan_after_room_delete"
  | "room_objects_unverified";

export type RoomImagesDeps = {
  /** Cliente con service_role para escribir y firmar. Se inyecta en los tests. */
  adminClient: () => DbClient;
  /** Limpieza de la imagen; `declaredType` es el tipo MIME que dice el archivo. */
  sanitize: (input: Uint8Array, declaredType: string) => Promise<SanitizeResult>;
  newId: () => string;
  now: () => Date;
  /** Validez de las URL firmadas, en segundos. */
  signedUrlTtlSeconds: number;
  /** Aviso de recuperación: solo el evento y la ruta (ids). */
  reportRecovery: (event: RecoveryEvent, storagePath: string) => void;
};

const DEFAULT_DEPS: RoomImagesDeps = {
  adminClient: () => createAdminClient(),
  sanitize: (input, declaredType) => sanitizeRoomImage(input, { declaredType }),
  newId: () => randomUUID(),
  now: () => new Date(),
  signedUrlTtlSeconds: ROOM_IMAGE_SIGNED_URL_TTL_SECONDS,
  reportRecovery: (event, storagePath) => {
    console.warn(`[room-images] ${event}: ${storagePath}`);
  },
};

/**
 * Clases SQLSTATE con las que la base de datos rechaza una sentencia antes de
 * confirmar nada: 22 (datos no válidos), 23 (restricciones: CHECK, FK,
 * UNIQUE y los `raise` 23514 del trigger), 42 (permisos y sintaxis, como el
 * 42501 de GRANT o RLS) y P0 (`raise` de PL/pgSQL). PostgREST ejecuta cada
 * petición en una transacción y, si devuelve uno de estos errores, ya la ha
 * deshecho: la fila no existe ni va a existir.
 */
const DEFINITIVE_SQLSTATE_CLASSES = new Set(["22", "23", "42", "P0"]);

/**
 * `true` solo si el error del INSERT es un rechazo definitivo de la base de
 * datos. Decide por el código, nunca por el texto del mensaje. Todo lo demás
 * es ambiguo:
 *   - sin código o con código vacío: un fallo de red, un tiempo agotado o un
 *     aborto (supabase-js devuelve `code: ""` y `status: 0`), o una respuesta
 *     que no es JSON, como un 502 de un proxy;
 *   - un código que no es una cadena (un número, por ejemplo, en un JSON que
 *     no viene de PostgREST): se trata como ambiguo, sin lanzar excepciones;
 *   - los códigos `PGRST…` de PostgREST;
 *   - otras clases SQLSTATE: 08 (conexión), 40 (transacción deshecha o, con
 *     40003, resultado desconocido), 53 (recursos), 57 (intervención del
 *     operador, como una cancelación o un cierre del servidor), 58 (sistema)
 *     y XX (error interno).
 */
export function isDefinitiveInsertRejection(error: DbError): boolean {
  // El tipo dice `string`, pero el error llega de un JSON: se comprueba.
  const code: unknown = error?.code;
  return (
    typeof code === "string" &&
    /^[0-9A-Z]{5}$/.test(code) &&
    DEFINITIVE_SQLSTATE_CLASSES.has(code.slice(0, 2))
  );
}

type InsertCheck =
  { kind: "present"; row: ImageRow } | { kind: "absent" } | { kind: "unknown" };

/**
 * ¿Existe la fila de este INSERT? Con el cliente del usuario (la propietaria
 * ve siempre las fotos de sus habitaciones por RLS) y limitada al id, la
 * habitación y la ruta exactos. Es una lectura (GET), que supabase-js
 * reintenta ante fallos de red. Si falla, el resultado es desconocido.
 */
async function checkInsertedImage(
  supabase: DbClient,
  imageId: string,
  roomId: string,
  storagePath: string
): Promise<InsertCheck> {
  const { data, error } = await supabase
    .from("room_images")
    .select(IMAGE_COLUMNS)
    .eq("id", imageId)
    .eq("room_id", roomId)
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (error) return { kind: "unknown" };
  return data ? { kind: "present", row: data as ImageRow } : { kind: "absent" };
}

type SignedImages = { images: RoomImage[]; signed: boolean };

/**
 * La petición de firma, o `null` si falla. storage-js devuelve como `error`
 * los fallos de Storage y de red, pero relanza los inesperados (por ejemplo,
 * una respuesta que no es una lista): también son un `null`, para que una
 * subida ya guardada no acabe en error.
 */
async function requestSignedUrls(paths: string[], ttl: number, deps: RoomImagesDeps) {
  try {
    const { data, error } = await deps
      .adminClient()
      .storage.from(ROOM_IMAGES_BUCKET)
      .createSignedUrls(paths, ttl);
    return error || !Array.isArray(data) ? null : data;
  } catch {
    return null;
  }
}

/**
 * Firma, en una sola petición, las URL de unas filas que el cliente del
 * usuario ya ha leído (esa lectura es la autorización). Defensa en
 * profundidad: solo se firman rutas canónicas de esa habitación, y solo se
 * aceptan las URL que Storage devuelve para una ruta pedida. Si la petición
 * falla, `signed` es `false` y ninguna foto lleva URL; si falla una foto,
 * esa queda con `url: null`. Firmar no cambia nada, así que un error (aunque
 * sea ambiguo) solo significa que no hay URL.
 */
async function signImages(
  rows: ImageRow[],
  roomId: string,
  deps: RoomImagesDeps
): Promise<SignedImages> {
  const unsigned = (signed: boolean): SignedImages => ({
    images: rows.map((row) => ({
      id: row.id,
      position: row.position,
      url: null,
      expiresAt: null,
    })),
    signed,
  });
  const paths = rows
    .filter((row) => row.storage_path === roomImageStoragePath(roomId, row.id))
    .map((row) => row.storage_path);
  if (paths.length === 0) return unsigned(true);

  const ttl = deps.signedUrlTtlSeconds;
  // Antes de pedir la firma: la URL vale al menos hasta aquí.
  const expiresAt = new Date(deps.now().getTime() + ttl * 1000).toISOString();
  const data = await requestSignedUrls(paths, ttl, deps);
  if (!data) return unsigned(false);

  const requested = new Set(paths);
  const urls = new Map<string, string>();
  for (const item of data) {
    if (
      item &&
      !item.error &&
      typeof item.path === "string" &&
      requested.has(item.path) &&
      typeof item.signedUrl === "string" &&
      item.signedUrl.length > 0
    ) {
      urls.set(item.path, item.signedUrl);
    }
  }
  return {
    images: rows.map((row) => {
      const url = urls.get(row.storage_path) ?? null;
      return {
        id: row.id,
        position: row.position,
        url,
        expiresAt: url ? expiresAt : null,
      };
    }),
    signed: true,
  };
}

/**
 * Errores del trigger y de las restricciones → error de servicio, sin el
 * mensaje. El error llega de un JSON: un mensaje que no sea una cadena se
 * trata como vacío, sin lanzar excepciones.
 */
function mapImageWriteError<T>(error: {
  code?: string;
  message?: string;
}): ServiceResult<T> {
  const raw: unknown = error.message;
  const message = typeof raw === "string" ? raw : "";
  if (error.code === "23514" && message.includes("account_deleted:"))
    return fail("deleted");
  if (error.code === "23514" && message.includes("room_images_limit:")) {
    return fail("validation", { photo: [ROOM_IMAGE_MESSAGES.limit] });
  }
  if (error.code === "23514" && message.includes("room_not_writable:"))
    return fail("forbidden");
  return mapDbError(error);
}

/** Cuenta propia existente y activa (cliente del usuario). */
async function requireActiveAccount(
  supabase: DbClient,
  userId: string
): Promise<ServiceResult<true>> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!profile) return fail("no_profile");
  if (profile.deleted_at !== null) return fail("deleted");
  return ok(true);
}

type OwnRoom = { status: string; deleted_at: string | null };

/**
 * La habitación es de quien llama (cliente del usuario, filtrando por
 * `owner_id`: una habitación pública de otra persona también es visible por
 * RLS, pero no es suya). Si no existe o no es suya, `not_found`.
 */
async function readOwnRoom(
  supabase: DbClient,
  userId: string,
  roomId: string
): Promise<ServiceResult<OwnRoom>> {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("id, owner_id, status, deleted_at")
    .eq("id", roomId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!room || room.owner_id !== userId) return fail("not_found");
  return ok({ status: room.status, deleted_at: room.deleted_at });
}

/** Admite fotos nuevas: ni eliminada ni retirada (como el trigger). */
function acceptsNewImages(room: OwnRoom): boolean {
  return room.deleted_at === null && room.status !== "removed";
}

async function readRoomImages(
  supabase: DbClient,
  roomId: string
): Promise<ServiceResult<ImageRow[]>> {
  const { data, error } = await supabase
    .from("room_images")
    .select(IMAGE_COLUMNS)
    .eq("room_id", roomId)
    .order("position")
    .order("created_at")
    .order("id");
  if (error) return mapDbError(error);
  return ok((data ?? []) as ImageRow[]);
}

/** Firma las fotos leídas; si la firma falla entera, `unknown` (se puede reintentar). */
async function signedList(
  rows: ImageRow[],
  roomId: string,
  deps: RoomImagesDeps
): Promise<ServiceResult<RoomImage[]>> {
  const signed = await signImages(rows, roomId, deps);
  return signed.signed ? ok(signed.images) : fail("unknown");
}

/**
 * Fotos de una habitación propia, por orden, con URL firmadas. Lee con el
 * cliente del usuario (filtrando por `owner_id`) y solo firma lo leído.
 */
export async function listOwnRoomImages(
  supabase: DbClient,
  roomId: unknown,
  deps: RoomImagesDeps = DEFAULT_DEPS
): Promise<ServiceResult<RoomImage[]>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const parsed = uuidSchema.safeParse(roomId);
  if (!parsed.success) return fail("validation", { roomId: ["Identificador no válido"] });

  const room = await readOwnRoom(supabase, userId, parsed.data);
  if (!room.ok) return room;

  const images = await readRoomImages(supabase, parsed.data);
  if (!images.ok) return images;
  return signedList(images.data, parsed.data, deps);
}

/**
 * Fotos de una habitación para quien la mira (anónimo, otro usuario, la
 * propietaria o el admin), por orden, con URL firmadas. La autorización es la
 * de la RLS, con el cliente de quien pregunta:
 *   - la habitación tiene que ser visible (`rooms`: pública con R7, propia o
 *     del admin activo); si no, `not_found`, sin firmar nada;
 *   - las fotos, las que deja ver `room_images` (las mismas reglas).
 * Una habitación oculta por R7 (cuenta desactivada, borrador, pausada,
 * retirada o eliminada) no da ninguna URL a nadie más que a la propietaria y
 * al admin activo.
 */
export async function listRoomImages(
  supabase: DbClient,
  roomId: unknown,
  deps: RoomImagesDeps = DEFAULT_DEPS
): Promise<ServiceResult<RoomImage[]>> {
  const parsed = uuidSchema.safeParse(roomId);
  if (!parsed.success) return fail("validation", { roomId: ["Identificador no válido"] });

  const { data: room, error } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!room) return fail("not_found");

  const images = await readRoomImages(supabase, parsed.data);
  if (!images.ok) return images;
  return signedList(images.data, parsed.data, deps);
}

/**
 * La foto recién guardada, con su URL firmada. Si la firma falla, la subida
 * sigue siendo un éxito (la fila y el objeto existen), con `url: null`: dar
 * un error haría que se repitiera la subida.
 */
async function uploadedImage(
  row: ImageRow,
  roomId: string,
  deps: RoomImagesDeps
): Promise<RoomImage> {
  const [image] = (await signImages([row], roomId, deps)).images;
  return image!;
}

/**
 * Añade una foto a una habitación propia: comprueba, limpia, sube el objeto
 * y registra la fila. La ruta, el id y la posición los decide el servidor.
 */
export async function addRoomImage(
  supabase: DbClient,
  input: unknown,
  deps: RoomImagesDeps = DEFAULT_DEPS
): Promise<ServiceResult<RoomImage>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const parsed = roomImageUploadSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));
  const { roomId, photo } = parsed.data;

  const account = await requireActiveAccount(supabase, userId);
  if (!account.ok) return account;
  const room = await readOwnRoom(supabase, userId, roomId);
  if (!room.ok) return room;
  if (!acceptsNewImages(room.data)) return fail("forbidden");
  const existing = await readRoomImages(supabase, roomId);
  if (!existing.ok) return existing;
  if (existing.data.length >= ROOM_IMAGE_MAX_COUNT) {
    return fail("validation", { photo: [ROOM_IMAGE_MESSAGES.limit] });
  }

  const sanitized = await deps.sanitize(
    new Uint8Array(await photo.arrayBuffer()),
    photo.type
  );
  if (!sanitized.ok)
    return fail("validation", { photo: [SANITIZE_MESSAGES[sanitized.reason]] });

  const imageId = deps.newId();
  const storagePath = roomImageStoragePath(roomId, imageId);
  const position =
    existing.data.reduce((max, row) => Math.max(max, row.position), -1) + 1;

  const admin = deps.adminClient();
  const bucket = admin.storage.from(ROOM_IMAGES_BUCKET);
  const upload = await bucket.upload(storagePath, sanitized.image.data, {
    contentType: ROOM_IMAGE_STORED_TYPE,
    upsert: false,
    // Ninguna caché debe guardar la foto más que lo que vale su URL firmada.
    cacheControl: String(deps.signedUrlTtlSeconds),
  });
  if (upload.error) {
    // El objeto pudo quedar guardado aunque la subida falle (ver arriba).
    deps.reportRecovery("room_image_upload_unconfirmed", storagePath);
    return fail("unknown");
  }

  const { data, error } = await admin
    .from("room_images")
    .insert({ id: imageId, room_id: roomId, storage_path: storagePath, position })
    .select(IMAGE_COLUMNS)
    .single();
  if (!error && data) return ok(await uploadedImage(data as ImageRow, roomId, deps));

  // El INSERT no ha confirmado la fila. Antes de tocar el objeto se comprueba
  // si existe (ver «Objetos huérfanos», arriba).
  const definitive = error !== null && isDefinitiveInsertRejection(error);
  const check = await checkInsertedImage(supabase, imageId, roomId, storagePath);
  if (check.kind === "present") {
    // La fila existe: el INSERT se confirmó aunque la respuesta se perdiera.
    return ok(await uploadedImage(check.row, roomId, deps));
  }
  if (check.kind === "unknown") {
    deps.reportRecovery("room_image_insert_unverified", storagePath);
    return definitive && error ? mapImageWriteError(error) : fail("unknown");
  }
  if (!definitive || !error) {
    // Sin un rechazo definitivo, el INSERT pudo seguir en curso y
    // confirmarse después: borrar el objeto podría dejar una fila sin foto.
    deps.reportRecovery("room_image_insert_unconfirmed", storagePath);
    return fail("unknown");
  }
  // Rechazo definitivo y fila ausente: el objeto no lo referenciará nadie.
  const removed = await bucket.remove([storagePath]);
  if (removed.error) deps.reportRecovery("room_image_orphan_after_insert", storagePath);
  return mapImageWriteError(error);
}

/**
 * Borra una foto de una habitación propia: primero la fila, después el
 * objeto. Con la cuenta desactivada no se puede (como el resto de
 * escrituras de la 4.0). Con la habitación retirada o eliminada sí: no se
 * añaden ni reordenan fotos, pero quitar las que tiene es limpieza (el
 * trigger tampoco lo impide).
 */
export async function deleteRoomImage(
  supabase: DbClient,
  imageId: unknown,
  deps: RoomImagesDeps = DEFAULT_DEPS
): Promise<ServiceResult<true>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const parsed = uuidSchema.safeParse(imageId);
  if (!parsed.success)
    return fail("validation", { imageId: ["Identificador no válido"] });

  const account = await requireActiveAccount(supabase, userId);
  if (!account.ok) return account;

  // La foto se lee con el cliente del usuario; si es de una habitación
  // pública ajena también se ve, así que se comprueba la propiedad aparte.
  const { data: image, error } = await supabase
    .from("room_images")
    .select("id, room_id, storage_path")
    .eq("id", parsed.data)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!image) return fail("not_found");
  const room = await readOwnRoom(supabase, userId, image.room_id);
  if (!room.ok) return room;

  const admin = deps.adminClient();
  const { data: deleted, error: deleteError } = await admin
    .from("room_images")
    .delete()
    .eq("id", image.id)
    .eq("room_id", image.room_id)
    .select("id")
    .maybeSingle();
  if (deleteError) return mapImageWriteError(deleteError);
  if (!deleted) return fail("not_found");

  // Defensa en profundidad: solo se borra la ruta canónica de esa fila
  // (`chk_room_images_storage_path` ya lo garantiza), nunca otro objeto.
  if (image.storage_path !== roomImageStoragePath(image.room_id, image.id)) {
    deps.reportRecovery("room_image_orphan_after_delete", image.storage_path);
    return ok(true);
  }
  const removed = await admin.storage
    .from(ROOM_IMAGES_BUCKET)
    .remove([image.storage_path]);
  if (removed.error)
    deps.reportRecovery("room_image_orphan_after_delete", image.storage_path);
  return ok(true);
}

/** Resultado de la limpieza de los objetos de una habitación borrada. */
export type RoomObjectsCleanup = {
  /**
   * `true` solo si se ha comprobado, después de borrar, que no queda ningún
   * objeto de la habitación en el bucket. Si no, los que queden son huérfanos
   * (sin fila que los firme) y se han avisado para la conciliación.
   */
  complete: boolean;
};

/** Nombre de un objeto que pudo escribir este servicio: `<uuid>.webp`, en minúsculas. */
const CANONICAL_OBJECT_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** Objetos de una carpeta por listado: como mucho 8 fotos más los huérfanos. */
const ROOM_OBJECTS_LIST_LIMIT = 100;

type Bucket = ReturnType<DbClient["storage"]["from"]>;

/**
 * Nombres de los objetos de la carpeta `roomId/` (sin la carpeta), o `null`
 * si no se pueden listar. Incluye cualquier nombre, también los que no son
 * canónicos o las subcarpetas.
 */
async function listRoomObjects(bucket: Bucket, roomId: string): Promise<string[] | null> {
  try {
    const { data, error } = await bucket.list(roomId, {
      limit: ROOM_OBJECTS_LIST_LIMIT,
    });
    if (error || !Array.isArray(data)) return null;
    return data
      .map((item) => (item && typeof item.name === "string" ? item.name : null))
      .filter((name): name is string => name !== null && name.length > 0);
  } catch {
    return null;
  }
}

/**
 * Borra del bucket los objetos de una habitación **ya borrada** (borrado de
 * habitaciones, lib/services/rooms.ts). Es la única operación de Storage que
 * no parte de una fila de `room_images`: cuando se llama, la fila de la
 * habitación ya no existe y la cascada se ha llevado las de sus fotos.
 *
 *   1. Con service_role se comprueba que la habitación no existe (solo su id).
 *      Si existe, o no se puede comprobar, no se borra nada: sus objetos
 *      siguen siendo de una habitación viva. Esta comprobación es la que
 *      impide usar la función para borrar las fotos de otra persona.
 *   2. Se borran las rutas canónicas `roomId/<id>.webp` de las fotos que el
 *      servidor leyó antes de borrar la habitación (`imageIds`) y las que
 *      aparecen al listar la carpeta `roomId/` (huérfanos de subidas
 *      ambiguas o fotos añadidas mientras tanto). Las rutas las construye el
 *      servidor con `roomImageStoragePath`, nunca llegan del navegador, y
 *      un nombre que no es canónico no se borra.
 *   3. Se vuelve a listar la carpeta: solo si está vacía la limpieza es
 *      completa. Lo que quede se avisa (`room_image_orphan_after_room_delete`)
 *      y lo detecta la conciliación (tests/supabase/room-images-reconcile.sql).
 *
 * Una subida en curso para la habitación borrada falla en el INSERT (sin
 * habitación, la FK lo rechaza de forma definitiva) y borra su objeto (M2).
 * Carrera residual, documentada: `id` está en el GRANT de INSERT de `rooms`,
 * así que alguien podría crear una habitación nueva con el mismo id justo
 * entre la comprobación del paso 1 y el borrado del paso 2, y subirle una
 * foto en ese instante. Solo se perdería el objeto de esa foto nueva, de
 * quien reutiliza el id; nunca el de otra habitación, porque la carpeta es la
 * del id.
 */
export async function removeDeletedRoomObjects(
  roomId: unknown,
  imageIds: readonly unknown[],
  deps: RoomImagesDeps = DEFAULT_DEPS
): Promise<RoomObjectsCleanup> {
  const parsed = uuidSchema.safeParse(roomId);
  if (!parsed.success) return { complete: false };
  const id = parsed.data;
  const folder = `${id}/`;

  const admin = deps.adminClient();
  const { data: stillThere, error } = await admin
    .from("rooms")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error || stillThere) {
    deps.reportRecovery("room_objects_cleanup_skipped", folder);
    return { complete: false };
  }

  const bucket = admin.storage.from(ROOM_IMAGES_BUCKET);
  const known = imageIds
    .map((imageId) => uuidSchema.safeParse(imageId))
    .filter((result) => result.success)
    .map((result) => roomImageStoragePath(id, result.data));
  const listed = (await listRoomObjects(bucket, id)) ?? [];
  const paths = [
    ...new Set([
      ...known,
      ...listed
        .filter((name) => CANONICAL_OBJECT_NAME.test(name))
        .map((name) => `${folder}${name}`),
    ]),
  ];
  if (paths.length > 0) {
    try {
      // Si falla, la comprobación de abajo lo dirá: no hace falta su resultado.
      await bucket.remove(paths);
    } catch {
      // Igual: se comprueba listando.
    }
  }

  const remaining = await listRoomObjects(bucket, id);
  if (remaining === null) {
    deps.reportRecovery("room_objects_unverified", folder);
    return { complete: false };
  }
  for (const name of remaining) {
    deps.reportRecovery("room_image_orphan_after_room_delete", `${folder}${name}`);
  }
  return { complete: remaining.length === 0 };
}
