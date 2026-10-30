"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { ROOM_DELETED_PATH, roomDeletePath } from "@/lib/rooms/paths";
import { deleteOwnRoom } from "@/lib/services/rooms";
import { uuidSchema } from "@/lib/validation/common";

/**
 * Server Action del borrado de una habitación (Fase 4.2). Orquestación fina
 * sobre `deleteOwnRoom` (lib/services/rooms.ts), que comprueba la sesión, la
 * cuenta y la propiedad antes de cambiar nada, borra la habitación con
 * `delete_own_room` (la única vía desde 20261030120000) y después los objetos
 * de sus fotos con las rutas que devuelve. Del navegador solo llega `roomId`:
 * nunca rutas, ids de fotos ni el usuario.
 *
 * Tras el borrado se redirige a una página de confirmación, porque la de la
 * habitación ya no existe. Si quedan objetos pendientes de limpieza, la
 * confirmación lo dice: nunca se informa de un borrado completo que no lo ha
 * sido.
 */

export type RoomDeleteFormState = { formError?: string };

export async function deleteRoom(
  _previous: RoomDeleteFormState,
  formData: FormData
): Promise<RoomDeleteFormState> {
  const parsed = uuidSchema.safeParse(formData.get("roomId"));
  const path = parsed.success ? roomDeletePath(parsed.data) : undefined;
  await requireActiveProfile(path);

  const extra = [...new Set(formData.keys())].filter(
    (key) => key !== "roomId" && !key.startsWith("$ACTION_")
  );
  if (extra.length > 0) return { formError: "Campo no permitido" };
  if (!parsed.success)
    return { formError: "No encontramos esa habitación entre las tuyas." };

  const result = await deleteOwnRoom(await createClient(), parsed.data);
  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect(loginPath({ next: path }));
      case "deleted":
        redirect(DEACTIVATED_PATH);
      case "no_profile":
        redirect(ONBOARDING_PROFILE_PATH);
      case "not_found":
        return { formError: "No encontramos esa habitación entre las tuyas." };
      case "forbidden":
        return { formError: "No puedes borrar esta habitación." };
      case "conflict":
        return {
          formError:
            "Esta habitación no se puede borrar ahora: tiene actividad asociada, como un reporte.",
        };
      default:
        return {
          formError:
            "No hemos podido borrar la habitación. Vuelve a intentarlo en un momento.",
        };
    }
  }

  redirect(
    result.data.photosRemoved
      ? ROOM_DELETED_PATH
      : `${ROOM_DELETED_PATH}?fotos=pendientes`
  );
}
