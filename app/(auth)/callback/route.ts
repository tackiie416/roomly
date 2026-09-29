import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfileState } from "@/lib/services/profile";
import { loginPath, resolveDestination } from "@/lib/auth/destination";
import {
  CLEAR_NEXT_COOKIE,
  NEXT_COOKIE_NAME,
  readNextCookie,
} from "@/lib/auth/next-cookie";
import { callbackErrorCode } from "@/lib/auth/login-errors";

/**
 * Destino de `emailRedirectTo`/`redirectTo` tras magic link u OAuth.
 *
 * 1. Cambia el `code` de un solo uso por una sesión. Las cookies de sesión
 *    las gestiona @supabase/ssr y NO son HttpOnly (el cliente de navegador
 *    necesita leerlas; ver D14 en docs/SUPABASE_VALIDATION.md).
 * 2. Lee `next` de la cookie de corta duración que dejó `/login`, lo vuelve
 *    a sanear y la borra. `next` ya no se acepta por query string.
 * 3. Decide el destino con `resolveDestination` según el estado del perfil.
 *
 * Los errores (sin `code`, `code` inválido, enlace caducado, `error` o
 * `error_code` de Supabase) se reducen a un código propio; nunca se reenvía
 * `error_description` ni ningún mensaje de Supabase.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = readNextCookie(request.cookies.get(NEXT_COOKIE_NAME)?.value);

  const redirectTo = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.cookies.set(CLEAR_NEXT_COOKIE);
    return response;
  };
  // Al volver a /login se conserva `next` en la URL para el siguiente intento.
  const failWith = (errorCode: string | null) =>
    redirectTo(loginPath({ error: callbackErrorCode(errorCode), next }));

  if (searchParams.has("error") || searchParams.has("error_code")) {
    return failWith(searchParams.get("error_code"));
  }

  const code = searchParams.get("code");
  if (!code) return failWith(null);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failWith(error.code ?? null);

  const state = await getProfileState(supabase);
  if (!state.ok) return failWith(null);

  return redirectTo(resolveDestination(state.data, next));
}
