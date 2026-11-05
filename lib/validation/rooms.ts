import { z } from "zod";
import {
  charLength,
  isIsoDate,
  nonNegativeIntegerSchema,
  optionalTextSchema,
  uuidSchema,
} from "@/lib/validation/common";
import type { FormFields } from "@/lib/validation/form-data";

/**
 * Habitaciones: catálogo de características, ocupación y requisitos de
 * publicación (Fase 4.1), y los esquemas del CRUD de la propietaria (Fase 4,
 * sesión 68): crear, editar y cambiar el estado.
 *
 * PostgreSQL impone lo mismo (`20261015120000_rooms_integrity_publication.sql`
 * y el trigger de moderación H5) aunque la escritura no pase por aquí: Zod da
 * errores de campo y la base de datos es la última barrera.
 * `tests/unit/validation-infra.test.ts` comprueba que este catálogo y el de
 * la migración coinciden, y que las columnas que escribe el CRUD están en el
 * GRANT de `authenticated`.
 */

/**
 * Catálogo cerrado de características (R6). La clave es el valor que se
 * guarda en `rooms.features`; la etiqueta, la que mostrará la interfaz.
 * Mascotas, tabaco y «solo estudiantes» no están aquí: son las columnas
 * booleanas `pets_allowed`, `smoking_allowed` y `students_only`.
 */
export const ROOM_FEATURES = [
  { key: "wifi", label: "Wi-Fi" },
  { key: "heating", label: "Calefacción" },
  { key: "air_conditioning", label: "Aire acondicionado" },
  { key: "elevator", label: "Ascensor" },
  { key: "washing_machine", label: "Lavadora" },
  { key: "dishwasher", label: "Lavavajillas" },
  { key: "balcony", label: "Terraza o balcón" },
  { key: "furnished", label: "Amueblada" },
  { key: "private_bathroom", label: "Baño privado" },
  { key: "double_bed", label: "Cama doble" },
  { key: "desk", label: "Escritorio" },
  { key: "exterior", label: "Exterior" },
] as const;

export type RoomFeatureKey = (typeof ROOM_FEATURES)[number]["key"];

export const ROOM_FEATURE_KEYS = ROOM_FEATURES.map((feature) => feature.key) as [
  RoomFeatureKey,
  ...RoomFeatureKey[],
];

/** Etiqueta de una clave del catálogo. */
export function roomFeatureLabel(key: RoomFeatureKey): string {
  const feature = ROOM_FEATURES.find((candidate) => candidate.key === key);
  if (!feature) throw new Error(`Característica desconocida: ${key}`);
  return feature.label;
}

/**
 * Características de una habitación: solo claves del catálogo. Vacía
 * permitida. Las repetidas se quitan (en el orden en que llegaron), como los
 * barrios de las preferencias; la base de datos las rechaza
 * (`chk_rooms_features_unique`), así que nunca llegan repetidas.
 */
export const roomFeaturesSchema = z
  .array(z.enum(ROOM_FEATURE_KEYS, { error: "Característica no válida" }), {
    error: "Lista de características no válida",
  })
  .transform((keys) => [...new Set(keys)]);

/**
 * `total_roommates` (R9): número de personas con las que convivirá quien entre
 * en la habitación, sin contarse a sí mismo. Entero ≥ 0.
 */
export const totalRoommatesSchema = nonNegativeIntegerSchema;

/** `total_rooms` (R9): número total de dormitorios de la vivienda. Entero ≥ 1. */
export const totalRoomsSchema = z
  .int32({ error: "Introduce un número entero válido" })
  .min(1, { error: "La vivienda tiene que tener al menos un dormitorio" });

/**
 * Campos que, además de los obligatorios del esquema, exige una habitación
 * `active` (R7, `chk_rooms_publishable`). Un borrador puede no tenerlos.
 */
export const ROOM_PUBLICATION_REQUIRED_FIELDS = [
  "neighborhood_id",
  "total_roommates",
  "total_rooms",
] as const;

// ------------------------------------------------------------------
// CRUD de la propietaria (Fase 4, sesión 68)
// ------------------------------------------------------------------

/**
 * Estados que la propietaria puede elegir (R7, opción A, 2026-10-15): se
 * mueve entre estos cuatro, y a `active` solo con la habitación completa.
 * `removed` es del admin y del servidor (trigger H5): nunca se acepta del
 * navegador, ni para ponerlo ni para quitarlo.
 */
