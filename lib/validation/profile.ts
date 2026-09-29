import { z } from "zod";
import type { SeekingStatus } from "@/types/database";
import {
  charLength,
  isoDateSchema,
  latestBirthDateForAge,
  optionalTextSchema,
  todayUtc,
} from "@/lib/validation/common";

/**
 * Esquemas de entrada del perfil propio (Fase 2.1).
 *
 * Reflejan el contrato real de la base de datos: los CHECKs de
 * `20260929120000_phase2_data_hardening.sql` y `chk_min_age`, y el GRANT de
 * `authenticated` sobre `profiles`. Solo admiten los campos que el usuario
 * puede escribir: `id`, `role`, `deleted_at`, timestamps,
 * `onboarding_completed_at` (lo fija el servidor) y `avatar_url` (la foto
 * está fuera de Fase 2) se rechazan como claves desconocidas.
 */

export const MINIMUM_AGE_YEARS = 18;

/** Valores del enum `seeking_status` de la base de datos, en el mismo orden. */
export const SEEKING_STATUS_VALUES = [
  "looking_for_room",
  "has_room_looking_for_roommate",
  "flexible",
] as const satisfies readonly SeekingStatus[];

const unknownKeyError = (issue: { code?: string; keys?: string[] }) =>
  issue.code === "unrecognized_keys"
    ? `Campo no permitido: ${(issue.keys ?? []).join(", ")}`
    : undefined;

/** `trim`, espacios internos colapsados, 1–100 caracteres (`chk_profiles_full_name`). */
export const fullNameSchema = z
  .string({ error: "Introduce tu nombre" })
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .refine((value) => charLength(value) >= 1, { error: "Introduce tu nombre" })
  .refine((value) => charLength(value) <= 100, {
    error: "El nombre admite como máximo 100 caracteres",
  });

/**
 * Fecha ISO real, no futura y con al menos 18 años, calculado con el día
 * actual en UTC como `chk_min_age` (`current_date - interval '18 years'`).
 */
export const dateOfBirthSchema = isoDateSchema
  .refine((value) => value <= todayUtc(), {
    error: "La fecha de nacimiento no puede ser futura",
  })
  .refine((value) => value <= latestBirthDateForAge(MINIMUM_AGE_YEARS), {
    error: `Tienes que tener al menos ${MINIMUM_AGE_YEARS} años`,
  });

/**
 * Sin valor por defecto a propósito: el default `flexible` de la base de
 * datos no cuenta como elección del usuario. Crear un perfil exige enviarlo
 * explícitamente, y la UI de 2.3 no debe preseleccionarlo.
 */
export const seekingStatusSchema = z.enum(SEEKING_STATUS_VALUES, {
  error: "Elige qué estás buscando",
});

export const bioSchema = optionalTextSchema(500, "La descripción");

export const profileCreateSchema = z.strictObject(
  {
    full_name: fullNameSchema,
    date_of_birth: dateOfBirthSchema,
    seeking_status: seekingStatusSchema,
    bio: bioSchema.optional(),
  },
  { error: unknownKeyError }
);

export const profileUpdateSchema = z
  .strictObject(
    {
      full_name: fullNameSchema.optional(),
      date_of_birth: dateOfBirthSchema.optional(),
      seeking_status: seekingStatusSchema.optional(),
      bio: bioSchema.optional(),
    },
    { error: unknownKeyError }
  )
  .refine((value) => Object.keys(value).length > 0, {
    error: "No hay ningún cambio que guardar",
  });

export type ProfileCreateInput = z.output<typeof profileCreateSchema>;
export type ProfileUpdateInput = z.output<typeof profileUpdateSchema>;
