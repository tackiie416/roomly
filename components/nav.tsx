import Link from "next/link";

/**
 * Navegación mínima de Foundation. No refleja todavía estado de sesión
 * (eso llega con el shell autenticado real en Fase 2) — es a propósito
 * simple: un enlace al inicio y uno a login.
 */
export function Nav() {
  return (
    <header className="border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-medium">
          Roomly
        </Link>
        <Link
          href="/login"
          className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          Entrar
        </Link>
      </div>
    </header>
  );
}
