import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { getPublicEnv } from "@/lib/env";

/**
 * Dos responsabilidades, ambas obligatorias en cada request:
 *
 * 1. Refrescar la sesión de Supabase (patrón estándar de @supabase/ssr:
 *    sin esto, las sesiones expiran de forma impredecible).
 * 2. Primera capa de protección de /admin: sin sesión, redirige a login.
 *    La segunda capa — ¿es realmente admin? — vive en
 *    app/admin/layout.tsx, que sí puede consultar `profiles.role`. Esto
 *    replica a propósito el patrón "dos comprobaciones, nunca solo una"
 *    de docs/SECURITY.md, y evita repetir el hallazgo de escalado de
 *    privilegios de la revisión anterior: aquí NUNCA se decide "es admin"
 *    solo con la sesión, siempre hace falta la comprobación de rol aparte.
 *
 * No verificado contra un proyecto Supabase real (no hay credenciales en
 * este entorno) — solo compila y pasa typecheck. Validar en Fase 1 con
 * credenciales reales antes de confiar en él en producción.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const env = getPublicEnv();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // No quitar este await: es lo que de verdad refresca el token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (request.nextUrl.pathname.startsWith("/admin") && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
