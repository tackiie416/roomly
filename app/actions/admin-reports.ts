"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { resolveReport } from "@/lib/services/reports";
import { ADMIN_REPORTS_PATH } from "@/lib/admin/paths";

/**
 * Cambiar el estado de un reporte (sesión 83). Orquestación fina sobre
 * `resolveReport`: el guard de admin aquí y, en la base de datos, la RLS
 * (`reports_admin_all`, `is_admin()`), el GRANT por columnas y
 * `trg_reports_integrity`. Quién lo resuelve sale de la sesión.
 */
export async function resolveReportAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const allowed = ["reportId", "status", "notes"];
  if (
    ![...new Set(formData.keys())].every(
      (k) => allowed.includes(k) || k.startsWith("$ACTION_")
    )
  )
    redirect(`${ADMIN_REPORTS_PATH}?aviso=error`);

  const result = await resolveReport(await createClient(), {
    reportId: formData.get("reportId"),
    status: formData.get("status"),
    notes: formData.get("notes") ?? "",
  });
  if (!result.ok) {
    if (result.error === "forbidden" || result.error === "unauthenticated") redirect("/");
    redirect(
      `${ADMIN_REPORTS_PATH}?aviso=${result.error === "validation" ? "invalido" : "error"}`
    );
  }
  revalidatePath(ADMIN_REPORTS_PATH);
  const closed = result.data.status === "resolved" || result.data.status === "dismissed";
  redirect(`${ADMIN_REPORTS_PATH}?aviso=guardado${closed ? "&vista=cerrados" : ""}`);
}
