import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de emailRedirectTo/redirectTo tras magic link u OAuth. Cambia
 * el `code` de un solo uso por una sesión real (cookies HTTP-only,
 * gestionadas por @supabase/ssr).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