export const OWNER_ROOM_STATUSES = ["draft", "active", "paused", "rented"] as const;
export type OwnerRoomStatus = (typeof OWNER_ROOM_STATUSES)[number];

/** Etiquetas de `room_status`, incluido `removed` (solo se muestra). */
export const ROOM_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  active: "Publicada",
  paused: "Pausada",
  rented: "Alquilada",
  removed: "Retirada por moderación",
};

/**
 * Longitudes máximas de los textos, en caracteres como los cuenta PostgreSQL.
 * Son límites técnicos contra el abuso, no requisitos de producto: la base de
 * datos no los tiene (sin CHECK de longitud en `rooms`), así que solo los
 * aplica la aplicación. El título solo exige no estar vacío (NOT NULL).
 */
export const ROOM_TEXT_LIMITS = {
  title: 120,
  description: 2000,
  house_rules: 1000,
  roommate_preferences: 1000,
} as const;

const unknownKeyError = (issue: { code?: string; keys?: string[] }) =>
  issue.code === "unrecognized_keys"
    ? `Campo no permitido: ${(issue.keys ?? []).join(", ")}`
    : undefined;

const missing = (input: unknown) => input === undefined || input === null || input === "";

const titleSchema = z
  .string({ error: "Escribe un título" })
  .transform((value) => value.trim())
  .refine((value) => value !== "", { error: "Escribe un título" })
  .refine((value) => charLength(value) <= ROOM_TEXT_LIMITS.title, {
    error: `El título: máximo ${ROOM_TEXT_LIMITS.title} caracteres`,
  });

const citySchema = z
  .uuid({
    error: (issue) =>
      missing(issue.input) ? "Elige una ciudad" : "La ciudad no es válida",
  })
  .transform((value) => value.toLowerCase());

/** Precio al mes en euros enteros, mayor que 0 (`chk_price_positive`). */
const priceSchema = z
  .int32({
    error: (issue) =>
      missing(issue.input)
        ? "Indica el precio al mes"
        : "Introduce un número entero válido",
  })
  .min(1, { error: "El precio tiene que ser mayor que 0" });

/** Fecha `AAAA-MM-DD` desde la que está disponible (NOT NULL). */
const availableFromSchema = z
  .string({ error: "Indica desde cuándo está disponible" })
  .refine(isIsoDate, { error: "La fecha no es válida (formato AAAA-MM-DD)" });

/** Meses de estancia: entero ≥ 1. */
const staySchema = z
  .int32({ error: "Introduce un número entero válido" })
  .min(1, { error: "La estancia es de al menos 1 mes" });

/**
 * Sí/No explícito (el esquema de la base de datos pide que el formulario de
 * la Fase 4 pregunte `students_only`; el DEFAULT solo evita NULL). Llega como
 * `"true"`/`"false"` de dos radios, o como booleano.
 */
