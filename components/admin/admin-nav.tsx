import Link from "next/link";
import {
  ADMIN_METRICS_PATH,
  ADMIN_PATH,
  ADMIN_REPORTS_PATH,
  ADMIN_ROOMS_PATH,
  ADMIN_USERS_PATH,
} from "@/lib/admin/paths";

export type AdminSection =
  "resumen" | "usuarios" | "habitaciones" | "reportes" | "metricas";

const LINKS: { section: AdminSection; href: string; label: string }[] = [
  { section: "resumen", href: ADMIN_PATH, label: "Resumen" },
  { section: "usuarios", href: ADMIN_USERS_PATH, label: "Usuarios" },
  { section: "habitaciones", href: ADMIN_ROOMS_PATH, label: "Habitaciones" },
  { section: "reportes", href: ADMIN_REPORTS_PATH, label: "Reportes" },
  { section: "metricas", href: ADMIN_METRICS_PATH, label: "Métricas" },
];

/**
 * Navegación del panel (Fase 7). Solo enlaces: no decide accesos (cada
 * página llama a `requireAdmin()` y la base de datos comprueba `is_admin()`).
 */
export function AdminNav({ current }: { current: AdminSection }) {
  return (
    <nav aria-label="Administración" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 text-sm">
        {LINKS.map((link) => (
          <li key={link.section}>
            <Link
              href={link.href}
              aria-current={link.section === current ? "page" : undefined}
              data-testid={`admin-nav-${link.section}`}
              className={
                link.section === current
                  ? "block rounded-[var(--radius)] bg-[var(--surface)] px-3 py-2 font-medium"
                  : "block rounded-[var(--radius)] px-3 py-2 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              }
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
