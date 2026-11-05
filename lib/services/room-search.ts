import "server-only";

import {
  type DbClient,
  type FieldErrors,
  type ServiceResult,
  fail,
  mapDbError,
  ok,
} from "@/lib/services/result";
import {
  type RoomCover,
  type RoomImage,
  type RoomImagesDeps,
  listRoomCovers,
  listRoomImages,
} from "@/lib/services/room-images";
import { uuidSchema } from "@/lib/validation/common";
import {
  ROOM_SEARCH_ORDER_COLUMNS,
  ROOM_SEARCH_PAGE_SIZE,
  type RawSearchParams,
  type RoomSearchCursor,
  type RoomSearchFilters,
  encodeRoomSearchCursor,
  parseRoomSearchParams,
} from "@/lib/validation/room-search";
import { ROOM_FEATURES, type RoomFeatureKey } from "@/lib/validation/rooms";

/**
 * Búsqueda pública y detalle de habitaciones (Fase 4.4, R3 y R4, sesión 71).
 *
 * Cliente: el que recibe, que en las páginas públicas es SIEMPRE el de un
 * visitante sin sesión (`createPublicClient`, lib/supabase/public.ts), también
 * si hay una sesión. Así la visibilidad pública la decide la base de datos
 * para todo el mundo, propietaria y admin incluidos:
 *   - las filas, la RLS de R7 (`rooms_select_active_public`: habitación
 *     activa, sin borrado lógico, de una cuenta activa);
 *   - las columnas, el GRANT de anon (20261031120100): las 20 públicas. Un
 *     error de este servicio que pidiera otra (owner_id, status...) fallaría
 *     con 42501 en vez de devolverla.
 * Este servicio nunca usa service_role para leer: solo `room-images.ts` firma
 * las URL de las fotos que este mismo cliente acaba de leer.
 *
 * Lista blanca: las filas se convierten campo a campo en `PublicRoomCard` y
 * `PublicRoomDetail`. Ni identidad de la propietaria ni `owner_id`, ni
 * coordenadas, ni `room_addresses` (no se consulta), ni estado, borrado
 * lógico o fechas internas. La ubicación es solo barrio y ciudad (R2).
 *
 * Los textos libres (descripción, normas, preferencias) se muestran tal cual
 * los escribió la propietaria: nada garantiza que no incluyan una dirección o
 * un teléfono. El formulario de publicación avisa de no ponerlos.
 *
 * Peticiones, constantes con 1 o con 20 resultados (sin N+1):
 *   - búsqueda: ciudad, barrios de la ciudad, habitaciones (hasta 21) y, si
 *     hay resultados, una lectura de fotos y una sola petición de firma;
 *   - detalle: ciudad, habitación, barrio y `listRoomImages` (habitación,
 *     fotos y una petición de firma).
 */

/** Columnas de `rooms` de las tarjetas, el orden y el cursor (todas en el GRANT de anon). */
export const PUBLIC_ROOM_CARD_SELECT =
  "id, title, neighborhood_id, price_month, expenses_included, available_from, total_rooms, total_roommates, published_at" as const;

/** Columnas de `rooms` del detalle (todas en el GRANT de anon). */
export const PUBLIC_ROOM_DETAIL_SELECT =
  "id, title, description, neighborhood_id, price_month, expenses_included, deposit_amount, available_from, min_stay_months, max_stay_months, total_roommates, total_rooms, features, pets_allowed, smoking_allowed, students_only, house_rules, roommate_preferences" as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;

export type PublicCity = { name: string; slug: string };
export type PublicNeighborhood = { name: string; slug: string };

/** Tarjeta de la búsqueda (lista blanca). */
export type PublicRoomCard = {
  id: string;
  title: string;
  neighborhood: string | null;
  city: string;
  priceMonth: number;
  expensesIncluded: boolean;
  availableFrom: string;
  /** Dormitorios de la vivienda (`total_rooms`). */
  totalRooms: number | null;
  /** Personas con las que se convivirá, sin contarse (`total_roommates`). */
  totalRoommates: number | null;
  /** Primera foto, firmada; `null` si no tiene o no se pudo firmar. */
  cover: RoomCover | null;
};

