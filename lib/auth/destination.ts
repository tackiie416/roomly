import type { ProfileState } from "@/lib/services/profile";
import { getSafeRedirectPath } from "@/lib/auth/safe-redirect";

/**
 * Fuente única de verdad del enrutamiento tras autenticar (Fase 2.2).
 *
 * Funciones puras, sin E/S: las usan el callback, `/login`, los guards de
 * lib/auth/session.ts y el formulario de login. Cualquier destino sale de
 * aquí, así que no hay reglas de redirección repartidas por la app.
 */

export const HOME_PATH = "/";
export const LOGIN_PATH = "/login";
export const ONBOARDING_PROFILE_PATH = "/bienvenida/perfil";
export const ONBOARDING_PREFERENCES_PATH = "/bienvenida/preferencias";
export const DEACTIVATED_PATH = "/cuenta-desactivada";
/** Test de compatibilidad (Fase 3.5): destino al terminar el onboarding (D5). */
export const TEST_PATH = "/test";
/** Lista de candidatos (Fase 3.5, D13): exige el test completado. */
export const EXPLORE_PATH = "/explorar";

export type ProfileStatus = ProfileState["status"];

/**
 * Rutas que nunca pueden ser destino de `next`: las de autenticación y las
 * que dependen del estado del perfil. Si `next` apuntara a ellas, el usuario
 * volvería a la misma pantalla o se saltaría la decisión por estado.
 */
const EXCLUDED_NEXT_PREFIXES = [
  "/login",
  "/callback",
  "/registro",
  "/bienvenida",
  DEACTIVATED_PATH,
];

/** Ruta sin barra final y descodificada, para comparar sin trucos de codificación. */
function comparablePathname(path: string): string | null {
  const pathname = new URL(path, "http://roomly.internal").pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const trimmed = decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
  return trimmed.toLowerCase();
}

function isExcluded(path: string): boolean {
  const pathname = comparablePathname(path);
  if (pathname === null) return true;
  return EXCLUDED_NEXT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * `next` saneado: una ruta interna segura (vía `getSafeRedirectPath`, la
 * misma protección contra open redirects de Fase 1) que no sea una ruta
 * excluida. Cualquier otra cosa → `null`.
 */
export function sanitizeNext(next: string | null | undefined): string | null {
  const safe = getSafeRedirectPath(next, "");
  if (safe === "" || isExcluded(safe)) return null;
  return safe;
}

/**
 * Destino según el estado del perfil. `next` solo se respeta con el perfil
 * completo; en los demás estados manda el estado (la cuenta eliminada tiene
 * prioridad y nunca se reactiva). Un usuario sin sesión no llega aquí: su
 * destino es `loginPath()`.
 */
export function resolveDestination(
  state: { status: ProfileStatus },
  next?: string | null
): string {
  switch (state.status) {
    case "deleted":
      return DEACTIVATED_PATH;
    case "no_profile":
      return ONBOARDING_PROFILE_PATH;
    case "incomplete":
      return ONBOARDING_PREFERENCES_PATH;
    case "complete":
      return sanitizeNext(next) ?? HOME_PATH;
  }
}

/** `/login`, con `next` y `error` solo si son válidos. */
export function loginPath(
  options: { next?: string | null; error?: string | null } = {}
): string {
  const params = new URLSearchParams();
  if (options.error) params.set("error", options.error);
  const next = sanitizeNext(options.next);
  if (next) params.set("next", next);
  const query = params.toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}
