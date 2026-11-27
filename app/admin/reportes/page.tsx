import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { ADMIN_REPORTS_PATH, adminRoomPath, adminUserPath } from "@/lib/admin/paths";
import { listReportsForAdmin } from "@/lib/services/reports";
import { resolveReportAction } from "@/app/actions/admin-reports";
import {
  REPORT_NOTES_MAX_LENGTH,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  type ReportReason,
  type ReportStatusValue,
} from "@/lib/validation/reports";
import { REPORT_MEASURE_LABELS, type ReportMeasure } from "@/lib/validation/admin";
import { Card } from "@/components/ui/card";
import { AdminEmpty, AdminShell } from "@/components/admin/admin-shell";
import { AdminSubmitButton } from "@/components/admin/submit-button";

/**
 * Revisión de reportes (`/admin/reportes`, sesión 83). `requireAdmin()` en la
 * página (no basta el layout, docs/SECURITY.md) y, en la base de datos, la
 * RLS de admin. Muestra lo justo para decidir: motivo, descripción y nombres;
 * nunca emails ni otros datos de contacto. Desde la Fase 7, cada cambio pasa
 * por `admin_set_report_status`: transiciones cerradas, motivo obligatorio al
 * cerrar o reabrir y, al resolver, una medida opcional (suspender la cuenta o
 * retirar la habitación), todo registrado en la misma transacción.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reportes | Roomly",
  robots: { index: false, follow: false },
};

class ReportsUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar los reportes. Vuelve a intentarlo en un momento.");
    this.name = "ReportsUnavailableError";
  }
}

const dateText = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

const reasonText = (reason: string) =>
  Object.hasOwn(REPORT_REASON_LABELS, reason)
    ? REPORT_REASON_LABELS[reason as ReportReason]
    : reason;

const isClosed = (status: ReportStatusValue) =>
  status === "resolved" || status === "dismissed";

/** Transiciones de `admin_set_report_status` (20261129120000). */
function nextStatuses(
  status: ReportStatusValue
): ("in_review" | "resolved" | "dismissed")[] {
  if (status === "pending") return ["in_review", "resolved", "dismissed"];
  if (status === "in_review") return ["resolved", "dismissed"];
  return ["in_review"];
}

function measuresFor(report: { reported: unknown; room: unknown }): ReportMeasure[] {
  return [
    "none",
    ...(report.reported ? (["suspend_user"] as const) : []),
    ...(report.room ? (["remove_room"] as const) : []),
  ];
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const view = query.vista === "cerrados" ? "closed" : "open";
  const result = await listReportsForAdmin(await createClient(), view);
  if (!result.ok) throw new ReportsUnavailableError();

  return (
    <AdminShell
      section="reportes"
      title="Reportes"
      description="La persona reportada nunca ve los reportes. Cada cambio queda registrado con tu cuenta."
      notice={query.aviso}
    >
      <nav aria-label="Vista de reportes" className="flex gap-4 text-sm">
        <Link
          href={ADMIN_REPORTS_PATH}
          aria-current={view === "open" ? "page" : undefined}
          className={view === "open" ? "font-medium" : "underline"}
        >
          Abiertos
        </Link>
        <Link
          href={`${ADMIN_REPORTS_PATH}?vista=cerrados`}
          aria-current={view === "closed" ? "page" : undefined}
          className={view === "closed" ? "font-medium" : "underline"}
        >
          Cerrados
        </Link>
      </nav>

      {result.data.length === 0 ? (
        <AdminEmpty testId="reports-empty">
          {view === "open" ? "No hay reportes abiertos." : "No hay reportes cerrados."}
        </AdminEmpty>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="reports-list">
          {result.data.map((report) => (
            <li key={report.id}>
              <Card className="flex flex-col gap-3" data-testid="report-item">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-medium">{reasonText(report.reason)}</h2>
                  <span className="text-xs text-[var(--muted)]">
                    {REPORT_STATUS_LABELS[report.status]} · {dateText(report.createdAt)}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-[var(--muted)]">Reportada</dt>
                  <dd data-testid="report-reported">
                    {report.reported ? (
                      <Link
                        href={adminUserPath(report.reported.id)}
                        className="underline"
                      >
                        {`${report.reported.name ?? "Sin nombre"}${report.reported.deactivated ? " (cuenta desactivada)" : ""}`}
                      </Link>
                    ) : report.room ? (
                      <Link href={adminRoomPath(report.room.id)} className="underline">
                        {`Habitación: ${report.room.title ?? "no disponible"}`}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                  <dt className="text-[var(--muted)]">Reporta</dt>
                  <dd>
                    <Link href={adminUserPath(report.reporter.id)} className="underline">
                      {report.reporter.name ?? "Sin nombre"}
                    </Link>
                  </dd>
                  {report.resolvedAt ? (
                    <>
                      <dt className="text-[var(--muted)]">Cerrado</dt>
                      <dd>{dateText(report.resolvedAt)}</dd>
                    </>
                  ) : null}
                </dl>
                {report.description ? (
                  <p className="whitespace-pre-line break-words rounded-[var(--radius)] bg-[var(--surface)] p-2 text-sm">
                    {report.description}
                  </p>
                ) : (
                  <p className="text-sm text-[var(--muted)]">Sin descripción.</p>
                )}
                {report.resolutionNotes ? (
                  <p className="text-sm">
                    <span className="text-[var(--muted)]">Notas de la resolución: </span>
                    <span className="whitespace-pre-line break-words">
                      {report.resolutionNotes}
                    </span>
                  </p>
                ) : null}
                <form action={resolveReportAction} className="flex flex-col gap-2">
                  <input type="hidden" name="reportId" value={report.id} />
                  <label className="text-sm font-medium" htmlFor={`status-${report.id}`}>
                    Estado
                  </label>
                  <select
                    id={`status-${report.id}`}
                    name="status"
                    defaultValue={nextStatuses(report.status)[0]}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                  >
                    {nextStatuses(report.status).map((status) => (
                      <option key={status} value={status}>
                        {status === "in_review" && isClosed(report.status)
                          ? "Reabrir (en revisión)"
                          : REPORT_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  {isClosed(report.status) ? null : (
                    <>
                      <label
                        className="text-sm font-medium"
                        htmlFor={`measure-${report.id}`}
                      >
                        Medida (solo al resolver)
                      </label>
                      <select
                        id={`measure-${report.id}`}
                        name="measure"
                        defaultValue="none"
                        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                      >
                        {measuresFor(report).map((measure) => (
                          <option key={measure} value={measure}>
                            {REPORT_MEASURE_LABELS[measure]}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <label className="text-sm font-medium" htmlFor={`notes-${report.id}`}>
                    Motivo o notas internas (obligatorio al resolver, descartar o reabrir)
                  </label>
                  <textarea
                    id={`notes-${report.id}`}
                    name="notes"
                    rows={2}
                    maxLength={REPORT_NOTES_MAX_LENGTH}
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                  />
                  <div>
                    <AdminSubmitButton>Guardar</AdminSubmitButton>
                  </div>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