/** Detalle de una habitación (lista blanca). */
export type PublicRoomDetail = {
  id: string;
  title: string;
  description: string | null;
  neighborhood: string | null;
  city: PublicCity;
  priceMonth: number;
  expensesIncluded: boolean;
  depositAmount: number | null;
  availableFrom: string;
  minStayMonths: number | null;
  maxStayMonths: number | null;
  totalRooms: number | null;
  totalRoommates: number | null;
  features: Array<{ key: RoomFeatureKey; label: string }>;
  petsAllowed: boolean;
  smokingAllowed: boolean;
  studentsOnly: boolean;
  houseRules: string | null;
  roommatePreferences: string | null;
  /** Fotos firmadas, o `available: false` si no se pudieron cargar (la página se muestra igual). */
  photos: { available: true; images: RoomImage[] } | { available: false };
};

export type RoomSearchOutcome =
  | { kind: "invalid"; fieldErrors: FieldErrors }
  | {
      kind: "results";
      filters: RoomSearchFilters;
      rooms: PublicRoomCard[];
      /** Cursor codificado de la página siguiente, o `null` si no hay más. */
      nextCursor: string | null;
      /** La lectura o la firma de las portadas falló: las tarjetas van sin foto. */
      coversUnavailable: boolean;
    };

export type RoomSearchView = {
  city: PublicCity;
  /** Barrios de la ciudad, para el formulario y las tarjetas. */
  neighborhoods: PublicNeighborhood[];
  outcome: RoomSearchOutcome;
};

type CityRow = { id: string; name: string; slug: string };
type NeighborhoodRow = { id: string; name: string; slug: string };

type CardRow = {
  id: string;
  title: string;
  neighborhood_id: string | null;
  price_month: number;
  expenses_included: boolean;
  available_from: string;
  total_rooms: number | null;
  total_roommates: number | null;
  published_at: string | null;
};

type DetailRow = {
  id: string;
  title: string;
  description: string | null;
  neighborhood_id: string | null;
  price_month: number;
  expenses_included: boolean;
  deposit_amount: number | null;
  available_from: string;
  min_stay_months: number | null;
  max_stay_months: number | null;
  total_roommates: number | null;
  total_rooms: number | null;
  features: string[] | null;
  pets_allowed: boolean;
  smoking_allowed: boolean;
  students_only: boolean;
  house_rules: string | null;
  roommate_preferences: string | null;
};

/** Ciudad activa por su slug (la de la ruta). Un slug mal formado no consulta nada. */
async function readPublicCity(
  supabase: DbClient,
  citySlug: unknown
): Promise<ServiceResult<CityRow>> {
  if (
    typeof citySlug !== "string" ||
    citySlug.length > MAX_SLUG_LENGTH ||
    !SLUG.test(citySlug)
  )
    return fail("not_found");
  const { data, error } = await supabase
    .from("cities")
    .select("id, name, slug")
    .eq("slug", citySlug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!data) return fail("not_found");
  return ok(data as CityRow);
}

/** Barrios de una ciudad, en una consulta. */
async function readCityNeighborhoods(
  supabase: DbClient,
  cityId: string
): Promise<ServiceResult<NeighborhoodRow[]>> {
  const { data, error } = await supabase
    .from("neighborhoods")
    .select("id, name, slug")
    .eq("city_id", cityId)
    .order("name");
  if (error) return mapDbError(error);
  return ok((data ?? []) as NeighborhoodRow[]);
}

/**
 * Condición del cursor: filas estrictamente después de la última de la
 * página anterior, en el orden elegido, con el desempate por `id`. Los
 * valores van entre comillas dobles (PostgREST) y ya están validados
 * (lib/validation/room-search.ts): solo dígitos, fechas, marcas de tiempo o
 * UUID en minúsculas. PostgreSQL compara `uuid` byte a byte, que es el mismo
 * orden que el texto en minúsculas.
 */
export function cursorCondition(cursor: RoomSearchCursor): string {
  const { column, ascending } = ROOM_SEARCH_ORDER_COLUMNS[cursor.order];
  const op = ascending ? "gt" : "lt";
  const value = `"${cursor.value}"`;
  const id = `"${cursor.id}"`;
  return `or(${column}.${op}.${value},and(${column}.eq.${value},id.${op}.${id}))`;
}

/** Valor de la columna de orden de una fila, para el cursor siguiente. */
function orderValue(row: CardRow, filters: RoomSearchFilters): string | number | null {
  switch (ROOM_SEARCH_ORDER_COLUMNS[filters.order].column) {
    case "published_at":
      return row.published_at;
    case "price_month":
      return row.price_month;
    case "available_from":
      return row.available_from;
  }
}

