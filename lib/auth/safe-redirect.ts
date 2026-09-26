/**
 * Valida el parámetro `next` de los redirects de auth (open redirect, H1 de
 * la auditoría inicial — ver docs/SECURITY.md).
 *
 * Solo acepta rutas internas: una ruta absoluta del propio sitio
 * ("/perfil?tab=1"). Cualquier otra cosa devuelve `fallback`.
 *
 * Por qué no basta con "empieza por /": concatenar `${origin}${next}` con
 * next="@evil.com" produce "https://roomly.es@evil.com" (host evil.com), y
 * los navegadores tratan "//evil.com" y "/\evil.com" como URLs a otro host.
 * Además, el parser de URL elimina tabuladores y saltos de línea, así que
 * "/\t/evil.com" acabaría siendo "//evil.com". Por eso se rechazan
 * explícitamente esas formas y, como comprobación final, se resuelve la
 * ruta contra un origen ficticio y se exige que el origen no cambie.
 */
const INTERNAL_BASE = "http://roomly.internal";
const MAX_LENGTH = 2048;

export function getSafeRedirectPath(
  next: string | null | undefined,
  fallback = "/"
): string {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_LENGTH) {
    return fallback;
  }

  // Debe ser una ruta absoluta del propio sitio: "/algo", nunca "//host" ni "/\host".
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }

  // Sin backslashes ni caracteres de control/espacios en ningún punto: el
  // parser de URL los normaliza de formas que pueden cambiar el destino.
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(next, INTERNAL_BASE);
  } catch {
    return fallback;
  }

  if (url.origin !== INTERNAL_BASE) {
    return fallback;
  }

  // Se devuelve la forma normalizada por el parser, no el texto original.
  return `${url.pathname}${url.search}${url.hash}`;
}
