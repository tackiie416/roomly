import "server-only";

import {
  type DbClient,
  type DbError,
  type ServiceResult,
  fail,
  getSessionUserId,
  ok,
} from "@/lib/services/result";
import { isActiveAdmin } from "@/lib/services/profile";
import {
  ADMIN_PAGE_SIZE,
  type AdminRoomAction,
  type AdminUserAction,
  type RoomFilters,
  type UserFilters,
  adminActionSchema,
} from "@/lib/validation/admin";
import { uuidSchema } from "@/lib/validation/common";

/**
 * Fase 7: panel de administración. Sin service_role: todo pasa por las
 * funciones `admin_*` de la base de datos (20261129120000) con el cliente del
 * propio admin. Cada función comprueba `is_admin()` con el JWT de la
 * petición, así que la autorización real la decide la base de datos; aquí
 * hay una segunda comprobación (admin activo) para no llegar a la base de
 * datos sin sesión de admin, y en cada página y Server Action, `requireAdmin()`.
 *
 * Las acciones (suspender, reactivar, retirar, restaurar, resolver) y su
 * registro en `admin_action_logs` se hacen en una sola transacción dentro de
 * la función: una acción sin registro no puede ocurrir.
 *
 * Los datos que devuelve son los que necesita el panel: nunca el email, la
 * fecha de nacimiento, los presupuestos, las respuestas del test, la
 * dirección exacta ni el contenido de los mensajes.
 */

type AdminRpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: DbError;
  }>;
};

/**
 * Las funciones admin_* no están en `types/database.ts` con su forma exacta:
 * se llaman aquí y en ningún otro sitio. Un fallo inesperado del cliente
 * (excepción) se trata como un error desconocido, sin detalles.
 */
async function rpc(
  supabase: DbClient,
  fn: string,
  args?: Record<string, unknown>
): Promise<{ data: unknown; error: DbError }> {
  try {
    return await (supabase as unknown as AdminRpcClient).rpc(fn, args);
  } catch {
    return { data: null, error: { code: "unknown", message: "rpc_failed" } };
  }
}

/** Traduce los errores de las funciones admin_* (prefijos estables). */
export function mapAdminError<T = never>(error: DbError): ServiceResult<T> {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "42501") return fail("forbidden");
  if (code === "P0002" || message.startsWith("admin_not_found")) return fail("not_found");
  if (code === "22023" || message.startsWith("admin_invalid")) return fail("validation");
  if (code === "23514" && message.startsWith("admin_state")) return fail("conflict");
  if (code === "23505") return fail("conflict");
  return fail("unknown");
}

async function requireActiveAdmin(supabase: DbClient): Promise<ServiceResult<true>> {
  const admin = await isActiveAdmin(supabase);
  if (!admin.ok) return admin;
  if (!admin.data) return fail("forbidden");
  return ok(true);
}

const pageOffset = (page: number) => (page - 1) * ADMIN_PAGE_SIZE;

// ------------------------------------------------------------------
// Usuarios
// ------------------------------------------------------------------

export type AdminUserRow = {
  id: string;
  fullName: string;
  role: "user" | "admin";
  seekingStatus: string;
  createdAt: string;
  onboardingCompleted: boolean;
  suspended: boolean;
  openReports: number;
  roomsCount: number;
};

export type AdminPage<T> = { items: T[]; total: number; page: number; pageCount: number };

type UserListRow = {
  id: string;
  full_name: string;
  role: "user" | "admin";
  seeking_status: string;
  created_at: string;
  onboarding_completed_at: string | null;
  deleted_at: string | null;
  open_reports: number;
  rooms_count: number;
  total_count: number;
};

export async function listUsersForAdmin(
  supabase: DbClient,
  filters: UserFilters
): Promise<ServiceResult<AdminPage<AdminUserRow>>> {
  const admin = await requireActiveAdmin(supabase);
  if (!admin.ok) return admin;
  const { data, error } = await rpc(supabase, "admin_list_users", {
    p_search: filters.search || null,
    p_status: filters.status,
    p_role: filters.role,
    p_onboarding: filters.onboarding,
    p_reported: filters.reported,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: pageOffset(filters.page),
  });
  if (error) return mapAdminError(error);
  const rows = (data ?? []) as UserListRow[];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  return ok({
    items: rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      role: r.role,
      seekingStatus: r.seeking_status,
      createdAt: r.created_at,
      onboardingCompleted: r.onboarding_completed_at !== null,
      suspended: r.deleted_at !== null,
      openReports: Number(r.open_reports),
      roomsCount: Number(r.rooms_count),
    })),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
  });
}

