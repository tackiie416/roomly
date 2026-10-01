import { sanitizeNext } from "@/lib/auth/destination";

/**
 * Cookie de corta duración que conserva `next` entre `/login` y `/callback`
 * (M6, Fase 2.2) sin tocar `emailRedirectTo`, que sigue siendo exactamente
 * `/callback` y no requiere cambiar la configuración de Supabase.
 *
 * - Solo guarda una ruta interna ya saneada: nada sensible.
 * - Se vuelve a sanear al leerla: nunca se confía en su contenido.
 * - `SameSite=Lax`: se envía al abrir el enlace del email (navegación GET de
 *   nivel superior). PKCE ya obliga a abrirlo en el mismo navegador.
 * - Una hora, como la caducidad por defecto del enlace de Supabase.
 * - La escribe el formulario de login en el navegador, por eso no es
 *   HttpOnly; el callback la borra al usarla.
 */

export const NEXT_COOKIE_NAME = "roomly_next";
export const NEXT_COOKIE_MAX_AGE_SECONDS = 60 * 60;

/**
 * Cadena para `document.cookie`. Sin `next` válido devuelve la cadena que la
 * borra, para que no se reutilice un destino de un intento anterior.
 */
export function serializeNextCookie(
  next: string | null | undefined,
  options: { secure: boolean }
): string {
  const safe = sanitizeNext(next);
  const attributes = ["Path=/", "SameSite=Lax"];
  if (options.secure) attributes.push("Secure");
  if (!safe) return [`${NEXT_COOKIE_NAME}=`, "Max-Age=0", ...attributes].join("; ");
  return [
    `${NEXT_COOKIE_NAME}=${encodeURIComponent(safe)}`,
    `Max-Age=${NEXT_COOKIE_MAX_AGE_SECONDS}`,
    ...attributes,
  ].join("; ");
}

/** Valor de la cookie → ruta saneada, o `null` si no hay o no es segura. */
export function readNextCookie(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return sanitizeNext(decoded);
}

/** Opciones para borrarla desde el servidor (`response.cookies.set`). */
export const CLEAR_NEXT_COOKIE = {
  name: NEXT_COOKIE_NAME,
  value: "",
  path: "/",
  maxAge: 0,
  sameSite: "lax",
} as const;
