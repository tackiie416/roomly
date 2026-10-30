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
import {
  NEW_ROOM_PATH,
  ROOMS_PATH,
  ROOM_DELETED_PATH,
  roomDeletePath,
  roomEditPath,
  roomPhotosPath,
} from "@/lib/rooms/paths";
import {
  changeOwnRoomStatus,
  createOwnRoom,
  deleteOwnRoom,
  updateOwnRoom,
} from "@/lib/services/rooms";
import type { FieldErrors, ServiceResult } from "@/lib/services/result";
import { FORM_ERROR_KEY, uuidSchema } from "@/lib/validation/common";
import { formDataToObject, formDataValues } from "@/lib/validation/form-data";
import {
  roomFormValues,
  type RoomFormState,
  type RoomFormValues,
  type RoomStatusFormState,
} from "@/lib/validation/room-form";
import {
  ROOM_FORM_FIELDS,
  ROOM_PUBLICATION_REQUIRED_FIELDS,
  ROOM_STATUS_LABELS,
} from "@/lib/validation/rooms";

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

// ------------------------------------------------------------------
// CRUD de habitaciones propias (sesión 68)
// ------------------------------------------------------------------
//
// Orquestación fina sobre lib/services/rooms.ts (createOwnRoom,
// updateOwnRoom, changeOwnRoomStatus), con el cliente del usuario: nunca
// service_role. Del navegador llegan los campos del formulario y, al editar o
// cambiar el estado, `roomId`. Nunca `owner_id` (sale de la sesión), `status`
// al crear, `deleted_at` ni `approx_*`: los esquemas `strict` rechazan
// cualquier otra clave. El guard va en cada acción, antes de leer nada.

const ROOM_NOT_FOUND = "No encontramos esa habitación entre las tuyas.";
const ROOM_LOCKED = "Esta habitación está retirada por moderación: no se puede cambiar.";
const CHECK_FIELDS_ERROR = "Revisa los datos marcados.";
const SAVE_ERROR =
  "No hemos podido guardar la habitación. Vuelve a intentarlo en un momento.";
const STATUS_ERROR =
  "No hemos podido cambiar el estado. Vuelve a intentarlo en un momento.";

/** Sin sesión, sin perfil o con la cuenta desactivada: a donde toque, como el guard. */
function redirectForAccount(
  result: Extract<ServiceResult<unknown>, { ok: false }>,
  path: string | undefined
): void {
  if (result.error === "unauthenticated") redirect(loginPath({ next: path }));
  if (result.error === "deleted") redirect(DEACTIVATED_PATH);
  if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
}

/** Errores de campo del formulario; los demás (incluido `_form`) van al error general. */
function toFormState(fieldErrors: FieldErrors, values: RoomFormValues): RoomFormState {
  const own: FieldErrors = {};
  const general: string[] = [];
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (key in ROOM_FORM_FIELDS) own[key] = messages;
    else general.push(...messages);
  }
  const formError =
    general.length > 0
      ? general.join(" ")
      : Object.keys(own).length > 0
        ? undefined
        : CHECK_FIELDS_ERROR;
  return { fieldErrors: own, formError, values };
}

/** `roomId` del formulario: un único valor y un UUID; si no, `null`. */
function formRoomId(formData: FormData): string | null {
  const values = formData.getAll("roomId");
  if (values.length !== 1) return null;
  const parsed = uuidSchema.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}

/** Campos del formulario de habitación. Vacío → null: vaciar un campo opcional lo borra. */
function roomInput(formData: FormData): Record<string, unknown> {
  const input = formDataToObject(formData, ROOM_FORM_FIELDS, { emptyAs: "null" });
  // `roomId` identifica la habitación (ya validado aparte); no es un campo.
  delete input.roomId;
  return input;
}

