"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { resolveReport } from "@/lib/services/reports";
import { ADMIN_REPORTS_PATH } from "@/lib/admin/paths";

/**
 * Cambiar el estado de un reporte (sesión 83; Fase 7). Orquestación fina
 * sobre `resolveReport`: el guard de admin aquí y, en la base de datos,
 * `admin_set_report_status` (is_admin(), transiciones, medida y registro en
 * una transacción) y `trg_reports_integrity`. Quién lo resuelve sale de la
 * sesión. Next.js comprueba el origen de cada Server Action (CSRF).
 */
export async function resolveReportAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const allowed = ["reportId", "status", "notes", "measure"];
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
    measure: formData.get("measure") ?? undefined,
  });
  if (!result.ok) {
    if (result.error === "forbidden" || result.error === "unauthenticated") redirect("/");
    const notice =
      result.error === "validation"
        ? "invalido"
        : result.error === "conflict"
          ? "conflicto"
          : result.error === "not_found"
            ? "no-encontrado"
            : "error";
    redirect(`${ADMIN_REPORTS_PATH}?aviso=${notice}`);
  }
  revalidatePath(ADMIN_REPORTS_PATH);
  const closed = result.data.status === "resolved" || result.data.status === "dismissed";
  redirect(`${ADMIN_REPORTS_PATH}?aviso=guardado${closed ? "&vista=cerrados" : ""}`);
}
