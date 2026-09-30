import { AppNav } from "@/components/app-nav";

/**
 * Shell autenticado de `(app)` (Fase 2.7): navegación de la cuenta sobre
 * `/perfil`, `/preferencias` y `/ajustes`. No hace consultas ni decide
 * accesos: cada página conserva su propio guard (`requireOwnProfile`), y sin
 * sesión `proxy.ts` redirige antes. Sin `loading.tsx` en `(app)`: con él, el
 * contenido llega por streaming en un `<div hidden>` que solo muestra
 * JavaScript, y las páginas dejan de funcionar sin JavaScript.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppNav />
      {children}
    </>
  );
}
