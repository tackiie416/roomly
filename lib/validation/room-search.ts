import { isIsoDate } from "@/lib/validation/common";
import { ROOM_FEATURE_KEYS, type RoomFeatureKey } from "@/lib/validation/rooms";

type FieldErrors = Record<string, string[]>;

/**
 * Búsqueda pública de habitaciones (Fase 4.4, R3 y R4, sesión 71): los
 * parámetros de la URL de `/[city]/habitaciones`, sus cuatro órdenes y el
 * cursor de la paginación.
 *
 * Esquema estricto: un parámetro desconocido, repetido cuando no se puede
 * repetir, con un valor fuera de su formato o un barrio que no es de la
 * ciudad de la ruta invalida toda la búsqueda (no se ignora ni se corrige), y
 * la página no consulta habitaciones. Un valor vacío es «sin ese filtro»: el
 * formulario GET envía todos sus campos, también los vacíos.
 *
 * Sin relevancia, compatibilidad ni distancia (decisión del propietario,
 * 2026-10-31): solo los cuatro órdenes de abajo.
 */

/** Resultados por página; se piden uno más para saber si hay otra. */
export const ROOM_SEARCH_PAGE_SIZE = 20;

export const ROOM_SEARCH_ORDERS = [
  "recientes",
  "precio_asc",
  "precio_desc",
  "disponibilidad",
] as const;
export type RoomSearchOrder = (typeof ROOM_SEARCH_ORDERS)[number];
export const DEFAULT_ROOM_SEARCH_ORDER: RoomSearchOrder = "recientes";

export const ROOM_SEARCH_ORDER_LABELS: Record<RoomSearchOrder, string> = {
  recientes: "Más recientes",
  precio_asc: "Precio: de menor a mayor",
  precio_desc: "Precio: de mayor a menor",
  disponibilidad: "Disponibilidad más próxima",
};

/**
 * Orden de cada opción: la columna principal y el desempate por `id`, en la
 * misma dirección. Las tres columnas principales son NOT NULL en una
 * habitación activa (`price_month` y `available_from` siempre;
 * `published_at` por `chk_rooms_published_at`), así que el orden y el cursor
 * no tienen que tratar nulos.
 */
export const ROOM_SEARCH_ORDER_COLUMNS: Record<
  RoomSearchOrder,
  { column: "published_at" | "price_month" | "available_from"; ascending: boolean }
> = {
  recientes: { column: "published_at", ascending: false },
  precio_asc: { column: "price_month", ascending: true },
  precio_desc: { column: "price_month", ascending: false },
  disponibilidad: { column: "available_from", ascending: true },
};

/** Sí, no o indiferente (sin filtro). */
export type YesNo = "si" | "no";

/** Nombres públicos de los parámetros (en español, como las rutas). */
export const ROOM_SEARCH_PARAMS = {
  neighborhoods: "barrio",
  maxPrice: "precio_max",
  moveIn: "entrada",
  stayMonths: "meses",
  features: "caracteristica",
  pets: "mascotas",
  smoking: "fumar",
  studentsOnly: "estudiantes",
  maxBedrooms: "dormitorios_max",
  maxRoommates: "convivientes_max",
  order: "orden",
  cursor: "cursor",
} as const;

const LIST_PARAMS = new Set<string>([
  ROOM_SEARCH_PARAMS.neighborhoods,
  ROOM_SEARCH_PARAMS.features,
]);
const KNOWN_PARAMS = new Set<string>(Object.values(ROOM_SEARCH_PARAMS));

/** Valores como máximo en un parámetro de lista (más que barrios tiene una ciudad). */
export const ROOM_SEARCH_MAX_LIST_VALUES = 100;
/** Longitud máxima de un valor (un cursor codificado cabe de sobra). */
const MAX_VALUE_LENGTH = 512;
const INT32_MAX = 2_147_483_647;

/** El cursor de una página: el valor de la columna de orden y el `id` de su última fila. */
export type RoomSearchCursor = {
  order: RoomSearchOrder;
  /** `published_at` (texto ISO de PostgREST), `price_month` o `available_from` (AAAA-MM-DD). */
  value: string | number;
  id: string;
};

export type RoomSearchFilters = {
  /** Slugs de barrios de la ciudad de la ruta, sin repetir, en el orden recibido. */
  neighborhoods: string[];
  maxPrice: number | null;
  /** Fecha de entrada: habitaciones disponibles ese día o antes. */
  moveIn: string | null;
  /** Meses de estancia: dentro del mínimo y el máximo de la habitación (sin límite si no los tiene). */
  stayMonths: number | null;
  /** Habitaciones que tienen TODAS estas características. */
  features: RoomFeatureKey[];
  pets: YesNo | null;
  smoking: YesNo | null;
  /** Solo habitaciones marcadas como exclusivas para estudiantes; `false` no filtra. */
  studentsOnly: boolean;
  /** Dormitorios de la vivienda, como máximo (`total_rooms`). */
  maxBedrooms: number | null;
  /** Personas con las que se convivirá, como máximo (`total_roommates`). */
  maxRoommates: number | null;
  order: RoomSearchOrder;
  cursor: RoomSearchCursor | null;
};

