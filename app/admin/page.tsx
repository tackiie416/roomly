import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { getAdminMetrics } from "@/lib/services/admin";
import {
  ADMIN_METRICS_PATH,
  ADMIN_REPORTS_PATH,
  ADMIN_ROOMS_PATH,
  ADMIN_USERS_PATH,
} from "@/lib/admin/paths";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * El guard va también aquí, no solo en el layout: Next.js renderiza layout y
 * página en paralelo, y si solo redirige el layout, el contenido de la página
 * viaja igualmente en el cuerpo de la respuesta 307 (comprobado en la Fase
 * 2.2). Toda página de /admin debe llamar a `requireAdmin()` antes de cargar
 * o renderizar nada (ver docs/SECURITY.md).
 *
 * Fase 7: resumen con lo que pide atención (reportes abiertos) y accesos a
 * cada sección. Si las métricas no cargan, el resumen sigue funcionando.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Administración | Roomly",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  {
    href: ADMIN_REPORTS_PATH,
    title: "Reportes",
    text: "Revisa, resuelve o descarta reportes y aplica medidas.",
    testId: "admin-reports-link",
  },
  {
    href: ADMIN_USERS_PATH,
    title: "Usuarios",
    text: "Busca cuentas, consulta su estado y suspende o reactiva.",
    testId: "admin-users-link",
  },
  {
    href: ADMIN_ROOMS_PATH,
    title: "Habitaciones",
    text: "Revisa anuncios en cualquier estado, retira o restaura.",
    testId: "admin-rooms-link",
  },
  {
    href: ADMIN_METRICS_PATH,
    title: "Métricas",
    text: "Actividad y estado del producto, solo agregados.",
    testId: "admin-metrics-link",
  },
];

export default async function AdminPage() {
  await requireAdmin();
  const metrics = await getAdminMetrics(await createClient());
  const open = metrics.ok
    ? metrics.data.reports.pending + metrics.data.reports.in_review
    : null;

  return (
    <AdminShell section="resumen" title="Panel de administración">
      {open === null ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          No hemos podido cargar el resumen. Las secciones siguen disponibles.
        </p>
      ) : (
        <p
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
          data-testid="admin-open-reports"
        >
          {open === 0 ? (
            "No hay reportes abiertos."
          ) : (
            <>
              <strong>{open}</strong>{" "}
              {open === 1 ? "reporte abierto" : "reportes abiertos"}.{" "}
              <Link href={ADMIN_REPORTS_PATH} className="underline">
                Revisarlos
              </Link>
            </>
          )}
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              data-testid={section.testId}
              className="flex h-full flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--border)] p-4 hover:bg-[var(--surface)]"
            >
              <span className="font-medium">{section.title}</span>
              <span className="text-sm text-[var(--muted)]">{section.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}
