"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  deleteRoomPhoto,
  uploadRoomPhoto,
  type RoomPhotoFormState,
} from "@/app/actions/room-images";
import { deleteRoom, type RoomDeleteFormState } from "@/app/actions/rooms";
import {
  FieldError,
  FormError,
  SubmitButton,
  hintClass,
  labelClass,
} from "@/components/onboarding/form-controls";
import { Button } from "@/components/ui/button";
import {
  ROOM_IMAGE_ACCEPTED_TYPES,
  ROOM_IMAGE_MAX_BYTES,
  ROOM_IMAGE_MESSAGES,
} from "@/lib/validation/room-images";

/**
 * Formularios de la gestión de fotos y del borrado de una habitación (Fase
 * 4.2). Formularios HTML + Server Actions: funcionan sin JavaScript. Solo
 * envían ids (`roomId`, `imageId`) y la foto; las rutas, posiciones y
 * permisos los decide el servidor. Con JavaScript, una foto de más de 4 MB se
 * avisa antes de enviarla; sin él (o si se salta), la rechaza el servidor.
 * Solo se muestran a quien puede escribir: la página decide con lo que
 * devuelve el servicio.
 */

export function RoomPhotoUploadForm({ roomId }: { roomId: string }) {
  const [state, action] = useActionState<RoomPhotoFormState, FormData>(
    uploadRoomPhoto,
    {}
  );
  const [tooLarge, setTooLarge] = useState(false);
  const photoError = tooLarge ? ROOM_IMAGE_MESSAGES.tooLarge : state.photoError;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="roomId" value={roomId} />
      <div>
        <label htmlFor="room-photo" className={labelClass}>
          Añadir una foto
        </label>
        <input
          id="room-photo"
          type="file"
          name="photo"
          required
          accept={ROOM_IMAGE_ACCEPTED_TYPES.join(",")}
          aria-describedby="room-photo-hint room-photo-error"
          aria-invalid={photoError ? true : undefined}
          className="mt-1 block w-full text-sm"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            const large = file !== undefined && file.size > ROOM_IMAGE_MAX_BYTES;
            setTooLarge(large);
            if (large) event.currentTarget.value = "";
          }}
        />
        <p id="room-photo-hint" className={`mt-1 ${hintClass}`}>
          JPEG, PNG o WebP de hasta 4 MB. La guardamos sin la ubicación ni los datos de la
          cámara.
        </p>
        <FieldError
          id="room-photo-error"
          messages={photoError ? [photoError] : undefined}
        />
      </div>
      <FormError message={state.formError} />
      {state.success && !tooLarge ? (
        <p role="status" className="text-sm text-green-700">
          {state.success}
        </p>
      ) : null}
      <SubmitButton label="Subir foto" pendingLabel="Subiendo…" />
    </form>
  );
}

function SecondarySubmit({
  label,
  pendingLabel,
  accessibleLabel,
}: {
  label: string;
  pendingLabel: string;
  accessibleLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="secondary"
      disabled={pending}
      aria-disabled={pending}
      aria-label={accessibleLabel}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function RoomPhotoDeleteForm({
  roomId,
  imageId,
  position,
}: {
  roomId: string;
  imageId: string;
  /** Número de la foto (desde 1), para el nombre accesible del botón. */
  position: number;
}) {
  const [state, action] = useActionState<RoomPhotoFormState, FormData>(
    deleteRoomPhoto,
    {}
  );
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="imageId" value={imageId} />
      <SecondarySubmit
        label="Quitar"
        pendingLabel="Quitando…"
        accessibleLabel={`Quitar la foto ${position}`}
      />
      <FormError message={state.formError} />
    </form>
  );
}

export function DeleteRoomForm({ roomId }: { roomId: string }) {
  const [state, action] = useActionState<RoomDeleteFormState, FormData>(deleteRoom, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="roomId" value={roomId} />
      <FormError message={state.formError} />
      <SubmitButton label="Borrar la habitación" pendingLabel="Borrando…" />
    </form>
  );
}