export const EMPTY_ROOM_SEARCH_FILTERS: RoomSearchFilters = {
  neighborhoods: [],
  maxPrice: null,
  moveIn: null,
  stayMonths: null,
  features: [],
  pets: null,
  smoking: null,
  studentsOnly: false,
  maxBedrooms: null,
  maxRoommates: null,
  order: DEFAULT_ROOM_SEARCH_ORDER,
  cursor: null,
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type RoomSearchParse =
  | { success: true; data: RoomSearchFilters }
  | { success: false; fieldErrors: FieldErrors };

const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Marca de tiempo como la devuelve PostgREST para `timestamptz` (hasta microsegundos). */
const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const DIGITS = /^[0-9]{1,10}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Entero en `[min, INT32_MAX]` escrito solo con dígitos, o `null`. */
function parseInteger(value: string, min: number): number | null {
  if (!DIGITS.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= INT32_MAX
    ? number
    : null;
}

function isTimestamp(value: string): boolean {
  const match = TIMESTAMP.exec(value);
  return match !== null && isIsoDate(match[1]) && Number.isFinite(Date.parse(value));
}

/** ¿Es `value` un valor válido de la columna de orden de `order`? */
function isOrderValue(order: RoomSearchOrder, value: unknown): value is string | number {
  switch (ROOM_SEARCH_ORDER_COLUMNS[order].column) {
    case "published_at":
      return typeof value === "string" && isTimestamp(value);
    case "price_month":
      return (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 1 &&
        value <= INT32_MAX
      );
    case "available_from":
      return typeof value === "string" && isIsoDate(value);
  }
}

/** Cursor opaco para la interfaz: JSON en base64url. No es secreto ni va firmado; se valida al volver. */
export function encodeRoomSearchCursor(cursor: RoomSearchCursor): string {
  return Buffer.from(
    JSON.stringify({ o: cursor.order, v: cursor.value, i: cursor.id }),
    "utf8"
  ).toString("base64url");
}

/**
 * El cursor recibido, o `null` si no es válido para `order`: formato base64url,
 * JSON con exactamente `o`, `v` e `i`, el mismo orden de la búsqueda, un valor
 * del tipo de su columna y un UUID en minúsculas (como los devuelve
 * PostgreSQL).
 */
export function decodeRoomSearchCursor(
  raw: string,
  order: RoomSearchOrder
): RoomSearchCursor | null {
  if (!BASE64URL.test(raw) || raw.length > MAX_VALUE_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "i,o,v") return null;
  if (record.o !== order) return null;
  if (!isOrderValue(order, record.v)) return null;
  if (typeof record.i !== "string" || !UUID_LOWER.test(record.i)) return null;
  return { order, value: record.v, id: record.i };
}

/**
 * Lee los parámetros de la búsqueda. `neighborhoodSlugs`: los barrios de la
 * ciudad de la ruta (cualquier otro invalida la búsqueda).
 */
export function parseRoomSearchParams(
  raw: RawSearchParams,
  neighborhoodSlugs: ReadonlySet<string>
): RoomSearchParse {
  const errors: FieldErrors = {};
  const add = (key: string, message: string) => {
    errors[key] = [...(errors[key] ?? []), message];
  };

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (!KNOWN_PARAMS.has(key)) {
      add("_form", "La búsqueda tiene un parámetro que no reconocemos");
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    if (!LIST_PARAMS.has(key) && values.length > 1) add(key, "Valor repetido");
    if (values.length > ROOM_SEARCH_MAX_LIST_VALUES) add(key, "Demasiados valores");
    if (values.some((item) => typeof item !== "string" || item.length > MAX_VALUE_LENGTH))
      add(key, "Valor no válido");
  }
  if (Object.keys(errors).length > 0) return { success: false, fieldErrors: errors };

  const scalar = (key: string): string => {
    const value = raw[key];
    return typeof value === "string" ? value : "";
  };
  const list = (key: string): string[] => {
    const value = raw[key];
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).filter((item) => item !== "");
  };
  const integer = (key: string, min: number, message: string): number | null => {
    const value = scalar(key);
    if (value === "") return null;
    const number = parseInteger(value, min);
    if (number === null) add(key, message);
    return number;
  };
  const yesNo = (key: string): YesNo | null => {
    const value = scalar(key);
    if (value === "") return null;
    if (value === "si" || value === "no") return value;
    add(key, "Elige sí, no o indiferente");
    return null;
  };

  const P = ROOM_SEARCH_PARAMS;

  const neighborhoods = [...new Set(list(P.neighborhoods))];
  for (const slug of neighborhoods) {
    if (!SLUG.test(slug) || !neighborhoodSlugs.has(slug)) {
      add(P.neighborhoods, "Algún barrio no es de esta ciudad");
      break;
    }
  }

  const features = [...new Set(list(P.features))];
  for (const key of features) {
    if (!(ROOM_FEATURE_KEYS as readonly string[]).includes(key)) {
      add(P.features, "Alguna característica no es válida");
      break;
    }
  }

  const maxPrice = integer(P.maxPrice, 1, "Indica un precio en euros, mayor que 0");
  const moveIn = scalar(P.moveIn) === "" ? null : scalar(P.moveIn);
  if (moveIn !== null && !isIsoDate(moveIn))
    add(P.moveIn, "La fecha no es válida (formato AAAA-MM-DD)");
  const stayMonths = integer(P.stayMonths, 1, "Indica los meses, al menos 1");
  const pets = yesNo(P.pets);
  const smoking = yesNo(P.smoking);

  const students = scalar(P.studentsOnly);
  if (students !== "" && students !== "1") add(P.studentsOnly, "Valor no válido");

  const maxBedrooms = integer(
    P.maxBedrooms,
    1,
    "Indica un número de dormitorios, al menos 1"
  );
  const maxRoommates = integer(
    P.maxRoommates,
    0,
    "Indica un número de personas, 0 o más"
  );

  const orderRaw = scalar(P.order);
  let order: RoomSearchOrder = DEFAULT_ROOM_SEARCH_ORDER;
  if (orderRaw !== "") {
    if ((ROOM_SEARCH_ORDERS as readonly string[]).includes(orderRaw))
      order = orderRaw as RoomSearchOrder;
    else add(P.order, "Orden no válido");
  }

  const cursorRaw = scalar(P.cursor);
  let cursor: RoomSearchCursor | null = null;
  if (cursorRaw !== "" && !errors[P.order]) {
    cursor = decodeRoomSearchCursor(cursorRaw, order);
    if (!cursor) add(P.cursor, "El enlace de esta página no es válido");
  }

  if (Object.keys(errors).length > 0) return { success: false, fieldErrors: errors };
  return {
    success: true,
    data: {
      neighborhoods,
      maxPrice,
      moveIn,
      stayMonths,
      features: features as RoomFeatureKey[],
      pets,
      smoking,
      studentsOnly: students === "1",
      maxBedrooms,
      maxRoommates,
      order,
      cursor,
    },
  };
}

/** ¿Hay algún filtro (no el orden ni el cursor)? */
export function hasRoomSearchFilters(filters: RoomSearchFilters): boolean {
  return (
    filters.neighborhoods.length > 0 ||
    filters.maxPrice !== null ||
    filters.moveIn !== null ||
    filters.stayMonths !== null ||
    filters.features.length > 0 ||
    filters.pets !== null ||
    filters.smoking !== null ||
    filters.studentsOnly ||
    filters.maxBedrooms !== null ||
    filters.maxRoommates !== null
  );
}

/** Ruta de la búsqueda de una ciudad, sin parámetros (la canónica). */
export function roomSearchPath(citySlug: string): string {
  return `/${encodeURIComponent(citySlug)}/habitaciones`;
}

/** Ruta del detalle de una habitación. */
export function publicRoomPath(citySlug: string, roomId: string): string {
  return `${roomSearchPath(citySlug)}/${encodeURIComponent(roomId)}`;
}

/**
 * URL de la búsqueda con estos filtros, este orden y, si se indica, este
 * cursor (codificado). Sin los valores vacíos ni el orden por defecto, y
 * siempre en el mismo orden de parámetros: los enlaces de la paginación
 * conservan los filtros y el orden.
 */
export function roomSearchHref(
  citySlug: string,
  filters: RoomSearchFilters,
  cursor: string | null = null
): string {
  const P = ROOM_SEARCH_PARAMS;
  const params = new URLSearchParams();
  for (const slug of filters.neighborhoods) params.append(P.neighborhoods, slug);
  if (filters.maxPrice !== null) params.set(P.maxPrice, String(filters.maxPrice));
  if (filters.moveIn !== null) params.set(P.moveIn, filters.moveIn);
  if (filters.stayMonths !== null) params.set(P.stayMonths, String(filters.stayMonths));
  for (const key of filters.features) params.append(P.features, key);
  if (filters.pets !== null) params.set(P.pets, filters.pets);
  if (filters.smoking !== null) params.set(P.smoking, filters.smoking);
  if (filters.studentsOnly) params.set(P.studentsOnly, "1");
  if (filters.maxBedrooms !== null)
    params.set(P.maxBedrooms, String(filters.maxBedrooms));
  if (filters.maxRoommates !== null)
    params.set(P.maxRoommates, String(filters.maxRoommates));
  if (filters.order !== DEFAULT_ROOM_SEARCH_ORDER) params.set(P.order, filters.order);
  if (cursor !== null) params.set(P.cursor, cursor);
  const query = params.toString();
  return query ? `${roomSearchPath(citySlug)}?${query}` : roomSearchPath(citySlug);
}
