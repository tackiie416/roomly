"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "@/lib/auth/destination";

/**
 * Cierra la sesión y vuelve a `/login` (Fase 2.2). Orquestación fina: sin
 * lógica de negocio, sin service_role. Las Server Actions de Next.js ya
 * comprueban el origen de la petición (protección CSRF).
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}
