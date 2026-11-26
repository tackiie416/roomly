"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  MESSAGES_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { sendMessage } from "@/lib/services/chat";
import type { ChatNoticeCode } from "@/lib/chat/notices";
import { conversationPath } from "@/lib/chat/paths";
import { uuidSchema } from "@/lib/validation/common";

/**
 * Server Action del chat (Fase 6). Orquestación fina sobre
 * lib/services/chat.ts: del navegador solo llegan `conversationId`,
 * `clientToken` (lo genera el servidor al pintar el formulario) y `content`.
 * Nunca el remitente. Funciona sin JavaScript: termina con un redirect al chat
 * (o a `/mensajes` si ya no está disponible) con `?aviso=<código>` si algo
 * falla (lib/chat/notices.ts).
 */

const ALLOWED_FIELDS = new Set(["conversationId", "clientToken", "content"]);

function chatPath(formData: FormData, notice?: ChatNoticeCode): string {
  const id = uuidSchema.safeParse(formData.get("conversationId"));
  if (!id.success) return `${MESSAGES_PATH}?aviso=cerrado`;
  const base = conversationPath(id.data);
  return notice ? `${base}?aviso=${notice}#escribir` : `${base}#ultimo`;
}

export async function sendChatMessage(formData: FormData): Promise<void> {
  const id = uuidSchema.safeParse(formData.get("conversationId"));
  const back = id.success ? conversationPath(id.data) : MESSAGES_PATH;
  await requireCompletedQuestionnaire(back);
  const extra = [...new Set(formData.keys())].some(
    (key) => !ALLOWED_FIELDS.has(key) && !key.startsWith("$ACTION_")
  );
  if (extra) redirect(chatPath(formData, "error"));

  const result = await sendMessage(await createClient(), {
    conversationId: formData.get("conversationId"),
    clientToken: formData.get("clientToken"),
    content: formData.get("content") ?? "",
  });
  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect(loginPath({ next: back }));
      case "deleted":
        redirect(DEACTIVATED_PATH);
      case "no_profile":
        redirect(ONBOARDING_PROFILE_PATH);
      case "not_found":
        redirect(`${MESSAGES_PATH}?aviso=cerrado`);
      case "conflict":
        redirect(chatPath(formData, "no-disponible"));
      case "rate_limited":
        redirect(chatPath(formData, "limite"));
      case "validation": {
        const errors = result.fieldErrors ?? {};
        if (errors.conversationId) redirect(`${MESSAGES_PATH}?aviso=cerrado`);
        const tooLong = (errors.content ?? []).some(
          (m) => m.includes("2000") || m.includes("largo")
        );
        redirect(
          chatPath(formData, tooLong ? "largo" : errors.content ? "vacio" : "error")
        );
      }
      default:
        redirect(chatPath(formData, "error"));
    }
  }
  revalidatePath(MESSAGES_PATH, "layout");
  redirect(chatPath(formData));
}
