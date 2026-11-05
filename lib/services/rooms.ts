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
  type DbError,
  type DbFieldRule,
  type FieldErrors,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";
import { FORM_ERROR_KEY, toFieldErrors, uuidSchema } from "@/lib/validation/common";
import { ROOM_IMAGE_MAX_COUNT } from "@/lib/validation/room-images";
import {
  ROOM_PUBLICATION_MESSAGES,
  type RoomPublicationField,
  missingPublicationFields,
  roomCreateSchema,
  roomStatusChangeSchema,
  roomUpdateSchema,
} from "@/lib/validation/rooms";

/**
 * Habitaciones: la gestión de las fotos y el borrado seguro de una habitación
 * propia (Fase 4.2), y el CRUD de la propietaria (Fase 4, sesión 68: crear,
 * listar, editar y cambiar el estado; ver abajo). Las lecturas y
 * comprobaciones, siempre con el cliente del usuario (RLS).
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

// ------------------------------------------------------------------
// CRUD de la propietaria (Fase 4, sesión 68)
// ------------------------------------------------------------------
//
// Crear, listar, leer para editar, editar y cambiar el estado de las
// habitaciones propias. Todo con el cliente del usuario (RLS y GRANT de
// `authenticated`), nunca con service_role: D17 no cambia y el cliente admin
// de este archivo sigue siendo solo para `delete_own_room`.
//   - El id del usuario sale siempre de la sesión; la cuenta activa se
//     comprueba antes de escribir (y la RLS de la 4.0 lo vuelve a exigir).
//   - INSERT y UPDATE por separado, nunca `upsert` (reescribiría `id` y
//     `owner_id`, que no están en el UPDATE del GRANT).
//   - Solo se escriben las columnas del formulario (`ROOM_WRITABLE_COLUMNS`),
//     más `owner_id` al crear. Nunca `status` al crear (nace `draft`),
//     `deleted_at`, `approx_*` ni las fechas.
//   - Ubicación: solo ciudad y barrio (R2). `room_addresses` no se lee ni se
//     escribe desde la aplicación.
//   - El estado sigue R7 (opción A) y H5: la propietaria se mueve entre
//     `draft`, `active`, `paused` y `rented`; a `active` solo completa
//     (`chk_rooms_publishable`); `removed` no lo pone ni lo quita.
//   - Una habitación retirada (`removed`) no se edita desde aquí, aunque la
//     base de datos solo bloquee su estado (límite de moderación de la
//     Fase 7). Una con `deleted_at` (borrado lógico del servidor) no aparece.

/** Columnas de una habitación propia que lee el CRUD. Nunca `approx_*`. */
const OWN_ROOM_COLUMNS =
  "id, owner_id, title, description, city_id, neighborhood_id, price_month, expenses_included, deposit_amount, available_from, min_stay_months, max_stay_months, total_roommates, total_rooms, features, pets_allowed, smoking_allowed, students_only, house_rules, roommate_preferences, status, deleted_at, created_at, updated_at" as const;

type OwnRoomRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  city_id: string;
  neighborhood_id: string | null;
  price_month: number;
  expenses_included: boolean;
  deposit_amount: number | null;
  available_from: string;
  min_stay_months: number | null;
  max_stay_months: number | null;
  total_roommates: number | null;
  total_rooms: number | null;
  features: string[];
  pets_allowed: boolean;
  smoking_allowed: boolean;
  students_only: boolean;
  house_rules: string | null;
  roommate_preferences: string | null;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Una habitación propia, para editarla (sin `owner_id` ni `deleted_at`). */
export type OwnRoom = Omit<OwnRoomRow, "owner_id" | "deleted_at">;

const toOwnRoom = (row: OwnRoomRow): OwnRoom => {
  const { owner_id: _owner, deleted_at: _deleted, ...room } = row;
  void _owner;
  void _deleted;
  return room;
};

const OWN_ROOM_LIST_COLUMNS =
  "id, owner_id, title, status, city_id, neighborhood_id, price_month, available_from, total_roommates, total_rooms, deleted_at, created_at, updated_at" as const;

type OwnRoomListRow = Pick<
  OwnRoomRow,
  | "id"
  | "owner_id"
  | "title"
  | "status"
  | "city_id"
  | "neighborhood_id"
  | "price_month"
  | "available_from"
  | "total_roommates"
  | "total_rooms"
  | "deleted_at"
  | "created_at"
  | "updated_at"
>;

