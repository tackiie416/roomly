import { z } from "zod";
import { nonNegativeIntegerSchema } from "@/lib/validation/common";

/**
 * Habitaciones (Fase 4.1): catálogo de características, ocupación y
 * requisitos de publicación, preparados para la validación del CRUD (Fase
 * 4.2). Todavía no los usa ningún formulario ni servicio.
 *
 * PostgreSQL impone lo mismo (`20261015120000_rooms_integrity_publication.sql`)
 * aunque la escritura no pase por aquí: Zod da errores de campo y la base de
 * datos es la última barrera. `tests/unit/validation-infra.test.ts` comprueba
 * que este catálogo y el de la migración coinciden.
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
