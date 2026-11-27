import "server-only";

import { type InterestsDeps, knownCounterpart } from "@/lib/services/interests";
import { setReportStatusForAdmin } from "@/lib/services/admin";
import {
  type DbClient,
  type ServiceResult,
  fail,
  getSessionUserId,
  mapDbError,
  ok,
} from "@/lib/services/result";
import {
  type ReportReason,
  type ReportStatusValue,
  reportInputSchema,
  reportResolutionSchema,
} from "@/lib/validation/reports";

/**
 * Reportes de usuarios (sesión 83). Sin service_role: quien reporta inserta
 * con su cliente (GRANT por columnas y `reports_insert_own`), y un admin lee
 * con el suyo (`reports_admin_select`) y resuelve con `admin_set_report_status`. La base de datos
 * (20261128120000) aplica los motivos, la longitud, un reporte abierto por
 * persona, 10 en 24 h y la resolución con la cuenta propia del admin. La
 * persona reportada nunca ve el reporte (RLS: solo quien lo hizo y un admin).
 *
 * Solo se puede reportar a alguien que ya conoces por la app
 * (`knownCounterpart`): un id cualquiera da `not_found`.
 */

export type ReportStatus = "created" | "duplicate";

const CONTENT_RULES = [
  {
    code: "23514",
    match: "chk_reports_description_length",
    field: "description",
    message: "La descripción es demasiado larga.",
  },
  {
    code: "23514",
    match: "chk_reports_reason",
    field: "reason",
    message: "Elige un motivo.",
  },
];

export async function reportUser(
  supabase: DbClient,
  input: { targetId: unknown; reason: unknown; description: unknown },
  deps?: InterestsDeps
): Promise<ServiceResult<{ status: ReportStatus }>> {
  const parsed = reportInputSchema.safeParse({
    targetId: input.targetId,
    reason: input.reason,
    description: typeof input.description === "string" ? input.description : "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      (fieldErrors[field] ??= []).push(issue.message);
    }
    // Un id no válido no se distingue de uno que no conoces.
    if (fieldErrors.targetId) return fail("not_found");
    return fail("validation", fieldErrors);
  }

  const known = await knownCounterpart(supabase, parsed.data.targetId, deps);
  if (!known.ok) return known;

  const { error } = await supabase.from("reports").insert({
    reporter_id: known.data.userId,
    reported_user_id: known.data.targetId,
    reason: parsed.data.reason,
    description: parsed.data.description,
  });
  if (error) {
    const message = error.message ?? "";
    if (error.code === "23505" && message.includes("uq_reports_open_user"))
      return ok({ status: "duplicate" });
    if (message.includes("rate_limit_exceeded")) return fail("rate_limited");
    if (message.includes("report_invalid")) return fail("deleted");
    return mapDbError(error, CONTENT_RULES);
  }
  return ok({ status: "created" });
}

// ------------------------------------------------------------------
// Revisión (admin)
// ------------------------------------------------------------------

export type AdminReport = {
  id: string;
  reason: ReportReason | string;
  description: string | null;
  status: ReportStatusValue;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  reporter: { id: string; name: string | null };
  reported: { id: string; name: string | null; deactivated: boolean } | null;
  room: { id: string; title: string | null } | null;
};

type ReportRow = {
  id: string;
  reporter_id: string;
  reported_user_id: string | null;
  reported_room_id: string | null;
  reason: string;
  description: string | null;
  status: ReportStatusValue;
  created_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
};

export const ADMIN_REPORTS_LIMIT = 50;

/** Admin activo: la RLS lo exige también (is_admin()), esto es la segunda capa. */
async function adminId(supabase: DbClient): Promise<ServiceResult<string>> {
  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!data || data.deleted_at !== null || data.role !== "admin")
    return fail("forbidden");
  return ok(userId);
}

/**
 * Reportes para `/admin/reportes`: los abiertos (pendientes y en revisión)
 * o los cerrados, los más antiguos primero entre los abiertos. Nombres de
 * las personas y títulos de las habitaciones con la RLS de admin, en dos
 * consultas (sin N+1). Sin email ni otros datos de contacto.
 */
export async function listReportsForAdmin(
  supabase: DbClient,
  view: "open" | "closed"
): Promise<ServiceResult<AdminReport[]>> {
  const admin = await adminId(supabase);
  if (!admin.ok) return admin;

  const statuses: ReportStatusValue[] =
    view === "open" ? ["pending", "in_review"] : ["resolved", "dismissed"];
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, reporter_id, reported_user_id, reported_room_id, reason, description, status, created_at, resolved_at, resolution_notes"
    )
    .in("status", statuses)
    .order("created_at", { ascending: view === "open" })
    .limit(ADMIN_REPORTS_LIMIT);
  if (error) return mapDbError(error);
  const rows = (data ?? []) as ReportRow[];

  const people = [
    ...new Set(
      rows.flatMap((r) => [
        r.reporter_id,
        ...(r.reported_user_id ? [r.reported_user_id] : []),
      ])
    ),
  ];
  const roomIds = [
    ...new Set(rows.flatMap((r) => (r.reported_room_id ? [r.reported_room_id] : []))),
  ];
  const [profilesRead, roomsRead] = await Promise.all([
    people.length
      ? supabase.from("profiles").select("id, full_name, deleted_at").in("id", people)
      : Promise.resolve({ data: [], error: null }),
    roomIds.length
      ? supabase.from("rooms").select("id, title").in("id", roomIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesRead.error) return mapDbError(profilesRead.error);
  if (roomsRead.error) return mapDbError(roomsRead.error);
  const profiles = new Map(
    (
      (profilesRead.data ?? []) as {
        id: string;
        full_name: string;
        deleted_at: string | null;
      }[]
    ).map((p) => [p.id, p])
  );
  const rooms = new Map(
    ((roomsRead.data ?? []) as { id: string; title: string }[]).map((r) => [
      r.id,
      r.title,
    ])
  );

  return ok(
    rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolutionNotes: r.resolution_notes,
      reporter: {
        id: r.reporter_id,
        name: profiles.get(r.reporter_id)?.full_name ?? null,
      },
      reported: r.reported_user_id
        ? {
            id: r.reported_user_id,
            name: profiles.get(r.reported_user_id)?.full_name ?? null,
            deactivated: profiles.get(r.reported_user_id)?.deleted_at != null,
          }
        : null,
      room: r.reported_room_id
        ? { id: r.reported_room_id, title: rooms.get(r.reported_room_id) ?? null }
        : null,
    }))
  );
}

/**
 * Cambia el estado de un reporte con `admin_set_report_status`
 * (20261129120000): el cambio, la medida opcional (suspender a la persona o
 * retirar la habitación) y sus registros en `admin_action_logs` van en una
 * sola transacción. La autoría sale del JWT (`auth.uid()`), nunca del input.
 * Sin service_role: la función comprueba `is_admin()`.
 */
export async function resolveReport(
  supabase: DbClient,
  input: { reportId: unknown; status: unknown; notes: unknown; measure?: unknown }
): Promise<ServiceResult<{ status: ReportStatusValue }>> {
  const parsed = reportResolutionSchema.safeParse({
    reportId: input.reportId,
    status: input.status,
    measure:
      input.measure === undefined || input.measure === "" ? undefined : input.measure,
    notes: typeof input.notes === "string" ? input.notes : "",
  });
  if (!parsed.success) return fail("validation");
  const admin = await adminId(supabase);
  if (!admin.ok) return admin;

  return setReportStatusForAdmin(supabase, parsed.data);
}
