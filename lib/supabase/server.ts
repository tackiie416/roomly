import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { getPublicEnv } from "@/lib/env";

/**
 * Cliente Supabase para Server Components / Server Actions / Route
 * Handlers. Sigue usando la anon key — sujeto a RLS igual que el de
 * navegador, solo cambia cómo se lee/escribe la sesión (cookies HTTP en
 * vez de localStorage). Para saltarse RLS de forma controlada, usar
 * lib/supabase/admin.ts, nunca este.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Se puede llamar desde un Server Component puro, donde no se
            // pueden escribir cookies — el middleware ya refresca la
            // sesión en cada request, así que esto es seguro de ignorar.
          }
        },
      },
    }
  );
}
