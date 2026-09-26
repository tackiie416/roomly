import { z } from "zod";

/**
 * Validación de variables de entorno con Zod (regla de seguridad de
 * CLAUDE.md: nunca confiar en datos sin validar, tampoco los propios).
 *
 * Deliberadamente PEREZOSA: no se ejecuta al importar el módulo, solo
 * cuando alguien llama a getPublicEnv()/getServiceRoleKey(). Así, páginas
 * que no tocan Supabase compilan y hacen build aunque no existan
 * credenciales reales todavía — ver docs/ENVIRONMENT.md.
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

const serviceRoleEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

function formatIssues(error: z.ZodError): string {
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
      `Configuración de entorno pública incompleta o inválida:\n${formatIssues(
        parsed.error
      )}\n\nRevisa .env.local contra .env.example (ver docs/ENVIRONMENT.md).`
    );
  }

  return parsed.data;
}

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
      `SUPABASE_SERVICE_ROLE_KEY falta o es inválida:\n${formatIssues(parsed.error)}`
    );
  }

  return parsed.data.SUPABASE_SERVICE_ROLE_KEY;
}
