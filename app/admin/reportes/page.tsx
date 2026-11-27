import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { ADMIN_REPORTS_PATH } from "@/lib/admin/paths";
import { listReportsForAdmin } from "@/lib/services/reports";
import { resolveReportAction } from "@/app/actions/admin-reports";
import {
  REPORT_NOTES_MAX_LENGTH,
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  type ReportReason,
} from "@/lib/validation/reports";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Revisión de reportes (`/admin/reportes`, sesión 83). `requireAdmin()` en la
 * página (no basta el layout, docs/SECURITY.md) y, en la base de datos, la
 * RLS de admin. Muestra lo justo para decidir: motivo, descripción y nombres;
 * nunca emails ni otros datos de contacto. Las acciones sobre la cuenta
 * reportada (desactivarla) son de la Fase 7 y no están aquí.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reportes | Roomly",
  robots: { index: false, follow: false },
};

const NOTICES: Record<string, string> = {
  guardado: "Reporte actualizado.",
  invalido: "Revisa el estado y las notas.",
  error: "No hemos podido actualizar el reporte. Vuelve a intentarlo.",
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
  const noticeKey = Array.isArray(query.aviso) ? query.aviso[0] : query.aviso;
  const notice =
    noticeKey && Object.hasOwn(NOTICES, noticeKey) ? NOTICES[noticeKey] : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:p-8">
      <p className="text-sm">
        <Link href="/admin" className="underline">
          ← Panel de administración
        </Link>
      </p>
      <h1 className="text-2xl font-medium">Reportes</h1>
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
      {notice ? (
        <p
          role="status"
          data-testid="admin-notice"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {result.data.length === 0 ? (
        <p className="text-sm text-[var(--muted)]" data-testid="reports-empty">
          {view === "open" ? "No hay reportes abiertos." : "No hay reportes cerrados."}
        </p>
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
                    {report.reported
                      ? `${report.reported.name ?? "Sin nombre"}${report.reported.deactivated ? " (cuenta desactivada)" : ""}`
                      : report.room
                        ? `Habitación: ${report.room.title ?? "no disponible"}`
                        : "—"}
                  </dd>
                  <dt className="text-[var(--muted)]">Reporta</dt>
                  <dd>{report.reporter.name ?? "Sin nombre"}</dd>
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
                <form action={resolveReportAction} className="flex flex-col gap-2">
                  <input type="hidden" name="reportId" value={report.id} />
                  <label className="text-sm font-medium" htmlFor={`status-${report.id}`}>
                    Estado
                  </label>
                  <select
                    id={`status-${report.id}`}
                    name="status"
                    defaultValue={report.status}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                  >
                    {REPORT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {REPORT_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <label className="text-sm font-medium" htmlFor={`notes-${report.id}`}>
                    Notas internas (opcional)
                  </label>
                  <textarea
                    id={`notes-${report.id}`}
                    name="notes"
                    rows={2}
                    maxLength={REPORT_NOTES_MAX_LENGTH}
                    defaultValue={report.resolutionNotes ?? ""}
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                  />
                  <div>
                    <Button type="submit" variant="secondary">
                      Guardar
                    </Button>
                  </div>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
