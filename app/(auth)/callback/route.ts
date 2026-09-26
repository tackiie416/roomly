import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSafeRedirectPath } from "@/lib/auth/safe-redirect";

/**
 * Destino de emailRedirectTo/redirectTo tras magic link u OAuth. Cambia
 * el `code` de un solo uso por una sesión real (cookies HTTP-only,
 * gestionadas por @supabase/ssr).
 *
 * `next` solo admite rutas internas (ver lib/auth/safe-redirect.ts): nunca
 * se concatena texto del usuario con el origin para construir el redirect.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", origin));
}
