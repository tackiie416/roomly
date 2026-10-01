import Link from "next/link";

/**
 * Cabecera global (layout raíz). Estática a propósito (Fase 2.7): no lee la
 * sesión, así que no convierte en dinámicas las páginas públicas ni añade
 * consultas a Supabase en ellas. Por eso tampoco muestra enlaces que dependan
 * de la sesión: «Entrar» está en la página de inicio y la navegación de la
 * aplicación vive en el shell autenticado (`components/app-nav.tsx`, dentro de
 * `app/(app)/layout.tsx`).
 */
export function Nav() {
  return (
    <header className="border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-medium">
          Roomly
        </Link>
      </div>
    </header>
  );
}