/** Una habitación del listado propio, con lo que le falta para publicarse. */
export type OwnRoomListItem = {
  id: string;
  title: string;
  status: string;
  city_id: string;
  neighborhood_id: string | null;
  price_month: number;
  available_from: string;
  missingForPublication: RoomPublicationField[];
};

/**
 * Errores de la base de datos que tienen un campo del formulario. Se buscan
 * por SQLSTATE y por el nombre de la restricción, que nunca se devuelve.
 */
const ROOM_DB_RULES: DbFieldRule[] = [
  {
    code: "23514",
    match: "chk_price_positive",
    field: "price_month",
    message: "El precio tiene que ser mayor que 0",
  },
  {
    code: "23514",
    match: "chk_deposit_nonneg",
    field: "deposit_amount",
    message: "El depósito no puede ser negativo",
  },
  {
    code: "23514",
    match: "chk_stay_range",
    field: "max_stay_months",
    message: "La estancia máxima no puede ser menor que la mínima",
  },
  {
    code: "23514",
    match: "chk_rooms_total_roommates",
    field: "total_roommates",
    message: "No puede ser negativo",
  },
  {
    code: "23514",
    match: "chk_rooms_total_rooms",
    field: "total_rooms",
    message: "La vivienda tiene que tener al menos un dormitorio",
  },
  {
    code: "23514",
    match: "chk_rooms_features",
    field: "features",
    message: "Alguna característica no es válida",
  },
  {
    code: "23514",
    match: "chk_rooms_publishable",
    field: FORM_ERROR_KEY,
    message:
      "Una habitación publicada necesita barrio, número de compañeros y número de dormitorios.",
  },
  {
    code: "23503",
    match: "fk_rooms_neighborhood_city",
    field: "neighborhood_id",
    message: "El barrio no pertenece a la ciudad elegida",
  },
  {
    code: "23503",
    match: "rooms_neighborhood_id_fkey",
    field: "neighborhood_id",
    message: "El barrio no existe",
  },
  {
    code: "23503",
    match: "rooms_city_id_fkey",
    field: "city_id",
    message: "La ciudad no existe",
  },
];

const mapRoomWriteError = (error: DbError) => mapDbError(error, ROOM_DB_RULES);

const CITY_NOT_AVAILABLE = "Esta ciudad todavía no está disponible";
const ROOM_REMOVED_LOCKED = "removed";

/**
 * Una ciudad nueva (distinta de la guardada) tiene que estar activa: el
 * rollout ciudad a ciudad, como en las preferencias. Una ya guardada que
 * después se desactivó se conserva. Una inexistente la rechaza la FK.
 */
async function checkCity(
  supabase: DbClient,
  cityId: string,
  currentCityId: string | null
): Promise<ServiceResult<true>> {
  if (cityId === currentCityId) return ok(true);
  const { data: city, error } = await supabase
    .from("cities")
    .select("id, is_active")
    .eq("id", cityId)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!city) return fail("validation", { city_id: ["La ciudad no existe"] });
  if (!city.is_active) return fail("validation", { city_id: [CITY_NOT_AVAILABLE] });
  return ok(true);
}

/** Habitación propia y sin borrado lógico, con todas las columnas del CRUD. */
async function readOwnRoomForCrud(
  supabase: DbClient,
  userId: string,
  roomId: string
): Promise<ServiceResult<OwnRoomRow>> {
  const { data, error } = await supabase
    .from("rooms")
    .select(OWN_ROOM_COLUMNS)
    .eq("id", roomId)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return mapDbError(error);
  const row = data as OwnRoomRow | null;
  if (!row || row.owner_id !== userId || row.deleted_at !== null)
    return fail("not_found");
  return ok(row);
}

/** Errores de campo de lo que le falta a una habitación para estar publicada. */
function publicationErrors(missingFields: RoomPublicationField[]): FieldErrors {
  return Object.fromEntries(
    missingFields.map((field) => [field, [ROOM_PUBLICATION_MESSAGES[field]]])
  );
}

/** Listado de las habitaciones propias (más recientes primero), en una sola consulta. */
export async function listOwnRooms(
  supabase: DbClient
): Promise<ServiceResult<OwnRoomListItem[]>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const account = await requireActiveAccount(supabase, userId);
  if (!account.ok) return account;

  const { data, error } = await supabase
    .from("rooms")
    .select(OWN_ROOM_LIST_COLUMNS)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return mapDbError(error);
  const rows = (data ?? []) as OwnRoomListRow[];
  return ok(
    rows
      .filter((row) => row.owner_id === userId && row.deleted_at === null)
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        city_id: row.city_id,
        neighborhood_id: row.neighborhood_id,
        price_month: row.price_month,
        available_from: row.available_from,
        missingForPublication: missingPublicationFields(row),
      }))
  );
}

