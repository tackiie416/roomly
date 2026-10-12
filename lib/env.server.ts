import "server-only";

import { z } from "zod";
import { formatEnvIssues } from "@/lib/env";

/**
 * Configuración privada del servidor. Separada de lib/env.ts porque ese
 * módulo lo importan también componentes de cliente (lib/supabase/client.ts):
 * lo que vive en él a nivel de módulo, como un esquema de Zod, puede acabar en
 * los bundles públicos aunque nadie lo llame en el navegador. Aquí,
 * `import "server-only"` hace fallar el build si un componente de cliente
 * importa este archivo. Lo comprueban tests/unit/admin-client-usage.test.ts y,
 * sobre el build de E1, tests/e2e/local/no-service-key-in-client.spec.ts (D1).
 *
 * Perezosa, como lib/env.ts: solo valida cuando alguien llama a la función.
 */

const serviceRoleEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * SUPABASE_SERVICE_ROLE_KEY — server-only, nunca debe llegar al cliente.
 * Solo lib/supabase/admin.ts debería llamar a esto.
 */
export function getServiceRoleKey() {
  const parsed = serviceRoleEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY falta o es inválida:\n${formatEnvIssues(parsed.error)}`
    );
  }

  return parsed.data.SUPABASE_SERVICE_ROLE_KEY;
}
