import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPublicEnv } from "@/lib/env";

/**
 * Cliente de un visitante anónimo: la clave pública (anon) y SIN sesión, ni
 * de las cookies ni guardada (Fase 4.4, sesión 71).
 *
 * Lo usan las páginas públicas de habitaciones (`/[city]/habitaciones` y su
 * detalle) para leer SIEMPRE como un visitante, también cuando hay una
 * sesión: así la base de datos aplica a todo el mundo, propietaria y admin
 * incluidos, la RLS de R7 (`rooms_select_active_public`) y el GRANT por
 * columnas de anon (20261031120100). Con el cliente de la sesión, una
 * propietaria vería sus borradores (`rooms_select_own`), un admin cualquier
 * habitación (`rooms_admin_all`) y `authenticated` todas las columnas, y
 * solo un filtro de la aplicación lo evitaría.
 *
 * No es un cliente privilegiado: tiene exactamente lo que tiene anon. Nunca
 * sirve para leer ni escribir datos propios (eso es lib/supabase/server.ts).
 */
export function createPublicClient() {
  const env = getPublicEnv();
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