/** Alta: la habitación nace en borrador y se va a sus fotos. */
export async function createRoom(
  _previous: RoomFormState,
  formData: FormData
): Promise<RoomFormState> {
  await requireActiveProfile(NEW_ROOM_PATH);

  const values = formDataValues(formData, ROOM_FORM_FIELDS);
  const input = formDataToObject(formData, ROOM_FORM_FIELDS, { emptyAs: "null" });
  const result = await createOwnRoom(await createClient(), input);
  if (!result.ok) {
    redirectForAccount(result, NEW_ROOM_PATH);
    if (result.error === "validation")
      return toFormState(result.fieldErrors ?? {}, values);
    if (result.error === "forbidden")
      return { formError: "No puedes crear habitaciones con esta cuenta.", values };
    return { formError: SAVE_ERROR, values };
  }

  revalidatePath(ROOMS_PATH);
  redirect(`${roomPhotosPath(result.data.id)}?creada=1`);
}

/** Edición de los datos de una habitación propia (no de su estado). */
export async function updateRoom(
  _previous: RoomFormState,
  formData: FormData
): Promise<RoomFormState> {
  const roomId = formRoomId(formData);
  const path = roomId ? roomEditPath(roomId) : undefined;
  await requireActiveProfile(path);

  const values = formDataValues(formData, ROOM_FORM_FIELDS);
  if (!roomId) return { formError: ROOM_NOT_FOUND, values };

  const result = await updateOwnRoom(await createClient(), roomId, roomInput(formData));
  if (!result.ok) {
    redirectForAccount(result, path);
    if (result.error === "validation")
      return toFormState(result.fieldErrors ?? {}, values);
    if (result.error === "not_found") return { formError: ROOM_NOT_FOUND, values };
    if (result.error === "forbidden") return { formError: ROOM_LOCKED, values };
    return { formError: SAVE_ERROR, values };
  }

  revalidatePath(ROOMS_PATH);
  revalidatePath(roomEditPath(roomId));
  return { success: "Cambios guardados.", values: roomFormValues(result.data) };
}

/** Errores de validación del cambio de estado → un único mensaje, sin detalles técnicos. */
function statusValidationState(fieldErrors: FieldErrors = {}): RoomStatusFormState {
  if (fieldErrors.roomId) return { formError: ROOM_NOT_FOUND };
  // Lo que le falta para publicarse (comprobado antes de escribir).
  const missing = ROOM_PUBLICATION_REQUIRED_FIELDS.flatMap(
    (field) => fieldErrors[field] ?? []
  );
  if (missing.length > 0)
    return {
      formError: `Todavía no se puede publicar. ${missing.join(". ")}. Complétalo en el formulario y guarda los cambios.`,
    };
  if (fieldErrors.status) return { formError: "Ese estado no está disponible." };
  // `_form`: una clave no permitida o `chk_rooms_publishable` (ya traducido).
  const general = fieldErrors[FORM_ERROR_KEY] ?? [];
  return { formError: general.length > 0 ? general.join(" ") : STATUS_ERROR };
}

/**
 * Cambio de estado (R7, opción A): `draft`, `active`, `paused` o `rented`.
 * Solo llegan `roomId` y `status`; publicar exige los datos completos (el
 * servicio lo comprueba y `chk_rooms_publishable` lo vuelve a exigir), no fotos.
 */
export async function changeRoomStatus(
  _previous: RoomStatusFormState,
  formData: FormData
): Promise<RoomStatusFormState> {
  const roomId = formRoomId(formData);
  const path = roomId ? roomEditPath(roomId) : undefined;
  await requireActiveProfile(path);
  if (!roomId) return { formError: ROOM_NOT_FOUND };

  const input = formDataToObject(
    formData,
    { roomId: "text", status: "text" },
    { emptyAs: "omit" }
  );
  const result = await changeOwnRoomStatus(await createClient(), input);
  if (!result.ok) {
    redirectForAccount(result, path);
    if (result.error === "validation") return statusValidationState(result.fieldErrors);
    if (result.error === "not_found") return { formError: ROOM_NOT_FOUND };
    if (result.error === "forbidden") return { formError: ROOM_LOCKED };
    return { formError: STATUS_ERROR };
  }

  revalidatePath(ROOMS_PATH);
  revalidatePath(roomEditPath(roomId));
  return {
    success: `Estado actualizado: ${ROOM_STATUS_LABELS[result.data.status] ?? result.data.status}.`,
  };
}