function toCard(
  row: CardRow,
  city: CityRow,
  neighborhoodNames: Map<string, string>,
  covers: Map<string, RoomCover>
): PublicRoomCard {
  return {
    id: row.id,
    title: row.title,
    neighborhood: row.neighborhood_id
      ? (neighborhoodNames.get(row.neighborhood_id) ?? null)
      : null,
    city: city.name,
    priceMonth: row.price_month,
    expensesIncluded: row.expenses_included,
    availableFrom: row.available_from,
    totalRooms: row.total_rooms,
    totalRoommates: row.total_roommates,
    cover: covers.get(row.id) ?? null,
  };
}

/**
 * Busca habitaciones públicas de una ciudad. `citySlug` es el de la ruta;
 * `rawParams`, los de la URL. Una ciudad inexistente o inactiva es
 * `not_found`; unos parámetros no válidos, `outcome.kind: "invalid"` (sin
 * consultar habitaciones).
 *
 * Paginación por cursor (keyset): 20 por página, se piden 21 para saber si
 * hay otra, sin `count=exact`. No es una instantánea: si un anuncio cambia de
 * precio, de fecha o se publica de nuevo mientras alguien pasa páginas, puede
 * cambiar de sitio, aparecer dos veces o no aparecer.
 */
export async function searchPublicRooms(
  supabase: DbClient,
  citySlug: unknown,
  rawParams: RawSearchParams,
  deps?: RoomImagesDeps
): Promise<ServiceResult<RoomSearchView>> {
  const city = await readPublicCity(supabase, citySlug);
  if (!city.ok) return city;
  const neighborhoodsResult = await readCityNeighborhoods(supabase, city.data.id);
  if (!neighborhoodsResult.ok) return neighborhoodsResult;
  const neighborhoodRows = neighborhoodsResult.data;

  const view = {
    city: { name: city.data.name, slug: city.data.slug },
    neighborhoods: neighborhoodRows.map((row) => ({ name: row.name, slug: row.slug })),
  };

  const parsed = parseRoomSearchParams(
    rawParams,
    new Set(neighborhoodRows.map((row) => row.slug))
  );
  if (!parsed.success)
    return ok({ ...view, outcome: { kind: "invalid", fieldErrors: parsed.fieldErrors } });
  const filters = parsed.data;

  const idBySlug = new Map(neighborhoodRows.map((row) => [row.slug, row.id]));
  const names = new Map(neighborhoodRows.map((row) => [row.id, row.name]));

  let query = supabase
    .from("rooms")
    .select(PUBLIC_ROOM_CARD_SELECT)
    .eq("city_id", city.data.id);
  if (filters.neighborhoods.length > 0)
    query = query.in(
      "neighborhood_id",
      filters.neighborhoods.map((slug) => idBySlug.get(slug) as string)
    );
  if (filters.maxPrice !== null) query = query.lte("price_month", filters.maxPrice);
  if (filters.moveIn !== null) query = query.lte("available_from", filters.moveIn);
  // `features @> {...}`: la habitación tiene TODAS las elegidas.
  if (filters.features.length > 0) query = query.contains("features", filters.features);
  if (filters.pets !== null) query = query.eq("pets_allowed", filters.pets === "si");
  if (filters.smoking !== null)
    query = query.eq("smoking_allowed", filters.smoking === "si");
  if (filters.studentsOnly) query = query.eq("students_only", true);
  if (filters.maxBedrooms !== null) query = query.lte("total_rooms", filters.maxBedrooms);
  if (filters.maxRoommates !== null)
    query = query.lte("total_roommates", filters.maxRoommates);

  // Condiciones con OR en un único `or=(and(...))`: la estancia (un mínimo o
  // máximo sin valor es «sin límite») y el cursor.
  const logic: string[] = [];
  if (filters.stayMonths !== null) {
    logic.push(
      `or(min_stay_months.is.null,min_stay_months.lte.${filters.stayMonths})`,
      `or(max_stay_months.is.null,max_stay_months.gte.${filters.stayMonths})`
    );
  }
  if (filters.cursor) logic.push(cursorCondition(filters.cursor));
  if (logic.length > 0) query = query.or(`and(${logic.join(",")})`);

  const { column, ascending } = ROOM_SEARCH_ORDER_COLUMNS[filters.order];
  const { data, error } = await query
    .order(column, { ascending })
    .order("id", { ascending })
    .limit(ROOM_SEARCH_PAGE_SIZE + 1);
  if (error) return mapDbError(error);

  const rows = (data ?? []) as CardRow[];
  const page = rows.slice(0, ROOM_SEARCH_PAGE_SIZE);
  let nextCursor: string | null = null;
  if (rows.length > ROOM_SEARCH_PAGE_SIZE) {
    const last = page[page.length - 1];
    const value = orderValue(last, filters);
    // `chk_rooms_published_at`: una activa siempre tiene fecha. Si faltara,
    // no se puede seguir paginando con seguridad.
    if (value === null) return fail("unknown");
    nextCursor = encodeRoomSearchCursor({ order: filters.order, value, id: last.id });
  }

  let covers = new Map<string, RoomCover>();
  let coversUnavailable = false;
  if (page.length > 0) {
    const coversResult = await listRoomCovers(
      supabase,
      page.map((row) => row.id),
      deps
    );
    if (coversResult.ok) {
      covers = coversResult.data.covers;
      coversUnavailable = !coversResult.data.signed;
    } else {
      coversUnavailable = true;
    }
  }

  return ok({
    ...view,
    outcome: {
      kind: "results",
      filters,
      rooms: page.map((row) => toCard(row, city.data, names, covers)),
      nextCursor,
      coversUnavailable,
    },
  });
}

