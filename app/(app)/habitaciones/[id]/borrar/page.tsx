import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import { roomDeletePath, roomPhotosPath } from "@/lib/rooms/paths";
import { getOwnRoomForDeletion } from "@/lib/services/rooms";
import { uuidSchema } from "@/lib/validation/common";
import { DeleteRoomForm } from "@/components/rooms/room-photo-forms";
import { Card } from "@/components/ui/card";

/**
 * Confirmación del borrado de una habitación (`/habitaciones/[id]/borrar`,
 * Fase 4.2). Solo para la propietaria con la cuenta activa: a cualquier otra
 * persona, también a un admin, 404. El borrado lo hace la Server Action
 * `deleteRoom` en el servidor (lib/services/rooms.ts), que vuelve a comprobarlo
 * todo antes de cambiar nada.
 */
export default async function DeleteRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  const path = parsed.success ? roomDeletePath(parsed.data) : undefined;
  await requireActiveProfile(path);
  if (!parsed.success) notFound();

  const result = await getOwnRoomForDeletion(await createClient(), parsed.data);
  if (!result.ok) {
    if (result.error === "unauthenticated") redirect(loginPath({ next: path }));
    if (result.error === "deleted") redirect(DEACTIVATED_PATH);
    if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
    if (result.error === "not_found") notFound();
    throw new Error(
      "No hemos podido cargar la habitación. Vuelve a intentarlo en un momento."
    );
  }
  const { room, photoCount } = result.data;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-medium">Borrar la habitación</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{room.title}</p>
        </div>
        <p className="text-sm">
          {photoCount === 0
            ? "Se borrará la habitación, que no tiene fotos."
            : photoCount === 1
              ? "Se borrarán la habitación y su foto."
              : `Se borrarán la habitación y sus ${photoCount} fotos.`}{" "}
          No se puede deshacer.
        </p>
        <DeleteRoomForm roomId={room.id} />
        <Link href={roomPhotosPath(room.id)} className="text-sm underline">
          Cancelar
        </Link>
      </Card>
    </main>
  );
}
