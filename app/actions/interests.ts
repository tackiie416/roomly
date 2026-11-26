"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile, requireCompletedQuestionnaire } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  EXPLORE_PATH,
  MATCHES_PATH,
  ONBOARDING_PROFILE_PATH,
  TEST_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { sendInterest, withdrawInterest } from "@/lib/services/interests";
import type { ServiceResult } from "@/lib/services/result";
import type { InterestNoticeCode } from "@/lib/interests/notices";

/**
 * Server Actions de «Me interesa» (Fase 5.1). Orquestación fina sobre
 * lib/services/interests.ts: del navegador solo llegan `targetId`, la página
 * de vuelta (`volver`: `explorar` o `matches`) y, en `/explorar`, `pagina`.
 * Nunca el usuario, el score ni una habitación. Funcionan sin JavaScript:
 * terminan con un redirect a la página de origen con `?aviso=<código>`
 * (lib/interests/notices.ts).
 */

const ALLOWED_FIELDS = new Set(["targetId", "volver", "pagina"]);

function returnPath(formData: FormData, notice: InterestNoticeCode): string {
  const back = formData.get("volver") === "matches" ? MATCHES_PATH : EXPLORE_PATH;
  const params = new URLSearchParams();
  const page = formData.get("pagina");
  if (back === EXPLORE_PATH && typeof page === "string" && /^[1-9]\d{0,5}$/.test(page)) {
    params.set("pagina", page);
  }
  params.set("aviso", notice);
  return `${back}?${params.toString()}`;
}

function hasExtraFields(formData: FormData): boolean {
  return [...new Set(formData.keys())].some(
    (key) => !ALLOWED_FIELDS.has(key) && !key.startsWith("$ACTION_")
  );
}

/** Errores de la cuenta de quien envía: a donde toque, como los guards. */
function redirectForAccount(
  result: Extract<ServiceResult<unknown>, { ok: false }>,
  path: string
): void {
  if (result.error === "unauthenticated") redirect(loginPath({ next: path }));
  if (result.error === "deleted") redirect(DEACTIVATED_PATH);
  if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
}

function errorNotice(error: string): InterestNoticeCode {
  if (error === "rate_limited") return "limite";
  if (error === "not_found" || error === "validation") return "no-disponible";
  if (error === "conflict") return "con-match";
  return "error";
}

export async function expressInterest(formData: FormData): Promise<void> {
  const back = formData.get("volver") === "matches" ? MATCHES_PATH : EXPLORE_PATH;
  await requireCompletedQuestionnaire(back);
  if (hasExtraFields(formData)) redirect(returnPath(formData, "error"));

  const result = await sendInterest(await createClient(), formData.get("targetId"));
  if (!result.ok) {
    redirectForAccount(result, back);
    // Sin el test vigente completado (lo comprueba también el servicio).
    if (result.error === "forbidden") redirect(TEST_PATH);
    redirect(returnPath(formData, errorNotice(result.error)));
  }
  revalidatePath(EXPLORE_PATH);
  revalidatePath(MATCHES_PATH);
  const notice: InterestNoticeCode =
    result.data.status === "matched"
      ? "match"
      : result.data.status === "already_sent"
        ? "ya-enviado"
        : "enviado";
  redirect(returnPath(formData, notice));
}

export async function retractInterest(formData: FormData): Promise<void> {
  const back = formData.get("volver") === "matches" ? MATCHES_PATH : EXPLORE_PATH;
  await requireActiveProfile(back);
  if (hasExtraFields(formData)) redirect(returnPath(formData, "error"));

  const result = await withdrawInterest(await createClient(), formData.get("targetId"));
  if (!result.ok) {
    redirectForAccount(result, back);
    redirect(returnPath(formData, errorNotice(result.error)));
  }
  revalidatePath(EXPLORE_PATH);
  revalidatePath(MATCHES_PATH);
  redirect(
    returnPath(formData, result.data.status === "withdrawn" ? "retirado" : "no-enviado")
  );
}
