import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { getRoomForAdmin } from "@/lib/services/admin";
import { moderateRoomAction } from "@/app/actions/admin";
import { ADMIN_REPORTS_PATH, ADMIN_ROOMS_PATH, adminUserPath } from "@/lib/admin/paths";
import { adminDateText, adminDayText, labelOr } from "@/lib/admin/format";
import { ROOM_STATUS_LABELS } from "@/lib/validation/rooms";
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS } from "@/lib/validation/reports";
import { AdminBadge, AdminEmpty, AdminShell } from "@/components/admin/admin-shell";
import { AdminHistory } from "@/components/admin/admin-history";
import { ConfirmActionForm } from "@/components/admin/confirm-action-form";

/**
 * Ficha de una habitación (`/admin/habitaciones/<id>`, Fase 7): el contenido
 * del anuncio, su estado, la propietaria, los reportes y el historial, con
 * retirar o restaurar. Nunca la dirección exacta ni las coordenadas. Un id
 * desconocido o no válido da 404.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Habitación | Administración | Roomly",
  robots: { index: false, follow: false },
};

class AdminUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar la habitación. Vuelve a intentarlo en un momento.");
    this.name = "AdminUnavailableError";
  }
}

const priceText = (value: number) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);

function TextBlock({ title, text }: { title: string; text: string | null }) {
  return (
    <>
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      {text ? (
        <p className="mt-1 whitespace-pre-line break-words rounded-[var(--radius)] bg-[var(--surface)] p-2 text-sm">
          {text}
        </p>
      ) : (
        <p className="mt-1 text-sm text-[var(--muted)]">Sin texto.</p>
      )}
    </>
  );
}

export default async function AdminRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const result = await getRoomForAdmin(await createClient(), id);
  if (!result.ok) {
    if (result.error === "not_found") notFound();
    throw new AdminUnavailableError();
  }
  const room = result.data;
  const removed = room.status === "removed";

  return (
    <AdminShell section="habitaciones" title={room.title} notice={query.aviso}>
      <p className="text-sm">
        <Link href={ADMIN_ROOMS_PATH} className="underline">
          ← Volver a habitaciones
        </Link>
      </p>
      <div className="flex flex-wrap gap-1">
        <AdminBadge
          tone={removed ? "danger" : room.status === "active" ? "ok" : "neutral"}
        >
          <span data-testid="admin-room-status">
            {labelOr(ROOM_STATUS_LABELS, room.status)}
          </span>
        </AdminBadge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-4">
            <h2 className="mb-2 font-medium">Anuncio</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-[var(--muted)]">Zona</dt>
              <dd>
                {[room.neighborhoodName, room.cityName].filter(Boolean).join(", ") ||
                  "Sin zona"}
              </dd>
              <dt className="text-[var(--muted)]">Precio</dt>
              <dd>{priceText(room.priceMonth)} al mes</dd>
              <dt className="text-[var(--muted)]">Fotos</dt>
              <dd>{room.imagesCount}</dd>
              <dt className="text-[var(--muted)]">Propietaria</dt>
              <dd>
                {room.owner ? (
                  <Link href={adminUserPath(room.owner.id)} className="underline">
                    {room.owner.fullName}
                    {room.owner.deactivated ? " (cuenta desactivada)" : ""}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-[var(--muted)]">Creada</dt>
              <dd>{adminDateText(room.createdAt)}</dd>
              <dt className="text-[var(--muted)]">Publicada</dt>
              <dd>{adminDateText(room.publishedAt)}</dd>
              <dt className="text-[var(--muted)]">Última edición</dt>
              <dd>{adminDateText(room.updatedAt)}</dd>
            </dl>
            <TextBlock title="Descripción" text={room.description} />
            <TextBlock title="Normas de la casa" text={room.houseRules} />
            <TextBlock
              title="Preferencias de convivencia"
              text={room.roommatePreferences}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Reportes sobre esta habitación</h2>
            {room.reports.length === 0 ? (
              <AdminEmpty testId="admin-room-reports-empty">Ningún reporte.</AdminEmpty>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="admin-room-reports">
                {room.reports.map((report) => (
                  <li
                    key={report.id}
                    className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>{labelOr(REPORT_REASON_LABELS, report.reason)}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {labelOr(REPORT_STATUS_LABELS, report.status)} ·{" "}
                        {adminDayText(report.createdAt)}
                      </span>
                    </div>
                    {report.description ? (
                      <p className="mt-1 whitespace-pre-line break-words">
                        {report.description}
                      </p>
                    ) : null}
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

          <AdminHistory entries={room.history} />
        </div>

        <aside className="flex flex-col gap-4">
          {removed ? (
            <ConfirmActionForm
              action={moderateRoomAction}
              targetId={room.id}
              actionName="restore"
              title="Restaurar la habitación"
              explanation="Vuelve a estar en manos de su propietaria, en estado pausada: no será pública hasta que ella la publique de nuevo."
              confirmLabel="Confirmo que quiero restaurar esta habitación."
              submitLabel="Restaurar habitación"
              testId="admin-restore-form"
            />
          ) : (
            <ConfirmActionForm
              action={moderateRoomAction}
              targetId={room.id}
              actionName="remove"
              title="Retirar la habitación"
              explanation="Deja de ser pública al instante y su propietaria no puede volver a publicarla. Se puede restaurar."
              confirmLabel="Confirmo que quiero retirar esta habitación."
              submitLabel="Retirar habitación"
              danger
              testId="admin-remove-form"
            />
          )}
        </aside>
      </div>
    </AdminShell>
  );
}