const FEATURE_LABELS = new Map<string, string>(
  ROOM_FEATURES.map((feature) => [feature.key, feature.label])
);

/**
 * Detalle público de una habitación de una ciudad. `not_found` (el mismo,
 * sin distinguir) si el id no es un UUID, la ciudad no existe o no está
 * activa, la habitación no existe, es de otra ciudad, o no es pública
 * (borrador, pausada, alquilada, retirada, eliminada o de una cuenta
 * desactivada: la RLS no la devuelve).
 *
 * Fotos: `listRoomImages` con este mismo cliente (vuelve a leer la habitación
 * y comprueba R7, lee solo sus fotos y firma solo esas rutas). Si la firma
 * falla, la habitación se muestra sin fotos (`photos.available: false`).
 */
export async function getPublicRoom(
  supabase: DbClient,
  citySlug: unknown,
  roomId: unknown,
  deps?: RoomImagesDeps
): Promise<ServiceResult<PublicRoomDetail>> {
  const parsedId = uuidSchema.safeParse(roomId);
  if (!parsedId.success) return fail("not_found");
  const city = await readPublicCity(supabase, citySlug);
  if (!city.ok) return city;

  const { data, error } = await supabase
    .from("rooms")
    .select(PUBLIC_ROOM_DETAIL_SELECT)
    .eq("id", parsedId.data)
    .eq("city_id", city.data.id)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!data) return fail("not_found");
  const room = data as DetailRow;

  let neighborhood: string | null = null;
  if (room.neighborhood_id) {
    const { data: hood, error: hoodError } = await supabase
      .from("neighborhoods")
      .select("name")
      .eq("id", room.neighborhood_id)
      .eq("city_id", city.data.id)
      .maybeSingle();
    if (hoodError) return mapDbError(hoodError);
    neighborhood = (hood as { name: string } | null)?.name ?? null;
  }

  const images = await listRoomImages(supabase, room.id, deps);
  if (!images.ok && images.error === "not_found") return fail("not_found");

  return ok({
    id: room.id,
    title: room.title,
    description: room.description,
    neighborhood,
    city: { name: city.data.name, slug: city.data.slug },
    priceMonth: room.price_month,
    expensesIncluded: room.expenses_included,
    depositAmount: room.deposit_amount,
    availableFrom: room.available_from,
    minStayMonths: room.min_stay_months,
    maxStayMonths: room.max_stay_months,
    totalRooms: room.total_rooms,
    totalRoommates: room.total_roommates,
    features: (room.features ?? [])
      .filter((key) => FEATURE_LABELS.has(key))
      .map((key) => ({
        key: key as RoomFeatureKey,
        label: FEATURE_LABELS.get(key) as string,
      })),
    petsAllowed: room.pets_allowed,
    smokingAllowed: room.smoking_allowed,
    studentsOnly: room.students_only,
    houseRules: room.house_rules,
    roommatePreferences: room.roommate_preferences,
    photos: images.ok ? { available: true, images: images.data } : { available: false },
  });
}
