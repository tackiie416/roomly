/**
 * Rutas que exigen sesión (Fase 2.2). `proxy.ts` solo usa esta lista para
 * bloquear a usuarios anónimos, sin consultar la base de datos; la decisión
 * por estado del perfil la toman los guards de lib/auth/session.ts.
 */
export const PROTECTED_PREFIXES = [
  "/admin",
  "/perfil",
  "/ajustes",
  "/bienvenida",
  "/cuenta-desactivada",
] as const;

/** Coincide con el prefijo exacto o con una subruta (no con "/administracion"). */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