export type AdminHistoryEntry = {
  action: string;
  notes: string | null;
  createdAt: string;
  adminName: string | null;
};

export type AdminUserDetail = {
  id: string;
  fullName: string;
  bio: string | null;
  role: "user" | "admin";
  seekingStatus: string;
  createdAt: string;
  onboardingCompletedAt: string | null;
  deactivatedAt: string | null;
  suspendedByAdmin: boolean;
  /** Eliminación pedida y sin terminar (sesión 88): no se ofrece reactivar. */
  deletionRequestedAt: string | null;
  hasQuestionnaire: boolean;
  matchesCount: number;
  blockedByCount: number;
  reportsMadeCount: number;
  rooms: { id: string; title: string; status: string; createdAt: string }[];
  reportsReceived: {
    id: string;
    reason: string;
    status: string;
    createdAt: string;
    roomId: string | null;
  }[];
  history: AdminHistoryEntry[];
  /** La cuenta es la del propio admin (el panel no ofrece acciones sobre ella). */
  isSelf: boolean;
};

type Json = Record<string, unknown>;
const asArray = (value: unknown): Json[] =>
  Array.isArray(value) ? (value as Json[]) : [];
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function mapHistory(value: unknown): AdminHistoryEntry[] {
  return asArray(value).map((h) => ({
    action: str(h.action),
    notes: strOrNull(h.notes),
    createdAt: str(h.created_at),
    adminName: strOrNull(h.admin_name),
  }));
}

export async function getUserForAdmin(
  supabase: DbClient,
  userId: unknown
): Promise<ServiceResult<AdminUserDetail>> {
  const id = uuidSchema.safeParse(userId);
  if (!id.success) return fail("not_found");
  const admin = await requireActiveAdmin(supabase);
  if (!admin.ok) return admin;
  const { data, error } = await rpc(supabase, "admin_get_user", { p_user_id: id.data });
  if (error) return mapAdminError(error);
  const d = (data ?? {}) as Json;
  const sessionUserId = await getSessionUserId(supabase);
  return ok({
    isSelf: sessionUserId === str(d.id),
    id: str(d.id),
    fullName: str(d.full_name),
    bio: strOrNull(d.bio),
    role: d.role === "admin" ? "admin" : "user",
    seekingStatus: str(d.seeking_status),
    createdAt: str(d.created_at),
    onboardingCompletedAt: strOrNull(d.onboarding_completed_at),
    deactivatedAt: strOrNull(d.deleted_at),
    suspendedByAdmin: d.suspended_by_admin === true,
    deletionRequestedAt: strOrNull(d.deletion_requested_at),
    hasQuestionnaire: d.has_questionnaire === true,
    matchesCount: Number(d.matches_count ?? 0),
    blockedByCount: Number(d.blocked_by_count ?? 0),
    reportsMadeCount: Number(d.reports_made_count ?? 0),
    rooms: asArray(d.rooms).map((r) => ({
      id: str(r.id),
      title: str(r.title),
      status: str(r.status),
      createdAt: str(r.created_at),
    })),
    reportsReceived: asArray(d.reports_received).map((r) => ({
      id: str(r.id),
      reason: str(r.reason),
      status: str(r.status),
      createdAt: str(r.created_at),
      roomId: strOrNull(r.room_id),
    })),
    history: mapHistory(d.history),
  });
}

// ------------------------------------------------------------------
// Habitaciones
// ------------------------------------------------------------------

export type AdminRoomRow = {
  id: string;
  title: string;
  status: string;
  cityName: string | null;
  neighborhoodName: string | null;
  priceMonth: number;
  ownerId: string;
  ownerName: string;
  ownerDeactivated: boolean;
  createdAt: string;
  publishedAt: string | null;
  openReports: number;
};

type RoomListRow = {
  id: string;
  title: string;
  status: string;
  city_name: string | null;
  neighborhood_name: string | null;
  price_month: number;
  owner_id: string;
  owner_name: string;
  owner_deactivated: boolean;
  created_at: string;
  published_at: string | null;
  open_reports: number;
  total_count: number;
};

