import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { updateRoom } from "@/app/actions/rooms";
import {
  ROOMS_PATH,
  roomDeletePath,
  roomEditPath,
  roomPhotosPath,
} from "@/lib/rooms/paths";
import { listLocationOptions } from "@/lib/services/reference-data";
import { getOwnRoomForEdit } from "@/lib/services/rooms";
import { uuidSchema } from "@/lib/validation/common";
import { roomFormValues } from "@/lib/validation/room-form";
import {
  OWNER_ROOM_STATUSES,
  ROOM_STATUS_LABELS,
  missingPublicationFields,
  type OwnerRoomStatus,
} from "@/lib/validation/rooms";
import { RoomForm } from "@/components/rooms/room-form";
import { RoomStatusForms } from "@/components/rooms/room-status-forms";
import { Card } from "@/components/ui/card";

const LOAD_ERROR =
  "No hemos podido cargar la habitación. Vuelve a intentarlo en un momento.";

const isOwnerStatus = (status: string): status is OwnerRoomStatus =>
  (OWNER_ROOM_STATUSES as readonly string[]).includes(status);

/**
 * Edición de una habitación propia (`/habitaciones/[id]/editar`, sesión 68).
 * El guard va en la página, antes de leer nada. Después, `getOwnRoomForEdit`
 * solo devuelve la habitación a su propietaria: a cualquier otra persona,
 * también a un admin, 404 (la moderación es de la Fase 7, no de este CRUD).
 * Una habitación retirada (`removed`) se muestra sin formularios: no se edita
 * ni cambia de estado desde aquí, aunque sí se pueden quitar sus fotos o
 * borrarla.
 */
export default async function EditRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  const path = parsed.success ? roomEditPath(parsed.data) : undefined;
  await requireActiveProfile(path);
  if (!parsed.success) notFound();

  const supabase = await createClient();
  const result = await getOwnRoomForEdit(supabase, parsed.data);
  if (!result.ok) {
    if (result.error === "unauthenticated") redirect(loginPath({ next: path }));
    if (result.error === "deleted") redirect(DEACTIVATED_PATH);
    if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
    if (result.error === "not_found") notFound();
    throw new Error(LOAD_ERROR);
  }
  const room = result.data;
  const status = room.status;
  const editable = isOwnerStatus(status);

  let options = null;
  if (editable) {
    const loaded = await listLocationOptions(supabase, room.city_id);
    if (!loaded.ok) throw new Error(LOAD_ERROR);
    options = loaded.data;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-xl font-medium">Editar habitación</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{room.title}</p>
      </div>

      <nav aria-label="Gestión de la habitación" className="flex flex-wrap gap-4 text-sm">
        <Link href={roomPhotosPath(room.id)} className="underline">
          Fotos
        </Link>
        <Link href={ROOMS_PATH} className="underline">
          Tus habitaciones
        </Link>
        <Link href={roomDeletePath(room.id)} className="text-red-700 underline">
          Borrar la habitación
        </Link>
      </nav>

      {editable && options ? (
        <>
          <Card>
            <RoomStatusForms
              roomId={room.id}
              status={status}
              missingForPublication={missingPublicationFields(room)}
            />
          </Card>
          <Card>
            <RoomForm
              action={updateRoom}
              roomId={room.id}
              cities={options.cities}
              neighborhoods={options.neighborhoods}
              initialValues={roomFormValues(room)}
              submitLabel="Guardar cambios"
            />
          </Card>
        </>
      ) : (
        <Card>
          <p role="note" className="text-sm">
            Estado: <strong>{ROOM_STATUS_LABELS[status] ?? status}</strong>. Esta
            habitación está retirada por moderación: no se puede editar ni cambiar de
            estado. Puedes quitar sus fotos o borrarla.
          </p>
        </Card>
      )}
    </main>
  );
}
