import { requireAdmin } from "@/lib/auth/session";

/**
 * El guard va también aquí, no solo en el layout: Next.js renderiza layout y
 * página en paralelo, y si solo redirige el layout, el contenido de la página
 * viaja igualmente en el cuerpo de la respuesta 307 (comprobado en la Fase
 * 2.2). Toda página de /admin debe llamar a `requireAdmin()` antes de cargar
 * o renderizar nada (ver docs/SECURITY.md).
 */
export default async function AdminPage() {
  await requireAdmin();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-medium">Panel de administración</h1>
      <p className="mt-2 text-[var(--muted)]">
        Foundation lista: si ves esto, la protección de ruta (sesión + rol de
        administrador) funciona. Usuarios, habitaciones, reportes y métricas llegan en la
        Fase 7.
      </p>
    </main>
  );
}