export async function listRoomsForAdmin(
  supabase: DbClient,
  filters: RoomFilters
): Promise<ServiceResult<AdminPage<AdminRoomRow>>> {
  const admin = await requireActiveAdmin(supabase);
  if (!admin.ok) return admin;
  const { data, error } = await rpc(supabase, "admin_list_rooms", {
    p_search: filters.search || null,
    p_status: filters.status,
    p_reported: filters.reported,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: pageOffset(filters.page),
  });
  if (error) return mapAdminError(error);
  const rows = (data ?? []) as RoomListRow[];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  return ok({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      cityName: r.city_name,
      neighborhoodName: r.neighborhood_name,
      priceMonth: Number(r.price_month),
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      ownerDeactivated: r.owner_deactivated === true,
      createdAt: r.created_at,
      publishedAt: r.published_at,
      openReports: Number(r.open_reports),
    })),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
  });
}

export type AdminRoomDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priceMonth: number;
  cityName: string | null;
  neighborhoodName: string | null;
  houseRules: string | null;
  roommatePreferences: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  imagesCount: number;
  owner: { id: string; fullName: string; deactivated: boolean } | null;
  reports: {
    id: string;
    reason: string;
    status: string;
    description: string | null;
    createdAt: string;
  }[];
  history: AdminHistoryEntry[];
};

export async function getRoomForAdmin(
  supabase: DbClient,
  roomId: unknown
): Promise<ServiceResult<AdminRoomDetail>> {
  const id = uuidSchema.safeParse(roomId);
  if (!id.success) return fail("not_found");
  const admin = await requireActiveAdmin(supabase);
  if (!admin.ok) return admin;
  const { data, error } = await rpc(supabase, "admin_get_room", { p_room_id: id.data });
  if (error) return mapAdminError(error);
  const d = (data ?? {}) as Json;
  const owner = d.owner && typeof d.owner === "object" ? (d.owner as Json) : null;
  return ok({
    id: str(d.id),
    title: str(d.title),
    description: strOrNull(d.description),
    status: str(d.status),
    priceMonth: Number(d.price_month ?? 0),
    cityName: strOrNull(d.city_name),
    neighborhoodName: strOrNull(d.neighborhood_name),
    houseRules: strOrNull(d.house_rules),
    roommatePreferences: strOrNull(d.roommate_preferences),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
    publishedAt: strOrNull(d.published_at),
    imagesCount: Number(d.images_count ?? 0),
    owner: owner
      ? {
          id: str(owner.id),
          fullName: str(owner.full_name),
          deactivated: owner.deactivated === true,
        }
      : null,
    reports: asArray(d.reports).map((r) => ({
      id: str(r.id),
      reason: str(r.reason),
      status: str(r.status),
      description: strOrNull(r.description),
      createdAt: str(r.created_at),
    })),
    history: mapHistory(d.history),
  });
}

// ------------------------------------------------------------------
// Métricas
// ------------------------------------------------------------------

export type AdminMetrics = {
  generatedAt: string;
  users: Record<
    | "total"
    | "active"
    | "suspended"
    | "admins"
    | "onboarding_complete"
    | "new_7d"
    | "new_30d",
    number
  >;
  questionnaires: number;
  rooms: Record<
    "total" | "draft" | "active" | "paused" | "rented" | "removed" | "published_7d",
    number
  >;
  interests: Record<"total" | "last_7d" | "with_room", number>;
  matches: Record<"total" | "last_7d", number>;
  conversations: Record<"open" | "closed" | "active_7d", number>;
  messages: Record<"last_7d" | "last_30d", number>;
  blocks: number;
  reports: Record<
    "pending" | "in_review" | "resolved" | "dismissed" | "last_7d",
    number
  > & { avg_hours_to_close_30d: number | null };
  adminActions7d: number;
};

function numbers<K extends string>(
  value: unknown,
  keys: readonly K[]
): Record<K, number> {
  const source = value && typeof value === "object" ? (value as Json) : {};
  return Object.fromEntries(keys.map((k) => [k, Number(source[k] ?? 0)])) as Record<
    K,
    number
  >;
}

