import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
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
 * habitación propia. Las lecturas y comprobaciones, siempre con el cliente del
 * usuario (RLS).
 *
 * service_role (D17, ampliada por el propietario el 2026-10-30, sesión 65):
 * este es el cuarto servicio que lo usa, y solo para una cosa, llamar a
 * `delete_own_room` (20261030120000) desde `deleteOwnRoom`, después de
 * comprobar la sesión, la cuenta activa y la propiedad con el cliente del
 * usuario. Ningún cliente tiene DELETE sobre `rooms` ni EXECUTE de la
 * función; la función vuelve a exigir propietaria y cuenta activa en la misma
 * transacción. Storage (borrar objetos, firmar URL) sigue en
 * lib/services/room-images.ts. tests/unit/admin-client-usage.test.ts fija que
 * aquí el cliente admin solo hace esa llamada.
 *
 * Borrado de una habitación (`deleteOwnRoom`). No puede ser atómico: la fila
 * está en PostgreSQL y los objetos en Storage. Orden:
 *   1. el id del usuario, de la sesión (`auth.getUser()`), nunca del
 *      navegador; la cuenta activa y la propiedad, con el cliente del usuario,
 *      antes de crear el cliente privilegiado;
 *   2. `delete_own_room(p_room_id, p_user_id)` con service_role: bloquea la
 *      habitación, comprueba otra vez propietaria y cuenta, lee las rutas de
 *      sus fotos de las filas reales, comprueba que son canónicas y la borra
 *      (la cascada se lleva sus fotos, su dirección y sus favoritos). Devuelve
 *      esas rutas. Desde aquí nadie puede ver ni firmar esas fotos;
 *   3. `removeDeletedRoomObjects` borra solo esas rutas y comprueba que la
 *      carpeta queda vacía.
 * Un fallo en el paso 3 solo deja objetos huérfanos e inaccesibles (bucket
 * privado, sin filas): el resultado lo dice (`photosRemoved: false`), se avisa
 * por ruta y los detecta la conciliación. Ante un resultado ambiguo del
 * paso 2 no se borra ningún objeto: si la habitación sigue, es un error; si ya
 * no está, quedó borrada pero sus rutas se perdieron con la respuesta, y la
 * limpieza queda pendiente (`room_delete_paths_unknown`, conciliación).
 *
 * Fuera de este servicio, y documentado (docs/SECURITY.md, «Borrado de
 * habitaciones»): la cascada desde `profiles` (borrar la cuenta en Auth o un
 * perfil) borra habitaciones sin limpiar Storage. ROOMLY no tiene flujo de
 * borrado de cuenta (H6).
 */

/**
 * Avisos de recuperación del borrado de una habitación (solo el evento y el
 * id de la habitación):
 *   - room_delete_unconfirmed: la llamada dio un resultado ambiguo y no se
 *     pudo comprobar si la habitación sigue; no se ha borrado ningún objeto;
 *   - room_delete_paths_unknown: la habitación se borró, pero no se conocen
 *     las rutas de sus fotos (respuesta perdida o mal formada); no se ha
 *     borrado ningún objeto;
 *   - room_delete_path_invalid: la base de datos se negó a borrar porque una
 *     foto tiene una ruta no canónica (no debería pasar: lo impide un CHECK);
 *     no se ha borrado nada.
 */
export type RoomRecoveryEvent =
  "room_delete_unconfirmed" | "room_delete_paths_unknown" | "room_delete_path_invalid";

export type RoomsDeps = {
  /** Cliente con service_role, solo para `delete_own_room`. Se inyecta en los tests. */
  adminClient: () => DbClient;
  removeRoomObjects: (
    roomId: string,
    storagePaths: readonly string[]
  ) => Promise<RoomObjectsCleanup>;
  reportRecovery: (event: RoomRecoveryEvent, roomId: string) => void;
};

const DEFAULT_DEPS: RoomsDeps = {
  adminClient: () => createAdminClient(),
  removeRoomObjects: (roomId, storagePaths) =>
    removeDeletedRoomObjects(roomId, storagePaths),
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

/** ¿Sigue la habitación? Tras un borrado ambiguo; `null` si no se puede saber. */
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

/**
 * Rechazos definitivos de `delete_own_room` (la transacción se ha deshecho:
 * no se ha borrado nada), por su SQLSTATE y su prefijo, nunca por el resto
 * del mensaje, que no se devuelve.
 */
function mapDeleteRejection(
  error: { code?: string; message?: string },
  roomId: string,
  deps: RoomsDeps
): ServiceResult<never> {
  const raw: unknown = error.message;
  const message = typeof raw === "string" ? raw : "";
  if (error.code === "P0002" && message.startsWith("room_not_found:"))
    return fail("not_found");
  if (error.code === "42501" && message.startsWith("account_deleted:"))
    return fail("deleted");
  // interests, matches o reports la referencian sin cascada.
  if (error.code === "23503") return fail("conflict");
  if (error.code === "23514" && message.startsWith("room_delete_path_invalid:")) {
    deps.reportRecovery("room_delete_path_invalid", roomId);
  }
  return fail("unknown");
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

  const { data, error } = await deps
    .adminClient()
    .rpc("delete_own_room", { p_room_id: id, p_user_id: userId });
  if (error) {
    if (isDefinitiveInsertRejection(error)) return mapDeleteRejection(error, id, deps);
    // Ambiguo: la transacción pudo confirmarse. Solo se sabe mirando.
    const exists = await roomStillExists(supabase, userId, id);
    if (exists === null) {
      deps.reportRecovery("room_delete_unconfirmed", id);
      return fail("unknown");
    }
    if (exists) return fail("unknown");
    // Borrada, pero sin las rutas: la limpieza queda para la conciliación.
    deps.reportRecovery("room_delete_paths_unknown", id);
    return ok({ photosRemoved: false });
  }

  // La transacción se confirmó: la habitación ya no existe.
  const paths: unknown = data;
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
    deps.reportRecovery("room_delete_paths_unknown", id);
    return ok({ photosRemoved: false });
  }
  const cleanup = await deps.removeRoomObjects(id, paths);
  return ok({ photosRemoved: cleanup.complete });
}
