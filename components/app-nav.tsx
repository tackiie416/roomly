import { SignOutButton } from "@/components/auth/sign-out-button";
import { AppNavLinks } from "@/components/app-nav-links";

/**
 * Navegación del shell autenticado (Fase 2.7), en `app/(app)/layout.tsx`.
 * Solo enlaza a rutas que existen y que el usuario de la sesión puede abrir
 * (las tres admiten perfil incompleto y completo): nada de rutas futuras. No
 * muestra datos del perfil y no hace consultas: el layout ya ha resuelto el
 * estado. «Cerrar sesión» es el `SignOutButton` de 2.2 (`signOut`).
 */
export const APP_NAV_LINKS = [
  { href: "/perfil", label: "Perfil" },
  { href: "/preferencias", label: "Preferencias" },
  { href: "/ajustes", label: "Ajustes" },
] as const;

export function AppNav() {
  return (
    <nav
      aria-label="Tu cuenta"
      className="border-b border-[var(--border)] bg-[var(--background)]"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <AppNavLinks links={APP_NAV_LINKS} />
        <SignOutButton />
      </div>
    </nav>
  );
}
