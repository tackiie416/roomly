"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { moderateRoom, moderateUser } from "@/lib/services/admin";
import {
  ADMIN_ROOMS_PATH,
  ADMIN_USERS_PATH,
  adminRoomPath,
  adminUserPath,
} from "@/lib/admin/paths";
import {
  ADMIN_ROOM_ACTIONS,
  ADMIN_USER_ACTIONS,
  type AdminRoomAction,
  type AdminUserAction,
} from "@/lib/validation/admin";
import { uuidSchema } from "@/lib/validation/common";
import type { ServiceErrorCode } from "@/lib/services/result";

/**
 * Fase 7: acciones de moderación sobre cuentas y habitaciones. Orquestación
 * fina: `requireAdmin()` aquí, la validación y la segunda comprobación en
 * `lib/services/admin.ts` y la decisión final en la base de datos
 * (`admin_*`, con `is_admin()` y el registro en la misma transacción).
 *
 * Solo se aceptan los campos del formulario (nada de `admin_id`, `role` ni
 * otros inyectados). El objetivo viene del formulario y la base de datos
 * comprueba que existe: un id ajeno o inventado da `no-encontrado`, sin
 * distinguir. Next.js rechaza las Server Actions de otro origen (CSRF).
 */

const ALLOWED_KEYS = ["targetId", "action", "reason", "confirm"];

function onlyAllowedKeys(formData: FormData): boolean {
  return [...new Set(formData.keys())].every(
    (k) => ALLOWED_KEYS.includes(k) || k.startsWith("$ACTION_")
  );
}

function noticeFor(error: ServiceErrorCode): string {
  switch (error) {
    case "validation":
      return "invalido";
    case "conflict":
      return "conflicto";
    case "not_found":
      return "no-encontrado";
    default:
      return "error";
  }
}

/** Vuelta a la ficha si el id es un UUID; si no, al listado. */
function back(base: string, detail: (id: string) => string, rawId: unknown): string {
  const id = uuidSchema.safeParse(rawId);
  return id.success ? detail(id.data) : base;
}

export async function moderateUserAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const target = back(ADMIN_USERS_PATH, adminUserPath, formData.get("targetId"));
  const action = formData.get("action");
  if (
    !onlyAllowedKeys(formData) ||
    typeof action !== "string" ||
    !(ADMIN_USER_ACTIONS as readonly string[]).includes(action)
  )
    redirect(`${target}?aviso=error`);

  const result = await moderateUser(await createClient(), action as AdminUserAction, {
    targetId: formData.get("targetId"),
    reason: formData.get("reason"),
    confirm: formData.get("confirm") ?? undefined,
  });
  if (!result.ok) {
    if (result.error === "forbidden" || result.error === "unauthenticated") redirect("/");
    redirect(`${target}?aviso=${noticeFor(result.error)}`);
  }
  revalidatePath(ADMIN_USERS_PATH);
  revalidatePath(target);
  redirect(`${target}?aviso=${action === "suspend" ? "suspendida" : "reactivada"}`);
}

export async function moderateRoomAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const target = back(ADMIN_ROOMS_PATH, adminRoomPath, formData.get("targetId"));
  const action = formData.get("action");
  if (
    !onlyAllowedKeys(formData) ||
    typeof action !== "string" ||
    !(ADMIN_ROOM_ACTIONS as readonly string[]).includes(action)
  )
    redirect(`${target}?aviso=error`);

  const result = await moderateRoom(await createClient(), action as AdminRoomAction, {
    targetId: formData.get("targetId"),
    reason: formData.get("reason"),
    confirm: formData.get("confirm") ?? undefined,
  });
  if (!result.ok) {
    if (result.error === "forbidden" || result.error === "unauthenticated") redirect("/");
    redirect(`${target}?aviso=${noticeFor(result.error)}`);
  }
  revalidatePath(ADMIN_ROOMS_PATH);
  revalidatePath(target);
  redirect(`${target}?aviso=${action === "remove" ? "retirada" : "restaurada"}`);
}
