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
import {
  sendInterest,
  sendRoomInterest,
  undoMatch,
  withdrawInterest,
} from "@/lib/services/interests";
import type { ServiceResult } from "@/lib/services/result";
import type { InterestNoticeCode } from "@/lib/interests/notices";
import { personPath } from "@/lib/interests/paths";
import { uuidSchema } from "@/lib/validation/common";
import { publicRoomPath } from "@/lib/validation/room-search";

/**
 * Server Actions de «Me interesa» (Fase 5.1). Orquestación fina sobre
 * lib/services/interests.ts: del navegador solo llegan `targetId`, la página
 * de vuelta (`volver`: `explorar`, `matches` o `perfil`, el de esa persona en
 * `/explorar/<id>`) y, en `/explorar`, `pagina`.
 * Nunca el usuario, el score ni una habitación. Funcionan sin JavaScript:
 * terminan con un redirect a la página de origen con `?aviso=<código>`
 * (lib/interests/notices.ts).
 */

const ALLOWED_FIELDS = new Set(["targetId", "volver", "pagina"]);

/** Página de vuelta: solo rutas fijas, o el perfil de un UUID válido. */
function backPath(formData: FormData): string {
  const back = formData.get("volver");
  if (back === "matches") return MATCHES_PATH;
  if (back === "perfil") {
    const target = uuidSchema.safeParse(formData.get("targetId"));
    if (target.success) return personPath(target.data);
  }
  return EXPLORE_PATH;
}

/** Ruta del guard (para volver tras el login): la lista de origen. */
function guardPath(formData: FormData): typeof EXPLORE_PATH | typeof MATCHES_PATH {
  return formData.get("volver") === "matches" ? MATCHES_PATH : EXPLORE_PATH;
}

function returnPath(formData: FormData, notice: InterestNoticeCode): string {
  const back = backPath(formData);
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
  const back = guardPath(formData);
  await requireCompletedQuestionnaire(back);
  if (hasExtraFields(formData)) redirect(returnPath(formData, "error"));

  const result = await sendInterest(await createClient(), formData.get("targetId"));
  if (!result.ok) {
    redirectForAccount(result, back);
    // Sin el test vigente completado (lo comprueba también el servicio).
    if (result.error === "forbidden") redirect(TEST_PATH);
    redirect(returnPath(formData, errorNotice(result.error)));
  }
  revalidatePath(EXPLORE_PATH, "layout");
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
  const back = guardPath(formData);
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

/**
 * Deshacer un match (Fase 6). Del navegador solo llegan `targetId` y
 * `volver`; termina en `/matches` con el aviso (el chat ya está cerrado).
 */
export async function undoMatchAction(formData: FormData): Promise<void> {
  await requireActiveProfile(MATCHES_PATH);
  const extra = [...new Set(formData.keys())].some(
    (key) => !["targetId", "volver"].includes(key) && !key.startsWith("$ACTION_")
  );
  if (extra) redirect(`${MATCHES_PATH}?aviso=error`);

  const result = await undoMatch(await createClient(), formData.get("targetId"));
  if (!result.ok) {
    redirectForAccount(result, MATCHES_PATH);
    redirect(`${MATCHES_PATH}?aviso=${errorNotice(result.error)}`);
  }
  revalidatePath(EXPLORE_PATH, "layout");
  revalidatePath(MATCHES_PATH);
  revalidatePath("/mensajes", "layout");
  const notice: InterestNoticeCode =
    result.data.status === "undone" ? "deshecho" : "sin-match";
  redirect(`${MATCHES_PATH}?aviso=${notice}`);
}

const CITY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * «Me interesa esta habitación» (Fase 6), desde el detalle público. Del
 * navegador llegan `roomId` y `ciudad` (solo para volver a la página tras el
 * login o si falla). Con éxito termina en `/matches`, donde las dos personas
 * se ven; el detalle público no cambia.
 */
export async function expressRoomInterest(formData: FormData): Promise<void> {
  const room = uuidSchema.safeParse(formData.get("roomId"));
  const city = formData.get("ciudad");
  const roomPage =
    room.success && typeof city === "string" && CITY_SLUG.test(city)
      ? publicRoomPath(city, room.data)
      : MATCHES_PATH;
  await requireCompletedQuestionnaire(roomPage);
  const extra = [...new Set(formData.keys())].some(
    (key) => !["roomId", "ciudad"].includes(key) && !key.startsWith("$ACTION_")
  );
  if (extra) redirect(`${MATCHES_PATH}?aviso=error`);

  const result = await sendRoomInterest(await createClient(), formData.get("roomId"));
  if (!result.ok) {
    redirectForAccount(result, roomPage);
    if (result.error === "forbidden") redirect(TEST_PATH);
    const notice: InterestNoticeCode =
      result.error === "validation" && room.success
        ? "habitacion-propia"
        : result.error === "rate_limited"
          ? "limite"
          : result.error === "not_found" || result.error === "validation"
            ? "habitacion-no-disponible"
            : "error";
    redirect(`${MATCHES_PATH}?aviso=${notice}`);
  }
  revalidatePath(EXPLORE_PATH, "layout");
  revalidatePath(MATCHES_PATH);
  const notice: InterestNoticeCode =
    result.data.status === "matched"
      ? "match"
      : result.data.status === "already_sent"
        ? "habitacion-ya-enviado"
        : "habitacion-enviado";
  redirect(`${MATCHES_PATH}?aviso=${notice}`);
}
