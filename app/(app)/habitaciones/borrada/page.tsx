import Link from "next/link";
import { requireActiveProfile } from "@/lib/auth/session";
import { ROOM_DELETED_PATH } from "@/lib/rooms/paths";
import { Card } from "@/components/ui/card";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Confirmación tras borrar una habitación (Fase 4.2). La Server Action
 * `deleteRoom` redirige aquí; con `?fotos=pendientes` si la limpieza de
 * Storage no se ha podido completar. Nunca se dice que todo se ha borrado si
 * quedan objetos. El parámetro solo elige el mensaje: no da acceso a nada.
 */
export default async function RoomDeletedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireActiveProfile(ROOM_DELETED_PATH);
  const pending = (await searchParams).fotos === "pendientes";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-4">
        <h1 className="text-xl font-medium">Habitación borrada</h1>
        {pending ? (
          <p role="status" className="text-sm">
            La habitación se ha borrado, pero algunas de sus fotos no se han podido
            eliminar todavía del almacenamiento. Nadie puede verlas, y quedan pendientes
            de limpieza.
          </p>
        ) : (
          <p role="status" className="text-sm">
            La habitación y sus fotos se han borrado.
          </p>
        )}
        <Link href="/perfil" className="text-sm underline">
          Volver a tu perfil
        </Link>
      </Card>
    </main>
  );
}