export async function getAdminMetrics(
  supabase: DbClient
): Promise<ServiceResult<AdminMetrics>> {
  const admin = await requireActiveAdmin(supabase);
  if (!admin.ok) return admin;
  const { data, error } = await rpc(supabase, "admin_metrics");
  if (error) return mapAdminError(error);
  const d = (data ?? {}) as Json;
  const reports = d.reports && typeof d.reports === "object" ? (d.reports as Json) : {};
  const avg = reports.avg_hours_to_close_30d;
  return ok({
    generatedAt: str(d.generated_at),
    users: numbers(d.users, [
      "total",
      "active",
      "suspended",
      "admins",
      "onboarding_complete",
      "new_7d",
      "new_30d",
    ] as const),
    questionnaires: Number(d.questionnaires ?? 0),
    rooms: numbers(d.rooms, [
      "total",
      "draft",
      "active",
      "paused",
      "rented",
      "removed",
      "published_7d",
    ] as const),
    interests: numbers(d.interests, ["total", "last_7d", "with_room"] as const),
    matches: numbers(d.matches, ["total", "last_7d"] as const),
    conversations: numbers(d.conversations, ["open", "closed", "active_7d"] as const),
    messages: numbers(d.messages, ["last_7d", "last_30d"] as const),
    blocks: Number(d.blocks ?? 0),
    reports: {
      ...numbers(d.reports, [
        "pending",
        "in_review",
        "resolved",
        "dismissed",
        "last_7d",
      ] as const),
      avg_hours_to_close_30d: avg === null || avg === undefined ? null : Number(avg),
    },
    adminActions7d: Number(d.admin_actions_7d ?? 0),
  });
}

// ------------------------------------------------------------------
// Acciones
// ------------------------------------------------------------------

const USER_ACTION_FN: Record<AdminUserAction, string> = {
  suspend: "admin_suspend_user",
  reactivate: "admin_reactivate_user",
};
const ROOM_ACTION_FN: Record<AdminRoomAction, string> = {
  remove: "admin_remove_room",
  restore: "admin_restore_room",
};

function parseAction(input: { targetId: unknown; reason: unknown; confirm: unknown }) {
  const parsed = adminActionSchema.safeParse({
    targetId: input.targetId,
    reason: typeof input.reason === "string" ? input.reason : "",
    confirm: input.confirm,
  });
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    (fieldErrors[field] ??= []).push(issue.message);
  }
  if (fieldErrors.targetId) return { ok: false as const, result: fail("not_found") };
  return { ok: false as const, result: fail("validation", fieldErrors) };
}

async function runAction(
  supabase: DbClient,
  fn: string,
  arg: "p_user_id" | "p_room_id",
  input: { targetId: unknown; reason: unknown; confirm: unknown }
): Promise<ServiceResult<{ result: string }>> {
  const parsed = parseAction(input);
  if (!parsed.ok) return parsed.result;
  const admin = await requireActiveAdmin(supabase);
  if (!admin.ok) return admin;
  const { data, error } = await rpc(supabase, fn, {
    [arg]: parsed.data.targetId,
    p_reason: parsed.data.reason,
  });
  if (error) return mapAdminError(error);
  return ok({ result: typeof data === "string" ? data : "" });
}

export function moderateUser(
  supabase: DbClient,
  action: AdminUserAction,
  input: { targetId: unknown; reason: unknown; confirm: unknown }
) {
  return runAction(supabase, USER_ACTION_FN[action], "p_user_id", input);
}

export function moderateRoom(
  supabase: DbClient,
  action: AdminRoomAction,
  input: { targetId: unknown; reason: unknown; confirm: unknown }
) {
  return runAction(supabase, ROOM_ACTION_FN[action], "p_room_id", input);
}

// ------------------------------------------------------------------
// Reportes
// ------------------------------------------------------------------

/**
 * `admin_set_report_status` con una entrada ya validada por `resolveReport`
 * (lib/services/reports.ts): el cambio, la medida y sus registros, en una
 * transacción. Es la única llamada a esa función de la app.
 */
export async function setReportStatusForAdmin(
  supabase: DbClient,
  input: {
    reportId: string;
    status: "in_review" | "resolved" | "dismissed";
    notes: string | null;
    measure: "none" | "suspend_user" | "remove_room";
  }
): Promise<ServiceResult<{ status: "in_review" | "resolved" | "dismissed" }>> {
  const { data, error } = await rpc(supabase, "admin_set_report_status", {
    p_report_id: input.reportId,
    p_status: input.status,
    p_notes: input.notes,
    p_measure: input.measure,
  });
  if (error) return mapAdminError(error);
  return ok({ status: (data as typeof input.status | null) ?? input.status });
}
