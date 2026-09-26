import { redirect } from "next/navigation";

/**
 * El magic link sirve igual para alta y para vuelta: Supabase crea el
 * usuario automáticamente si no existe. No hay un formulario de registro
 * distinto que mantener — se redirige a /login. La distinción real
 * (mostrar onboarding a un usuario nuevo) llega en Fase 2.
 */
export default function RegistroPage() {
  redirect("/login");
}