/**
 * Una habitación propia para editarla. A cualquier otra persona, también a
 * un admin, `not_found`: es la gestión de la propietaria, no la moderación.
 */
export async function getOwnRoomForEdit(
  supabase: DbClient,
  roomId: unknown
): Promise<ServiceResult<OwnRoom>> {
  const started = await start(supabase, roomId);
  if (!started.ok) return started;
  const room = await readOwnRoomForCrud(
    supabase,
    started.data.userId,
    started.data.roomId
  );
  if (!room.ok) return room;
  return ok(toOwnRoom(room.data));
}

/** Crea una habitación propia en borrador (`status` lo pone la base de datos). */
export async function createOwnRoom(
  supabase: DbClient,
  input: unknown
): Promise<ServiceResult<OwnRoom>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const parsed = roomCreateSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));
  const fields = parsed.data;

  const account = await requireActiveAccount(supabase, userId);
  if (!account.ok) return account;
  const city = await checkCity(supabase, fields.city_id, null);
  if (!city.ok) return city;

  const { data, error } = await supabase
    .from("rooms")
    .insert({ ...fields, owner_id: userId })
    .select(OWN_ROOM_COLUMNS)
    .single();
  if (error) return mapRoomWriteError(error);
  return ok(toOwnRoom(data as OwnRoomRow));
}

/**
 * Edita una habitación propia (no su estado). Si está publicada, tiene que
 * seguir completa: se comprueba antes de escribir, con errores de campo, y
 * `chk_rooms_publishable` lo vuelve a exigir.
 */
export async function updateOwnRoom(
  supabase: DbClient,
  roomId: unknown,
  input: unknown
): Promise<ServiceResult<OwnRoom>> {
  const started = await start(supabase, roomId);
  if (!started.ok) return started;
  const { userId } = started.data;

  const parsed = roomUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));
  const fields = parsed.data;

  const current = await readOwnRoomForCrud(supabase, userId, started.data.roomId);
  if (!current.ok) return current;
  if (current.data.status === ROOM_REMOVED_LOCKED) return fail("forbidden");

  if (current.data.status === "active") {
    const missingFields = missingPublicationFields({ ...current.data, ...fields });
    if (missingFields.length > 0)
      return fail("validation", publicationErrors(missingFields));
  }
  const city = await checkCity(supabase, fields.city_id, current.data.city_id);
  if (!city.ok) return city;

  const { data, error } = await supabase
    .from("rooms")
    .update(fields)
    .eq("id", current.data.id)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .select(OWN_ROOM_COLUMNS)
    .maybeSingle();
  if (error) return mapRoomWriteError(error);
  // Sin fila: ya no es suya, se borró o la cuenta se desactivó entretanto (RLS).
  if (!data) return fail("not_found");
  return ok(toOwnRoom(data as OwnRoomRow));
}

/**
 * Cambia el estado de una habitación propia (R7, opción A): entre `draft`,
 * `active`, `paused` y `rented`; a `active` solo completa. Una habitación
 * retirada no cambia de estado desde aquí (H5 también lo impide).
 */
export async function changeOwnRoomStatus(
  supabase: DbClient,
  input: unknown
): Promise<ServiceResult<OwnRoom>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const parsed = roomStatusChangeSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));
  const { roomId, status } = parsed.data;

  const started = await start(supabase, roomId);
  if (!started.ok) return started;
  const current = await readOwnRoomForCrud(supabase, userId, started.data.roomId);
  if (!current.ok) return current;
  if (current.data.status === ROOM_REMOVED_LOCKED) return fail("forbidden");
  if (current.data.status === status) return ok(toOwnRoom(current.data));

  if (status === "active") {
    const missingFields = missingPublicationFields(current.data);
    if (missingFields.length > 0)
      return fail("validation", publicationErrors(missingFields));
  }

  const { data, error } = await supabase
    .from("rooms")
    .update({ status })
    .eq("id", current.data.id)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .select(OWN_ROOM_COLUMNS)
    .maybeSingle();
  // 42501 (H5, `room_moderation:`, o la RLS) → forbidden; el CHECK de publicación → error general.
  if (error) return mapRoomWriteError(error);
  if (!data) return fail("not_found");
  return ok(toOwnRoom(data as OwnRoomRow));
}
