"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changeRoomStatus } from "@/app/actions/rooms";
import type { RoomStatusFormState } from "@/lib/validation/room-form";
import {
  OWNER_ROOM_STATUSES,
  ROOM_PUBLICATION_MESSAGES,
  ROOM_STATUS_LABELS,
  type OwnerRoomStatus,
  type RoomPublicationField,
} from "@/lib/validation/rooms";
import { FormError } from "@/components/onboarding/form-controls";
import { Button } from "@/components/ui/button";

/**
 * Cambio de estado de una habitación propia (R7, opción A; sesión 68). Un
 * formulario pequeño por estado de destino (`roomId` y `status` ocultos), que
 * comparten la misma Server Action: funciona sin JavaScript. Solo se ofrecen
 * `draft`, `active`, `paused` y `rented`; `removed` nunca (H5). Publicar exige
 * los datos completos (lo comprueba el servidor y `chk_rooms_publishable`),
 * no fotos. La página no lo muestra para una habitación retirada.
 */

const ACTION_LABELS: Record<OwnerRoomStatus, string> = {
  active: "Publicar",
  paused: "Pausar",
  rented: "Marcar como alquilada",
  draft: "Volver a borrador",
};

function StatusSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
      {pending ? "Cambiando…" : label}
    </Button>
  );
}

export function RoomStatusForms({
  roomId,
  status,
  missingForPublication,
}: {
  roomId: string;
  status: OwnerRoomStatus;
  missingForPublication: RoomPublicationField[];
}) {
  const [state, action] = useActionState<RoomStatusFormState, FormData>(
    changeRoomStatus,
    {}
  );
  const targets = OWNER_ROOM_STATUSES.filter((target) => target !== status);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Estado: <strong data-testid="room-status">{ROOM_STATUS_LABELS[status]}</strong>
      </p>
      {status !== "active" && missingForPublication.length > 0 ? (
        <div className="text-sm text-[var(--muted)]" role="note">
          <p>Para publicarla te falta:</p>
          <ul className="mt-1 list-disc pl-5">
            {missingForPublication.map((field) => (
              <li key={field}>{ROOM_PUBLICATION_MESSAGES[field]}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {targets.map((target) => (
          <form key={target} action={action}>
            <input type="hidden" name="roomId" value={roomId} />
            <input type="hidden" name="status" value={target} />
            <StatusSubmit label={ACTION_LABELS[target]} />
          </form>
        ))}
      </div>
      <FormError message={state.formError} />
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {state.success}
        </p>
      ) : null}
    </div>
  );
}