const studentsOnlySchema = z.union(
  [z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")],
  { error: "Indica si la habitación es solo para estudiantes" }
);

/**
 * Campos que escribe el CRUD: los del formulario, que son columnas de
 * `rooms` concedidas a `authenticated` (GRANT de 20261015120000). Nunca
 * `id`, `owner_id` (lo pone el servicio a partir de la sesión), `status`
 * (nace `draft`; se cambia aparte), `deleted_at`, `approx_*` ni las fechas.
 * La ubicación es solo la ciudad y el barrio (R2): la dirección exacta no se
 * pide ni se guarda, y `room_addresses` no se toca.
 */
const roomShape = {
  title: titleSchema,
  description: optionalTextSchema(
    ROOM_TEXT_LIMITS.description,
    "La descripción"
  ).optional(),
  city_id: citySchema,
  neighborhood_id: uuidSchema.nullable().optional(),
  price_month: priceSchema,
  expenses_included: z.boolean({ error: "Valor no válido" }).optional(),
  deposit_amount: nonNegativeIntegerSchema.nullable().optional(),
  available_from: availableFromSchema,
  min_stay_months: staySchema.nullable().optional(),
  max_stay_months: staySchema.nullable().optional(),
  total_roommates: totalRoommatesSchema.nullable().optional(),
  total_rooms: totalRoomsSchema.nullable().optional(),
  features: roomFeaturesSchema.optional(),
  pets_allowed: z.boolean({ error: "Valor no válido" }).optional(),
  smoking_allowed: z.boolean({ error: "Valor no válido" }).optional(),
  students_only: studentsOnlySchema,
  house_rules: optionalTextSchema(ROOM_TEXT_LIMITS.house_rules, "Las normas").optional(),
  roommate_preferences: optionalTextSchema(
    ROOM_TEXT_LIMITS.roommate_preferences,
    "Las preferencias de convivencia"
  ).optional(),
};

/** Columnas que pueden llegar a un INSERT o UPDATE del CRUD (además de `owner_id` al crear). */
export const ROOM_WRITABLE_COLUMNS = Object.keys(roomShape) as Array<
  keyof typeof roomShape
>;

type RoomShapeOutput = {
  [K in keyof typeof roomShape]?: z.output<(typeof roomShape)[K]>;
};

/** Estancia mínima ≤ máxima (`chk_stay_range`), si llegan las dos. */
function checkStay(value: RoomShapeOutput, ctx: z.RefinementCtx) {
  const { min_stay_months: min, max_stay_months: max } = value;
  if (min != null && max != null && min > max) {
    ctx.addIssue({
      code: "custom",
      path: ["max_stay_months"],
      message: "La estancia máxima no puede ser menor que la mínima",
    });
  }
}

/**
 * Crear una habitación: nace `draft` (sin `status`). Obligatorios: título,
 * ciudad, precio, fecha de disponibilidad y `students_only`; el resto puede
 * quedar vacío en un borrador.
 */
export const roomCreateSchema = z
  .strictObject(roomShape, { error: unknownKeyError })
  .superRefine(checkStay);

/**
 * Editar una habitación propia: el formulario completo, con las mismas
 * reglas. Un campo opcional vacío (`null`) se vacía; uno que no llega no se
 * toca. El estado no se edita aquí (`roomStatusChangeSchema`).
 */
export const roomUpdateSchema = z
  .strictObject(roomShape, { error: unknownKeyError })
  .superRefine(checkStay);

export type RoomWriteInput = z.output<typeof roomCreateSchema>;

/** Cambio de estado de una habitación propia (R7): solo los cuatro estados de la propietaria. */
export const roomStatusChangeSchema = z.strictObject(
  {
    roomId: uuidSchema,
    status: z.enum(OWNER_ROOM_STATUSES, { error: "Estado no válido" }),
  },
  { error: unknownKeyError }
);

export type RoomPublicationField = (typeof ROOM_PUBLICATION_REQUIRED_FIELDS)[number];

/** Mensaje de cada campo que falta para publicar. */
export const ROOM_PUBLICATION_MESSAGES: Record<RoomPublicationField, string> = {
  neighborhood_id: "Para publicar, elige un barrio",
  total_roommates: "Para publicar, indica con cuántas personas convivirá",
  total_rooms: "Para publicar, indica cuántos dormitorios tiene la vivienda",
};

/** Campos de `ROOM_PUBLICATION_REQUIRED_FIELDS` que faltan (los que exige `chk_rooms_publishable`). */
export function missingPublicationFields(
  room: Partial<Record<RoomPublicationField, string | number | null>>
): RoomPublicationField[] {
  return ROOM_PUBLICATION_REQUIRED_FIELDS.filter(
    (field) => room[field] === null || room[field] === undefined
  );
}

/**
 * Formulario de habitación (crear y editar): cómo convierte `FormData` cada
 * campo. Las casillas sin marcar son `false`; `students_only` son dos radios
 * (sí/no) para que la respuesta sea explícita.
 */
export const ROOM_FORM_FIELDS = {
  title: "text",
  description: "text",
  city_id: "text",
  neighborhood_id: "text",
  price_month: "number",
  expenses_included: "checkbox",
  deposit_amount: "number",
  available_from: "text",
  min_stay_months: "number",
  max_stay_months: "number",
  total_roommates: "number",
  total_rooms: "number",
  features: "list",
  pets_allowed: "checkbox",
  smoking_allowed: "checkbox",
  students_only: "text",
  house_rules: "text",
  roommate_preferences: "text",
} as const satisfies FormFields;
