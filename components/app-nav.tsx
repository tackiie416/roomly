import { SignOutButton } from "@/components/auth/sign-out-button";
import { AppNavLinks } from "@/components/app-nav-links";

/**
 * Navegación del shell autenticado (Fase 2.7), en `app/(app)/layout.tsx`.
 * Solo enlaza a rutas que existen: nada de rutas futuras. `/perfil`,
 * `/preferencias` y `/ajustes` admiten perfil incompleto y completo; `/test`
 * y `/explorar` (Fase 3.5) exigen el onboarding completo y su guard lleva a
 * donde toque (y `/explorar`, sin test completado, a `/test`). No muestra
 * datos del perfil y no hace consultas: cada página tiene su guard.
 * «Cerrar sesión» es el `SignOutButton` de 2.2 (`signOut`).
 */
export const APP_NAV_LINKS = [
  { href: "/explorar", label: "Explorar" },
  { href: "/test", label: "Test" },
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
