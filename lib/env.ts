import { z } from "zod";

/**
 * Validación de variables de entorno con Zod (regla de seguridad de
 * CLAUDE.md: nunca confiar en datos sin validar, tampoco los propios).
 *
 * Deliberadamente PEREZOSA: no se ejecuta al importar el módulo, solo
 * cuando alguien llama a getPublicEnv(). Así, páginas que no tocan Supabase
 * compilan y hacen build aunque no existan credenciales reales todavía — ver
 * docs/ENVIRONMENT.md.
 *
 * Solo configuración pública: este módulo lo importan también componentes de
 * cliente (lib/supabase/client.ts) y su contenido puede llegar a los bundles
 * del navegador. La clave service_role se valida en lib/env.server.ts
 * (server-only).
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

/** Una línea por error: la variable y el mensaje de Zod, sin el valor recibido. */
export function formatEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
    .join("\n");
}

/** Variables NEXT_PUBLIC_* — llegan al navegador, nunca deben incluir secretos. */
export function getPublicEnv() {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    throw new Error(
      `Configuración de entorno pública incompleta o inválida:\n${formatEnvIssues(
        parsed.error
      )}\n\nRevisa .env.local contra .env.example (ver docs/ENVIRONMENT.md).`
    );
  }

  return parsed.data;
}
