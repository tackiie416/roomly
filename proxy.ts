import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { getPublicEnv } from "@/lib/env";
import { isProtectedPath } from "@/lib/auth/protected-routes";
import { loginPath } from "@/lib/auth/destination";

/**
 * Dos responsabilidades, ambas obligatorias en cada request:
 *
 * 1. Refrescar la sesión de Supabase (patrón estándar de @supabase/ssr:
 *    sin esto, las sesiones expiran de forma impredecible).
 * 2. Primera capa de protección de las rutas que exigen sesión
 *    (lib/auth/protected-routes.ts: /admin, /perfil, /ajustes, /bienvenida,
 *    /cuenta-desactivada): sin sesión, redirige a /login?next=<ruta>.
 *    La segunda capa — el estado del perfil y, en /admin, el rol — vive en
 *    los guards de lib/auth/session.ts. Aquí NUNCA se consulta la base de
 *    datos ni se decide "es admin" solo con la sesión.
 *
 * Convención `proxy` de Next.js 16 (antes `middleware.ts`). Se ejecuta en
 * el runtime Node.js, que en `proxy` no se puede configurar: no añadir
 * `export const runtime`. Esta misma lógica se validó contra Supabase
 * real como `middleware.ts` (AU3/AU4/AU5) y, tras el cambio, en local
 * (ver docs/SUPABASE_VALIDATION.md y docs/TESTING.md).
 */
export async function proxy(request: NextRequest) {
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

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(new URL(loginPath({ next }), request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
