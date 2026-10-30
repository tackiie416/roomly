import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth/session";
import { createRoom } from "@/app/actions/rooms";
import { NEW_ROOM_PATH, ROOMS_PATH } from "@/lib/rooms/paths";
import { listLocationOptions } from "@/lib/services/reference-data";
import { EMPTY_ROOM_FORM_VALUES } from "@/lib/validation/room-form";
import { RoomForm } from "@/components/rooms/room-form";
import { Card } from "@/components/ui/card";

/**
 * Alta de una habitación (`/habitaciones/nueva`, sesión 68). El guard va en
 * la página: sin sesión → `/login`, sin perfil → onboarding, cuenta
 * desactivada → `/cuenta-desactivada`, antes de leer nada. La habitación nace
 * en borrador (la base de datos pone `status`) y, al crearla, la acción lleva
 * a sus fotos. Ubicación: solo ciudad y barrio (R2).
 */
export default async function NewRoomPage() {
  await requireActiveProfile(NEW_ROOM_PATH);
  const options = await listLocationOptions(await createClient(), null);
  if (!options.ok)
    throw new Error(
      "No hemos podido cargar el formulario. Vuelve a intentarlo en un momento."
    );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-xl font-medium">Nueva habitación</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Se guarda como borrador: nadie la ve hasta que la publiques. Después podrás
          añadir fotos.
        </p>
      </div>
      <Card>
        <RoomForm
          action={createRoom}
          cities={options.data.cities}
          neighborhoods={options.data.neighborhoods}
          initialValues={EMPTY_ROOM_FORM_VALUES}
          submitLabel="Crear borrador"
          pendingLabel="Creando…"
        />
      </Card>
      <p className="text-sm">
        <Link href={ROOMS_PATH} className="underline">
          Volver a tus habitaciones
        </Link>
      </p>
    </main>
  );
}
