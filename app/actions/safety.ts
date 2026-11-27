"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile, requireCompletedQuestionnaire } from "@/lib/auth/session";
import {
  BLOCKED_PATH,
  DEACTIVATED_PATH,
  EXPLORE_PATH,
  MATCHES_PATH,
  MESSAGES_PATH,
  ONBOARDING_PROFILE_PATH,
  TEST_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { blockUser, unblockUser } from "@/lib/services/interests";
import { reportRoom, reportUser } from "@/lib/services/reports";
import { createPublicClient } from "@/lib/supabase/public";
import type { ServiceResult } from "@/lib/services/result";
import type { SafetyNoticeCode } from "@/lib/safety/notices";
import { reportPath, roomReportPath } from "@/lib/safety/paths";
import { uuidSchema } from "@/lib/validation/common";

/**
 * Bloquear, desbloquear y reportar (sesión 83). Orquestación fina sobre
 * lib/services/{interests,reports}.ts. Del navegador solo llegan el id de la
 * otra persona y, al reportar, el motivo, la descripción y si se bloquea
 * también. Nunca quién reporta ni quién bloquea: sale de la sesión. Funcionan
 * sin JavaScript (formulario y redirect con `?aviso=`, lib/safety/notices.ts).
 */

function hasOnly(formData: FormData, allowed: readonly string[]): boolean {
  return [...new Set(formData.keys())].every(
    (key) => allowed.includes(key) || key.startsWith("$ACTION_")
  );
}

function redirectForAccount(
  result: Extract<ServiceResult<unknown>, { ok: false }>,
  path: string
): void {
  if (result.error === "unauthenticated") redirect(loginPath({ next: path }));
  if (result.error === "deleted") redirect(DEACTIVATED_PATH);
  if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
  if (result.error === "forbidden") redirect(TEST_PATH);
}

function failureNotice(error: string): SafetyNoticeCode {
  if (error === "rate_limited") return "limite";
  if (error === "not_found" || error === "validation") return "no-disponible";
  return "error";
}

function revalidateRelations(): void {
  revalidatePath(EXPLORE_PATH, "layout");
  revalidatePath(MATCHES_PATH);
  revalidatePath(MESSAGES_PATH, "layout");
  revalidatePath(BLOCKED_PATH);
}

export async function blockUserAction(formData: FormData): Promise<void> {
  await requireCompletedQuestionnaire(BLOCKED_PATH);
  if (!hasOnly(formData, ["targetId"])) redirect(`${BLOCKED_PATH}?aviso=error`);

  const result = await blockUser(await createClient(), formData.get("targetId"));
  if (!result.ok) {
    redirectForAccount(result, BLOCKED_PATH);
    redirect(`${BLOCKED_PATH}?aviso=${failureNotice(result.error)}`);
  }
  revalidateRelations();
  redirect(
    `${BLOCKED_PATH}?aviso=${result.data.status === "blocked" ? "bloqueado" : "ya-bloqueado"}`
  );
}

export async function unblockUserAction(formData: FormData): Promise<void> {
  await requireActiveProfile(BLOCKED_PATH);
  if (!hasOnly(formData, ["targetId"])) redirect(`${BLOCKED_PATH}?aviso=error`);

  const result = await unblockUser(await createClient(), formData.get("targetId"));
  if (!result.ok) {
    redirectForAccount(result, BLOCKED_PATH);
    redirect(`${BLOCKED_PATH}?aviso=${failureNotice(result.error)}`);
  }
  revalidateRelations();
  redirect(
    `${BLOCKED_PATH}?aviso=${result.data.status === "unblocked" ? "desbloqueado" : "no-bloqueado"}`
  );
}

export async function reportUserAction(formData: FormData): Promise<void> {
  const target = uuidSchema.safeParse(formData.get("targetId"));
  const page = target.success ? reportPath(target.data) : MATCHES_PATH;
  await requireCompletedQuestionnaire(page);
  if (!hasOnly(formData, ["targetId", "reason", "description", "bloquear"]))
    redirect(`${page}?aviso=error`);

  const supabase = await createClient();
  const result = await reportUser(supabase, {
    targetId: formData.get("targetId"),
    reason: formData.get("reason"),
    description: formData.get("description") ?? "",
  });
  if (!result.ok) {
    redirectForAccount(result, page);
    if (result.error === "not_found") notFoundRedirect();
    if (result.error === "validation") {
      const field = Object.keys(result.fieldErrors ?? {})[0];
      redirect(`${page}?error=${field === "description" ? "descripcion" : "motivo"}`);
    }
    redirect(`${page}?aviso=${failureNotice(result.error)}`);
  }

  // Bloquear también (opcional): después del reporte, que ya está guardado.
  if (formData.get("bloquear") === "1") {
    const blocked = await blockUser(supabase, target.success ? target.data : null);
    revalidateRelations();
    if (blocked.ok) redirect(`${BLOCKED_PATH}?aviso=bloqueado-reportado`);
  }
  redirect(
    `${page}?aviso=${result.data.status === "duplicate" ? "ya-reportado" : "reportado"}`
  );
}

/** Alguien a quien no conoces por la app: lo mismo que una persona no disponible. */
function notFoundRedirect(): never {
  redirect(`${MATCHES_PATH}?aviso=no-disponible`);
}

/**
 * Reportar un anuncio (Fase 7). Basta una cuenta activa (no hace falta el
 * test). Del navegador solo llegan el id de la habitación, el motivo y la
 * descripción; quién reporta sale de la sesión. Un anuncio que no es público
 * o es propio da el mismo 404.
 */
export async function reportRoomAction(formData: FormData): Promise<void> {
  const room = uuidSchema.safeParse(formData.get("roomId"));
  if (!room.success) notFound();
  const page = roomReportPath(room.data);
  await requireActiveProfile(page);
  if (!hasOnly(formData, ["roomId", "reason", "description"]))
    redirect(`${page}?aviso=error`);

  const result = await reportRoom(await createClient(), createPublicClient(), {
    roomId: room.data,
    reason: formData.get("reason"),
    description: formData.get("description") ?? "",
  });
  if (!result.ok) {
    redirectForAccount(result, page);
    if (result.error === "not_found") notFound();
    if (result.error === "validation") {
      const field = Object.keys(result.fieldErrors ?? {})[0];
      redirect(`${page}?error=${field === "description" ? "descripcion" : "motivo"}`);
    }
    redirect(`${page}?aviso=${failureNotice(result.error)}`);
  }
  redirect(
    `${page}?aviso=${result.data.status === "created" ? "anuncio-reportado" : "anuncio-ya-reportado"}`
  );
}
