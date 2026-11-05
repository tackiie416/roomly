"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { roomPhotosPath } from "@/lib/rooms/paths";
import { addRoomImage, deleteRoomImage } from "@/lib/services/room-images";
import type { FieldErrors, ServiceResult } from "@/lib/services/result";
import { uuidSchema } from "@/lib/validation/common";
import { formDataToObject } from "@/lib/validation/form-data";
import { ROOM_IMAGE_MAX_BYTES, ROOM_IMAGE_MESSAGES } from "@/lib/validation/room-images";

/**
 * Server Actions de las fotos de una habitación (Fase 4.2). Orquestación
 * fina: guard → FormData → `lib/services/room-images.ts` → estado del
 * formulario. La lógica y las comprobaciones (sesión, cuenta activa,
 * propiedad y estado de la habitación, 8 fotos, tipo real y limpieza) son
 * del servicio, con el cliente del usuario; service_role solo lo usa el
 * servicio, después de esas comprobaciones.
 *
 * Del navegador solo llegan `roomId` y la foto (al subir) o `roomId` e
 * `imageId` (al quitar). Nunca la ruta, la posición, el propietario ni el
 * nombre de archivo, que no se usan: el esquema `strict` del servicio rechaza
 * cualquier otra clave. `roomId` se valida como UUID antes de construir la
 * ruta de la página, que solo se usa para volver tras el login y para
 * `revalidatePath`.
 *
 * Tamaño: Next.js lee el cuerpo entero hasta `serverActions.bodySizeLimit`
 * (`next.config.ts`, 5 MB) antes de llamar a la acción. Aquí se rechaza una
 * foto de más de 4 MiB por su tamaño, antes de cualquier consulta, sin leer
 * sus bytes; el servicio lo vuelve a comprobar antes de convertirla en un
 * buffer.
 */

export type RoomPhotoFormState = {
  /** Error de la foto (tamaño, tipo, límite de 8…), sin detalles técnicos. */
  photoError?: string;
  /** Error general (habitación, permisos o fallo del servidor). */
  formError?: string;
  success?: string;
};

const UPLOAD_ERROR = "No hemos podido subir la foto. Vuelve a intentarlo en un momento.";
const DELETE_ERROR = "No hemos podido quitar la foto. Vuelve a intentarlo en un momento.";
const ROOM_NOT_FOUND = "No encontramos esa habitación entre las tuyas.";
const ROOM_LOCKED = "Esta habitación no admite fotos nuevas.";
const PHOTO_NOT_FOUND = "Esa foto ya no está en tu habitación.";

/** `roomId` del formulario, solo si es un UUID (en minúsculas, como la base de datos). */
function formRoomId(formData: FormData): string | null {
  const parsed = uuidSchema.safeParse(formData.get("roomId"));
  return parsed.success ? parsed.data : null;
}

/** Sin sesión, sin perfil o con la cuenta desactivada: a donde toque, como el guard. */
function redirectForAccount(
  result: Extract<ServiceResult<unknown>, { ok: false }>,
  path: string | null
): void {
  if (result.error === "unauthenticated") redirect(loginPath({ next: path }));
  if (result.error === "deleted") redirect(DEACTIVATED_PATH);
  if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
}

/** Errores de validación del servicio → estado del formulario. */
function validationState(fieldErrors: FieldErrors = {}): RoomPhotoFormState {
  const { photo, roomId, ...rest } = fieldErrors;
  const general = Object.values(rest).flat();
  if (roomId) return { formError: ROOM_NOT_FOUND };
  return {
    photoError: photo?.join(" "),
    formError: general.length > 0 ? general.join(" ") : undefined,
  };
}

export async function uploadRoomPhoto(
  _previous: RoomPhotoFormState,
  formData: FormData
): Promise<RoomPhotoFormState> {
  const roomId = formRoomId(formData);
  const path = roomId ? roomPhotosPath(roomId) : null;
  await requireActiveProfile(path ?? undefined);

  const input = formDataToObject(
    formData,
    { roomId: "text", photo: "text" },
    { emptyAs: "omit" }
  );
  const photo = input.photo;
  if (photo instanceof File) {
    // Un campo de archivo sin elegir llega como un archivo vacío sin nombre.
    if (photo.size === 0 && photo.name === "") delete input.photo;
    else if (photo.size > ROOM_IMAGE_MAX_BYTES)
      return { photoError: ROOM_IMAGE_MESSAGES.tooLarge };
  }

  const result = await addRoomImage(await createClient(), input);
  if (!result.ok) {
    redirectForAccount(result, path);
    switch (result.error) {
      case "validation":
        return validationState(result.fieldErrors);
      case "not_found":
        return { formError: ROOM_NOT_FOUND };
      case "forbidden":
        return { formError: ROOM_LOCKED };
      default:
        return { formError: UPLOAD_ERROR };
    }
  }

  if (path) revalidatePath(path);
  return { success: "Foto añadida." };
}

const DELETE_FIELDS = new Set(["roomId", "imageId"]);

export async function deleteRoomPhoto(
  _previous: RoomPhotoFormState,
  formData: FormData
): Promise<RoomPhotoFormState> {
  const roomId = formRoomId(formData);
  const path = roomId ? roomPhotosPath(roomId) : null;
  await requireActiveProfile(path ?? undefined);

  // Solo la habitación (para la página) y la foto: la ruta del objeto la
  // decide el servidor a partir de la fila, nunca el navegador.
  const extra = [...new Set(formData.keys())].filter(
    (key) => !DELETE_FIELDS.has(key) && !key.startsWith("$ACTION_")
  );
  if (extra.length > 0) return { formError: "Campo no permitido" };

  const result = await deleteRoomImage(await createClient(), formData.get("imageId"));
  if (!result.ok) {
    redirectForAccount(result, path);
    switch (result.error) {
      case "validation":
      case "not_found":
        return { formError: PHOTO_NOT_FOUND };
      case "forbidden":
        return { formError: "No puedes quitar esta foto." };
      default:
        return { formError: DELETE_ERROR };
    }
  }

  if (path) revalidatePath(path);
  return { success: "Foto quitada." };
}
