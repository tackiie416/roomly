import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Segunda capa de protección de /admin (la primera, "hay sesión?", vive
 * en proxy.ts). Aquí se comprueba el rol de verdad, consultando
 * `profiles.role` — nunca basta con "está logueado" para dejar pasar a
 * /admin. Esto es exactamente lo que faltaba en el hallazgo de escalado
 * de privilegios de la revisión anterior: la comprobación de admin tiene
 * que ser explícita y no solo derivarse de la sesión.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/");
  }

  return <div className="min-h-[calc(100vh-65px)]">{children}</div>;
}
