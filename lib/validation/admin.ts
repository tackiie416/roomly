import { z } from "zod";
import { charLength, uuidSchema } from "@/lib/validation/common";

/**
 * Fase 7: entradas del panel de administración. Los mismos límites que las
 * funciones `admin_*` de la base de datos (20261129120000): la base de datos
 * vuelve a comprobarlo todo, esto es la primera capa y da mensajes claros.
 */

export const ADMIN_PAGE_SIZE = 25;
/** `p_offset` ≤ 10000 en la base de datos. */
export const ADMIN_MAX_PAGE = Math.floor(10000 / ADMIN_PAGE_SIZE) + 1;
export const ADMIN_SEARCH_MAX_LENGTH = 100;
export const ADMIN_REASON_MIN_LENGTH = 3;
export const ADMIN_REASON_MAX_LENGTH = 1000;

/** Primer valor de un parámetro de la URL (Next.js da string | string[]). */
export type SearchParams = Record<string, string | string[] | undefined>;
export const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const pageSchema = z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE).catch(1);
const searchSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => charLength(value) <= ADMIN_SEARCH_MAX_LENGTH)
  .catch("");

export const USER_STATUS_FILTERS = ["all", "active", "suspended"] as const;
export const USER_ROLE_FILTERS = ["all", "user", "admin"] as const;
export const USER_ONBOARDING_FILTERS = ["all", "complete", "incomplete"] as const;
export const ROOM_STATUS_FILTERS = [
  "all",
  "draft",
  "active",
  "paused",
  "rented",
  "removed",
] as const;

/**
 * Filtros de `/admin/usuarios` (GET). Un valor desconocido no da error:
 * vuelve al valor por defecto, como en la búsqueda pública.
 */
export function parseUserFilters(params: SearchParams) {
  return {
    search: searchSchema.parse(firstParam(params.q) ?? ""),
    status: z.enum(USER_STATUS_FILTERS).catch("all").parse(firstParam(params.estado)),
    role: z.enum(USER_ROLE_FILTERS).catch("all").parse(firstParam(params.rol)),
    onboarding: z
      .enum(USER_ONBOARDING_FILTERS)
      .catch("all")
      .parse(firstParam(params.onboarding)),
    reported: firstParam(params.reportados) === "1",
    page: pageSchema.parse(firstParam(params.pagina) ?? 1),
  };
}
export type UserFilters = ReturnType<typeof parseUserFilters>;

/** Filtros de `/admin/habitaciones` (GET). */
export function parseRoomFilters(params: SearchParams) {
  return {
    search: searchSchema.parse(firstParam(params.q) ?? ""),
    status: z.enum(ROOM_STATUS_FILTERS).catch("all").parse(firstParam(params.estado)),
    reported: firstParam(params.reportados) === "1",
    page: pageSchema.parse(firstParam(params.pagina) ?? 1),
  };
}
export type RoomFilters = ReturnType<typeof parseRoomFilters>;

const reasonSchema = z
  .string({ error: "Escribe el motivo." })
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .refine((value) => charLength(value) >= ADMIN_REASON_MIN_LENGTH, {
    message: `El motivo debe tener al menos ${ADMIN_REASON_MIN_LENGTH} caracteres.`,
  })
  .refine((value) => charLength(value) <= ADMIN_REASON_MAX_LENGTH, {
    message: `El motivo no puede tener más de ${ADMIN_REASON_MAX_LENGTH} caracteres.`,
  });

/**
 * Una acción sensible (suspender, reactivar, retirar, restaurar): el objetivo,
 * el motivo y la confirmación explícita (casilla marcada). Sin JavaScript, la
 * casilla es la confirmación: el servidor la exige.
 */
export const adminActionSchema = z
  .object({
    targetId: uuidSchema,
    reason: reasonSchema,
    confirm: z.literal("on", { error: "Marca la casilla para confirmar." }),
  })
  .strict();
export type AdminActionInput = z.infer<typeof adminActionSchema>;

export const ADMIN_USER_ACTIONS = ["suspend", "reactivate"] as const;
export const ADMIN_ROOM_ACTIONS = ["remove", "restore"] as const;
export type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];
export type AdminRoomAction = (typeof ADMIN_ROOM_ACTIONS)[number];

/** Medidas que se pueden aplicar al resolver un reporte. */
export const REPORT_MEASURES = ["none", "suspend_user", "remove_room"] as const;
export type ReportMeasure = (typeof REPORT_MEASURES)[number];
export const REPORT_MEASURE_LABELS: Record<ReportMeasure, string> = {
  none: "Ninguna medida",
  suspend_user: "Suspender la cuenta reportada",
  remove_room: "Retirar la habitación reportada",
};

/** Etiquetas de las acciones registradas en `admin_action_logs`. */
export const ADMIN_ACTION_LABELS: Record<string, string> = {
  report_in_review: "Reporte en revisión",
  report_resolved: "Reporte resuelto",
  report_dismissed: "Reporte descartado",
  report_reopened: "Reporte reabierto",
  user_suspended: "Cuenta suspendida",
  user_reactivated: "Cuenta reactivada",
  room_removed: "Habitación retirada",
  room_restored: "Habitación restaurada",
};
