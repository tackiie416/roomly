"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_DELETION_PATH, requireAccountForDeletion } from "@/lib/auth/session";
import { loginPath } from "@/lib/auth/destination";
import { deleteOwnAccount } from "@/lib/services/account-deletion";
import { formDataToObject } from "@/lib/validation/form-data";

/**
 * Server Action de `/ajustes/eliminar-cuenta` (sesión 87). Orquestación fina:
 * guard → campos del formulario → `deleteOwnAccount` (id de la sesión) →
 * cerrar la sesión en este navegador → `/cuenta-eliminada`. Cualquier campo de
 * más (un id, por ejemplo) lo rechaza el esquema estricto del servicio.
 */

const ACCOUNT_DELETED_PATH = "/cuenta-eliminada";

const FIELDS = { confirmation: "text", acknowledge: "checkbox" } as const;

export async function deleteAccountAction(formData: FormData): Promise<void> {
  await requireAccountForDeletion();

  const input = formDataToObject(formData, FIELDS, { emptyAs: "null" });
  const supabase = await createClient();
  const result = await deleteOwnAccount(supabase, input);

  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect(loginPath({ next: ACCOUNT_DELETION_PATH }));
      case "validation":
        redirect(`${ACCOUNT_DELETION_PATH}?aviso=confirmacion`);
      default:
        redirect(`${ACCOUNT_DELETION_PATH}?aviso=pendiente`);
    }
  }

  // El usuario ya no existe en Auth: solo se borran las cookies de este
  // navegador (sin llamar al servidor de Auth, que ya no lo conoce).
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Las cookies caducan solas; el token ya no sirve para nada.
  }
  redirect(ACCOUNT_DELETED_PATH);
}
