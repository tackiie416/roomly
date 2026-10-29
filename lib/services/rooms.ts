import "server-only";

import { isActiveAdmin } from "@/lib/services/profile";
import {
  isDefinitiveInsertRejection,
  listOwnRoomImages,
  listRoomImages,
  removeDeletedRoomObjects,
  type RoomImage,
  type RoomObjectsCleanup,
} from "@/lib/services/room-images";
import {
  type DbClient,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";
import { uuidSchema } from "@/lib/validation/common";
import { ROOM_IMAGE_MAX_COUNT } from "@/lib/validation/room-images";

/**
 * Habitaciones (Fase 4.2): la gestión de las fotos y el borrado seguro de una
 * habitación propia. Todo con el cliente del usuario (RLS): este servicio no
 * usa service_role. Lo que necesita service_role (borrar objetos de Storage y
 * firmar URL) lo hace lib/services/room-images.ts, el tercer servicio de D17.
 *
 * Borrado de una habitación (`deleteOwnRoom`). No puede ser atómico: la fila
 * está en PostgreSQL y los objetos en Storage. Orden elegido, el más seguro:
 *   1. comprobar sesión, cuenta activa y propiedad, antes de cambiar nada;
 *   2. leer sus fotos con el cliente del usuario (las rutas no llegan del
 *      navegador);
 *   3. borrar la fila con el cliente del usuario (`rooms_delete_own`: solo la
 *      propietaria con la cuenta activa). La cascada se lleva las filas de
 *      `room_images` y `room_addresses`. Desde aquí nadie puede ver ni firmar
 *      esas fotos: no hay filas que leer;
 *   4. borrar sus objetos (`removeDeletedRoomObjects`), que comprueba con
 *      service_role que la habitación ya no existe y, al final, que no queda
 *      nada en su carpeta.
 * Al revés (objetos primero), un fallo de la base de datos dejaría una
 * habitación visible con filas que apuntan a objetos borrados. Así, un fallo
 * en el paso 4 solo deja objetos huérfanos e inaccesibles (bucket privado, sin
 * filas): el resultado lo dice (`photosRemoved: false`), se avisa por ruta y
 * los detecta la conciliación. Ante un resultado ambiguo del DELETE no se
 * borra ningún objeto hasta saber si la fila sigue ahí.
 *
 * Fuera del alcance de este servicio, y documentado: el DELETE directo de
 * `rooms` por PostgREST (la propietaria con su sesión, por `rooms_delete_own`,
 * o un admin, por `rooms_admin_all`) y la cascada desde `profiles` siguen
 * existiendo y no limpian Storage. Cerrarlos exige una migración y una
 * decisión del propietario (docs/SECURITY.md, «Borrado de habitaciones»).
 */

/**
 * Aviso de recuperación del borrado de una habitación (solo el evento y el
 * id): room_delete_unconfirmed, el DELETE dio un resultado ambiguo y no se
 * pudo comprobar si la habitación sigue; no se ha borrado ningún objeto.
 */
export type RoomRecoveryEvent = "room_delete_unconfirmed";

export type RoomsDeps = {
  removeRoomObjects: (
    roomId: string,
    imageIds: readonly string[]
  ) => Promise<RoomObjectsCleanup>;
  reportRecovery: (event: RoomRecoveryEvent, roomId: string) => void;
};

const DEFAULT_DEPS: RoomsDeps = {
  removeRoomObjects: (roomId, imageIds) => removeDeletedRoomObjects(roomId, imageIds),
  reportRecovery: (event, roomId) => {
    console.warn(`[rooms] ${event}: ${roomId}`);
  },
};

type RoomRow = {
  id: string;
  owner_id: string;
  title: string;
  status: string;
  deleted_at: string | null;
};

const ROOM_COLUMNS = "id, owner_id, title, status, deleted_at" as const;

export type RoomSummary = { id: string; title: string; status: string };

const summary = (row: RoomRow): RoomSummary => ({
  id: row.id,
  title: row.title,
  status: row.status,
});

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

/** Habitación propia (filtrando por `owner_id`), o `not_found`. */
async function readOwnRoom(
  supabase: DbClient,
  userId: string,
  roomId: string
): Promise<ServiceResult<RoomRow>> {
  const { data, error } = await supabase
    .from("rooms")
    .select(ROOM_COLUMNS)
    .eq("id", roomId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  const row = data as RoomRow | null;
  if (!row || row.owner_id !== userId) return fail("not_found");
  return ok(row);
}

/** Sesión, id válido y cuenta activa: lo común a todas las operaciones. */
async function start(
  supabase: DbClient,
  roomId: unknown
): Promise<ServiceResult<{ userId: string; roomId: string }>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const parsed = uuidSchema.safeParse(roomId);
  if (!parsed.success) return fail("not_found");
  const account = await requireActiveAccount(supabase, userId);
  if (!account.ok) return account;
  return ok({ userId, roomId: parsed.data });
}

export type RoomPhotosView = {
  room: RoomSummary;
  /** Propietaria (gestiona) o admin activo (solo mira). */
  access: "owner" | "admin";
  /** Puede añadir fotos: propietaria, habitación ni retirada ni eliminada, menos de 8. */
  canUpload: boolean;
  /** Puede quitar fotos: la propietaria (también de una habitación retirada). */
  canDelete: boolean;
  /** Fotos con URL firmadas, o `null` si no se han podido cargar. */
  images: RoomImage[] | null;
  maxImages: number;
};

/**
 * Página de fotos de una habitación (`/habitaciones/[id]/fotos`): la
 * propietaria con la cuenta activa la gestiona; un admin activo solo la mira.
 * A cualquier otra persona, aunque la habitación sea pública, `not_found`:
 * es una página de gestión, no la ficha pública.
 */
export async function getRoomPhotos(
  supabase: DbClient,
  roomId: unknown
): Promise<ServiceResult<RoomPhotosView>> {
  const started = await start(supabase, roomId);
  if (!started.ok) return started;
  const { userId } = started.data;

  const { data, error } = await supabase
    .from("rooms")
    .select(ROOM_COLUMNS)
    .eq("id", started.data.roomId)
    .maybeSingle();
  if (error) return mapDbError(error);
  const row = data as RoomRow | null;
  if (!row) return fail("not_found");

  let access: RoomPhotosView["access"];
  if (row.owner_id === userId) {
    access = "owner";
  } else {
    const admin = await isActiveAdmin(supabase);
    if (!admin.ok) return admin;
    if (!admin.data) return fail("not_found");
    access = "admin";
  }

  const listed =
    access === "owner"
      ? await listOwnRoomImages(supabase, row.id)
      : await listRoomImages(supabase, row.id);
  if (!listed.ok && listed.error !== "unknown") return listed;
  const images = listed.ok ? listed.data : null;

  const writable = row.deleted_at === null && row.status !== "removed";
  return ok({
    room: summary(row),
    access,
    canUpload:
      access === "owner" &&
      writable &&
      images !== null &&
      images.length < ROOM_IMAGE_MAX_COUNT,
    canDelete: access === "owner",
    images,
    maxImages: ROOM_IMAGE_MAX_COUNT,
  });
}

export type RoomDeletionPreview = { room: RoomSummary; photoCount: number };

/** Confirmación del borrado (`/habitaciones/[id]/borrar`): solo la propietaria. */
export async function getOwnRoomForDeletion(
  supabase: DbClient,
  roomId: unknown
): Promise<ServiceResult<RoomDeletionPreview>> {
  const started = await start(supabase, roomId);
  if (!started.ok) return started;
  const room = await readOwnRoom(supabase, started.data.userId, started.data.roomId);
  if (!room.ok) return room;

  const { data, error } = await supabase
    .from("room_images")
    .select("id")
    .eq("room_id", room.data.id);
  if (error) return mapDbError(error);
  return ok({ room: summary(room.data), photoCount: (data ?? []).length });
}

export type RoomDeletion = {
  /**
   * `true` solo si se ha comprobado que no queda ningún objeto de sus fotos.
   * Si es `false`, la habitación está borrada, pero quedan objetos pendientes
   * de limpieza (huérfanos e inaccesibles), avisados para la conciliación.
   */
  photosRemoved: boolean;
};

/** ¿Sigue la habitación? Tras un DELETE ambiguo; `null` si no se puede saber. */
async function roomStillExists(
  supabase: DbClient,
  userId: string,
  roomId: string
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", roomId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) return null;
  return data !== null;
}

/** Borra una habitación propia y después los objetos de sus fotos (ver arriba). */
export async function deleteOwnRoom(
  supabase: DbClient,
  roomId: unknown,
  deps: RoomsDeps = DEFAULT_DEPS
): Promise<ServiceResult<RoomDeletion>> {
  const started = await start(supabase, roomId);
  if (!started.ok) return started;
  const { userId } = started.data;
  const room = await readOwnRoom(supabase, userId, started.data.roomId);
  if (!room.ok) return room;
  const id = room.data.id;

  const { data: images, error: imagesError } = await supabase
    .from("room_images")
    .select("id")
    .eq("room_id", id);
  if (imagesError) return mapDbError(imagesError);
  const imageIds = ((images ?? []) as Array<{ id: string }>).map((image) => image.id);

  const { data: deleted, error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", id)
    .eq("owner_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    // Rechazo definitivo (la transacción se ha deshecho): nada ha cambiado.
    // Las mismas clases SQLSTATE que para el INSERT de una foto (M2).
    if (isDefinitiveInsertRejection(error)) return mapDbError(error);
    // Ambiguo: solo se sigue si se comprueba que la habitación ya no está.
    const exists = await roomStillExists(supabase, userId, id);
    if (exists === null) {
      deps.reportRecovery("room_delete_unconfirmed", id);
      return fail("unknown");
    }
    if (exists) return fail("unknown");
  } else if (!deleted) {
    // La RLS no ha dejado borrar ninguna fila (por ejemplo, la cuenta se
    // desactivó entre la comprobación y el DELETE) o ya no estaba.
    return fail("not_found");
  }

  const cleanup = await deps.removeRoomObjects(id, imageIds);
  return ok({ photosRemoved: cleanup.complete });
}
