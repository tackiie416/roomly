import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPublicEnv, getServiceRoleKey } from "@/lib/env";

/**
 * Cliente con la service_role key: SALTA RLS por completo.
 *
 * `import "server-only"` hace que el build falle con un error explícito
 * si este archivo se importa por error desde un Client Component — es la
 * defensa técnica contra la regla de CLAUDE.md "nunca exponer
 * SUPABASE_SERVICE_ROLE_KEY al cliente".
 *
 * Usar solo para lo que RLS no puede resolver por diseño (p. ej. crear un
 * `match` desde el servidor tras verificar interés mutuo — ver
 * docs/DATABASE.md, matches/conversations no aceptan INSERT de cliente).
 * Para todo lo demás, usar lib/supabase/server.ts.
 */
export function createAdminClient() {
  const env = getPublicEnv();
  const serviceRoleKey = getServiceRoleKey();

  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
