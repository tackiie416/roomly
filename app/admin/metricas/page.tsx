import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { getAdminMetrics } from "@/lib/services/admin";
import { adminDateText } from "@/lib/admin/format";
import { AdminShell } from "@/components/admin/admin-shell";
import { MetricGroup } from "@/components/admin/metric-tiles";

/**
 * `/admin/metricas` (Fase 7): recuentos agregados de `admin_metrics`. Solo
 * totales y recuentos por periodo: ninguna fila de una persona, ningún
 * contenido de mensajes y ningún tracker (la analítica de producto, PostHog,
 * sigue siendo de la Fase 9).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Métricas | Administración | Roomly",
  robots: { index: false, follow: false },
};

class AdminUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar las métricas. Vuelve a intentarlo en un momento.");
    this.name = "AdminUnavailableError";
  }
}

const n = (value: number) => new Intl.NumberFormat("es-ES").format(value);
const pct = (part: number, total: number) =>
  total > 0 ? `${Math.round((part / total) * 100)} %` : "—";

export default async function AdminMetricsPage() {
  await requireAdmin();
  const result = await getAdminMetrics(await createClient());
  if (!result.ok) throw new AdminUnavailableError();
  const m = result.data;

  return (
    <AdminShell
      section="metricas"
      title="Métricas"
      description={`Datos agregados, sin información de personas concretas. Calculados el ${adminDateText(m.generatedAt)}.`}
    >
      <MetricGroup
        title="Usuarios"
        testId="metrics-users"
        items={[
          { label: "Cuentas", value: n(m.users.total) },
          { label: "Activas", value: n(m.users.active) },
          { label: "Suspendidas o desactivadas", value: n(m.users.suspended) },
          {
            label: "Perfil completo",
            value: n(m.users.onboarding_complete),
            hint: pct(m.users.onboarding_complete, m.users.total),
          },
          { label: "Con test guardado", value: n(m.questionnaires) },
          { label: "Altas (7 días)", value: n(m.users.new_7d) },
          { label: "Altas (30 días)", value: n(m.users.new_30d) },
          { label: "Administración", value: n(m.users.admins) },
        ]}
      />
      <MetricGroup
        title="Habitaciones"
        testId="metrics-rooms"
        items={[
          { label: "Total", value: n(m.rooms.total) },
          { label: "Publicadas", value: n(m.rooms.active) },
          { label: "Borradores", value: n(m.rooms.draft) },
          { label: "Pausadas", value: n(m.rooms.paused) },
          { label: "Alquiladas", value: n(m.rooms.rented) },
          { label: "Retiradas", value: n(m.rooms.removed) },
          { label: "Publicadas (7 días)", value: n(m.rooms.published_7d) },
        ]}
      />
      <MetricGroup
        title="Actividad"
        testId="metrics-activity"
        items={[
          { label: "Intereses vigentes", value: n(m.interests.total) },
          { label: "Intereses (7 días)", value: n(m.interests.last_7d) },
          { label: "Intereses por habitación", value: n(m.interests.with_room) },
          { label: "Matches vigentes", value: n(m.matches.total) },
          { label: "Matches (7 días)", value: n(m.matches.last_7d) },
          { label: "Chats abiertos", value: n(m.conversations.open) },
          { label: "Chats con actividad (7 días)", value: n(m.conversations.active_7d) },
          { label: "Mensajes (7 días)", value: n(m.messages.last_7d) },
          { label: "Mensajes (30 días)", value: n(m.messages.last_30d) },
        ]}
      />
      <MetricGroup
        title="Confianza y seguridad"
        testId="metrics-safety"
        items={[
          { label: "Reportes pendientes", value: n(m.reports.pending) },
          { label: "En revisión", value: n(m.reports.in_review) },
          { label: "Resueltos", value: n(m.reports.resolved) },
          { label: "Descartados", value: n(m.reports.dismissed) },
          { label: "Reportes (7 días)", value: n(m.reports.last_7d) },
          {
            label: "Horas hasta cerrar",
            value:
              m.reports.avg_hours_to_close_30d === null
                ? "—"
                : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(
                    m.reports.avg_hours_to_close_30d
                  ),
            hint: "media, cerrados en 30 días",
          },
          { label: "Bloqueos vigentes", value: n(m.blocks) },
          { label: "Acciones de administración (7 días)", value: n(m.adminActions7d) },
        ]}
      />
    </AdminShell>
  );
}
