import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth/session";
import {
  DEACTIVATED_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
} from "@/lib/auth/destination";
import {
  ROOMS_PATH,
  roomDeletePath,
  roomEditPath,
  roomPhotosPath,
} from "@/lib/rooms/paths";
import { getRoomPhotos, type RoomPhotosView } from "@/lib/services/rooms";
import { uuidSchema } from "@/lib/validation/common";
import {
  RoomPhotoDeleteForm,
  RoomPhotoUploadForm,
} from "@/components/rooms/room-photo-forms";
import { Card } from "@/components/ui/card";

/**
 * Fotos de una habitación (`/habitaciones/[id]/fotos`, Fase 4.2). El guard va
 * en la página: sin sesión → `/login`, sin perfil → onboarding, cuenta
 * desactivada → `/cuenta-desactivada`, antes de leer nada. Después,
 * `getRoomPhotos` decide quién la ve: la propietaria la gestiona, un admin
 * activo solo la mira y a cualquier otra persona se le responde 404, también
 * si la habitación es pública (esta no es la ficha pública).
 *
 * Las fotos se muestran solo con las URL firmadas que devuelve el servicio
 * (bucket privado, 10 minutos): nunca con una URL pública ni con una ruta de
 * Storage. Se usa `<img>` y no `next/image`: la optimización de imágenes
 * pasaría las URL firmadas por `/_next/image`, que las guardaría en su caché
 * más tiempo del que valen y exigiría abrir `images.remotePatterns`.
 *
 * Tras crear una habitación (sesión 68) la acción redirige aquí con
 * `?creada=1`: el parámetro solo elige un mensaje, no da acceso a nada.
 */
export default async function RoomPhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const created = (await searchParams)?.creada === "1";
  const parsed = uuidSchema.safeParse(id);
  const path = parsed.success ? roomPhotosPath(parsed.data) : undefined;
  await requireActiveProfile(path);
  if (!parsed.success) notFound();

  const result = await getRoomPhotos(await createClient(), parsed.data);
  if (!result.ok) {
    if (result.error === "unauthenticated") redirect(loginPath({ next: path }));
    if (result.error === "deleted") redirect(DEACTIVATED_PATH);
    if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
    if (result.error === "not_found") notFound();
    throw new Error(
      "No hemos podido cargar las fotos. Vuelve a intentarlo en un momento."
    );
  }

  return <RoomPhotos view={result.data} created={created} />;
}

function RoomPhotos({ view, created }: { view: RoomPhotosView; created: boolean }) {
  const { room, images } = view;
  const owner = view.access === "owner";
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-xl font-medium">Fotos de la habitación</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{room.title}</p>
      </div>

      {owner && created ? (
        <p
          role="status"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          Habitación creada como borrador. Puedes añadir fotos ahora (no son obligatorias
          para publicarla) o volver a sus datos para completarla y publicarla.
        </p>
      ) : null}

      {owner ? (
        <nav
          aria-label="Gestión de la habitación"
          className="flex flex-wrap gap-4 text-sm"
        >
          <Link href={roomEditPath(room.id)} className="underline">
            Datos y estado
          </Link>
          <Link href={ROOMS_PATH} className="underline">
            Tus habitaciones
          </Link>
        </nav>
      ) : null}

      {!owner ? (
        <p
          role="note"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          Vista de administración: solo lectura.
        </p>
      ) : null}

      <Card className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Fotos</h2>
          {images ? (
            <p className="text-xs text-[var(--muted)]">
              {images.length} de {view.maxImages}
            </p>
          ) : null}
        </div>

        {images === null ? (
          <p role="alert" className="text-sm text-red-600">
            No hemos podido cargar las fotos. Recarga la página en un momento.
          </p>
        ) : images.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Esta habitación todavía no tiene fotos.
          </p>
        ) : (
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            aria-label="Fotos de la habitación"
          >
            {images.map((image, index) => (
              <li key={image.id} className="flex flex-col gap-2">
                {image.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada que caduca: ver el comentario de la página.
                  <img
                    src={image.url}
                    alt={`Foto ${index + 1} de la habitación`}
                    className="aspect-[4/3] w-full rounded-[var(--radius)] border border-[var(--border)] object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] p-2 text-center text-xs text-[var(--muted)]">
                    No se ha podido cargar esta foto. Recarga la página.
                  </div>
                )}
                {view.canDelete ? (
                  <RoomPhotoDeleteForm
                    roomId={room.id}
                    imageId={image.id}
                    position={index + 1}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {images && images.length > 0 ? (
          <p className="text-xs text-[var(--muted)]">
            Los enlaces de las fotos caducan a los 10 minutos. Si dejan de verse, recarga
            la página.
          </p>
        ) : null}
      </Card>

      {owner ? (
        <Card className="flex flex-col gap-3">
          {view.canUpload ? (
            <RoomPhotoUploadForm roomId={room.id} />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              {room.status === "removed"
                ? "Esta habitación está retirada: puedes quitar fotos, pero no añadir más."
                : images && images.length >= view.maxImages
                  ? `Has llegado al máximo de ${view.maxImages} fotos. Quita alguna para añadir otra.`
                  : "Ahora no se pueden añadir fotos. Recarga la página en un momento."}
            </p>
          )}
        </Card>
      ) : null}

      {owner ? (
        <p className="text-sm">
          <Link href={roomDeletePath(room.id)} className="text-red-700 underline">
            Borrar la habitación
          </Link>
        </p>
      ) : null}
    </main>
  );
}
