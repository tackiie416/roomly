import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { getUserForAdmin } from "@/lib/services/admin";
import { moderateUserAction } from "@/app/actions/admin";
import { ADMIN_REPORTS_PATH, ADMIN_USERS_PATH, adminRoomPath } from "@/lib/admin/paths";
import {
  SEEKING_STATUS_LABELS,
  adminDateText,
  adminDayText,
  labelOr,
} from "@/lib/admin/format";
import { ROOM_STATUS_LABELS } from "@/lib/validation/rooms";
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS } from "@/lib/validation/reports";
import { AdminBadge, AdminEmpty, AdminShell } from "@/components/admin/admin-shell";
import { AdminHistory } from "@/components/admin/admin-history";
import { ConfirmActionForm } from "@/components/admin/confirm-action-form";

/**
 * Ficha de una cuenta (`/admin/usuarios/<id>`, Fase 7). Un id que no existe
 * o no es un UUID da 404. Muestra lo necesario para moderar: nombre, bio,
 * estado, habitaciones, reportes recibidos, cuántas veces la han bloqueado
 * (nunca quién) e historial. Nunca email, fecha de nacimiento, presupuestos,
 * respuestas del test ni mensajes.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cuenta | Administración | Roomly",
  robots: { index: false, follow: false },
};

class AdminUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar la cuenta. Vuelve a intentarlo en un momento.");
    this.name = "AdminUnavailableError";
  }
}

export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const result = await getUserForAdmin(await createClient(), id);
  if (!result.ok) {
    if (result.error === "not_found") notFound();
    throw new AdminUnavailableError();
  }
  const user = result.data;
  const isSelf = user.isSelf;
  const suspended = user.deactivatedAt !== null;

  return (
    <AdminShell section="usuarios" title={user.fullName} notice={query.aviso}>
      <p className="text-sm">
        <Link href={ADMIN_USERS_PATH} className="underline">
          ← Volver a usuarios
        </Link>
      </p>
      <div className="flex flex-wrap gap-1" data-testid="admin-user-badges">
        {user.role === "admin" ? <AdminBadge>Administración</AdminBadge> : null}
        {suspended ? (
          <AdminBadge tone="danger">
            {user.suspendedByAdmin ? "Suspendida por administración" : "Desactivada"}
          </AdminBadge>
        ) : (
          <AdminBadge tone="ok">Activa</AdminBadge>
        )}
        {user.deletionRequestedAt ? (
          <AdminBadge tone="danger">Eliminación pendiente</AdminBadge>
        ) : null}
        {user.onboardingCompletedAt ? null : (
          <AdminBadge>Perfil sin completar</AdminBadge>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-4">
            <h2 className="mb-2 font-medium">Datos de la cuenta</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-[var(--muted)]">Busca</dt>
              <dd>{labelOr(SEEKING_STATUS_LABELS, user.seekingStatus)}</dd>
              <dt className="text-[var(--muted)]">Alta</dt>
              <dd>{adminDateText(user.createdAt)}</dd>
              <dt className="text-[var(--muted)]">Perfil completo</dt>
              <dd>
                {user.onboardingCompletedAt
                  ? adminDayText(user.onboardingCompletedAt)
                  : "No"}
              </dd>
              {suspended ? (
                <>
                  <dt className="text-[var(--muted)]">Desactivada</dt>
                  <dd>{adminDateText(user.deactivatedAt)}</dd>
                </>
              ) : null}
              <dt className="text-[var(--muted)]">Test de convivencia</dt>
              <dd>
                {user.hasQuestionnaire ? "Con respuestas guardadas" : "Sin empezar"}
              </dd>
              <dt className="text-[var(--muted)]">Matches</dt>
              <dd>{user.matchesCount}</dd>
              <dt className="text-[var(--muted)]">Bloqueada por</dt>
              <dd data-testid="admin-user-blocked-by">
                {user.blockedByCount === 1
                  ? "1 persona"
                  : `${user.blockedByCount} personas`}
              </dd>
              <dt className="text-[var(--muted)]">Reportes hechos</dt>
              <dd>{user.reportsMadeCount}</dd>
            </dl>
            <h3 className="mt-4 text-sm font-medium">Sobre mí</h3>
            {user.bio ? (
              <p className="mt-1 whitespace-pre-line break-words rounded-[var(--radius)] bg-[var(--surface)] p-2 text-sm">
                {user.bio}
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--muted)]">Sin texto.</p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Reportes recibidos</h2>
            {user.reportsReceived.length === 0 ? (
              <AdminEmpty testId="admin-user-reports-empty">Ningún reporte.</AdminEmpty>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="admin-user-reports">
                {user.reportsReceived.map((report) => (
                  <li
                    key={report.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
                  >
                    <span>
                      {labelOr(REPORT_REASON_LABELS, report.reason)}
                      {report.roomId ? " (sobre su habitación)" : ""}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {labelOr(REPORT_STATUS_LABELS, report.status)} ·{" "}
                      {adminDayText(report.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm">
              <Link href={ADMIN_REPORTS_PATH} className="underline">
                Ir a la bandeja de reportes
              </Link>
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Habitaciones</h2>
            {user.rooms.length === 0 ? (
              <AdminEmpty>Ninguna habitación.</AdminEmpty>
            ) : (
              <ul className="flex flex-col gap-2">
                {user.rooms.map((room) => (
                  <li key={room.id}>
                    <Link
                      href={adminRoomPath(room.id)}
                      className="flex flex-wrap justify-between gap-2 rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm hover:bg-[var(--surface)]"
                    >
                      <span className="font-medium">{room.title}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {labelOr(ROOM_STATUS_LABELS, room.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AdminHistory entries={user.history} />
        </div>

        <aside className="flex flex-col gap-4">
          {isSelf ? (
            <p className="text-sm text-[var(--muted)]">
              Es tu propia cuenta: no hay acciones.
            </p>
          ) : user.role === "admin" ? (
            <p className="text-sm text-[var(--muted)]">
              Las cuentas de administración no se suspenden desde el panel.
            </p>
          ) : !suspended ? (
            <ConfirmActionForm
              action={moderateUserAction}
              targetId={user.id}
              actionName="suspend"
              title="Suspender la cuenta"
              explanation="La persona no podrá usar Roomly: no aparecerá en Explorar, sus habitaciones dejarán de ser públicas y no podrá enviar mensajes ni intereses. Se puede reactivar."
              confirmLabel="Confirmo que quiero suspender esta cuenta."
              submitLabel="Suspender cuenta"
              danger
              testId="admin-suspend-form"
            />
          ) : user.deletionRequestedAt ? (
            <p
              className="text-sm text-[var(--muted)]"
              data-testid="admin-deletion-pending"
            >
              La persona ha pedido eliminar su cuenta y la eliminación no ha terminado: no
              se puede reactivar. Se completará cuando vuelva a pedirla.
            </p>
          ) : user.suspendedByAdmin ? (
            <ConfirmActionForm
              action={moderateUserAction}
              targetId={user.id}
              actionName="reactivate"
              title="Reactivar la cuenta"
              explanation="La cuenta vuelve a funcionar con normalidad. Sus habitaciones siguen en el estado en que estaban."
              confirmLabel="Confirmo que quiero reactivar esta cuenta."
              submitLabel="Reactivar cuenta"
              testId="admin-reactivate-form"
            />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Esta cuenta se desactivó por otra vía: no se reactiva desde el panel.
            </p>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}
