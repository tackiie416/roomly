import { requireAdmin } from "@/lib/auth/session";

/**
 * Segunda capa de protección de /admin (la primera, "hay sesión?", vive en
 * proxy.ts). `requireAdmin` exige rol admin **y** cuenta no eliminada: un
 * admin con `deleted_at` no entra, aunque su fila siga teniendo
 * `role = 'admin'`. Nunca basta con "está logueado" ni solo con el rol. Es
 * una protección de routing/UI: en la base de datos, `is_admin()` sigue
 * siendo la defensa de los datos (ver docs/SECURITY.md).
 *
 * El layout NO basta por sí solo: Next.js renderiza las páginas en paralelo
 * con el layout, así que cada página de /admin llama también a
 * `requireAdmin()` (la consulta se comparte gracias a `cache()`).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return <div className="min-h-[calc(100vh-65px)]">{children}</div>;
}
