import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPublicEnv } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";
import { getPublicRoom, type PublicRoomDetail } from "@/lib/services/room-search";
import { publicRoomPath, roomSearchPath } from "@/lib/validation/room-search";
import { NeighborhoodsAttribution } from "@/components/rooms/neighborhoods-attribution";
import {
  bedroomsText,
  formatEuros,
  formatPublicDate,
  roommatesText,
} from "@/components/rooms/public-room-card";

/**
 * Detalle público de una habitación (`/[city]/habitaciones/[id]`, Fase 4.4,
 * R4). Sin sesión y sin guard, como la búsqueda; lee SIEMPRE con el cliente
 * de un visitante (`createPublicClient`), así que la propietaria y el admin
 * tampoco ven aquí un borrador ni una habitación oculta.
 *
 * 404 indistinguible (`notFound()`, la misma página y el mismo estado) si el
 * id no es válido, la ciudad no existe o no está activa, o la habitación no
 * existe, es de otra ciudad o no es pública (borrador, pausada, alquilada,
 * retirada, eliminada o de una cuenta desactivada).
 *
 * Muestra solo `PublicRoomDetail` (lista blanca): ni la propietaria, ni
 * coordenadas, ni dirección (R2: barrio y ciudad). Los textos libres los
 * escribe la propietaria; el formulario de publicación le pide no poner datos
 * de contacto ni la dirección, pero nada lo garantiza.
 *
 * Fotos con URL firmadas que caducan a los 10 minutos: dinámica en cada
 * petición, sin ISR, y con `<img>` (no `next/image`, que las guardaría en su
 * caché).
 */

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ city: string; id: string }> };

const LOAD_ERROR =
  "No hemos podido cargar esta habitación. Vuelve a intentarlo en un momento.";

/** Una lectura por petición, compartida por los metadatos y la página. */
const loadRoom = cache((citySlug: string, roomId: string) =>
  getPublicRoom(createPublicClient(), citySlug, roomId)
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { city, id } = await params;
  const result = await loadRoom(city, id);
  if (!result.ok)
    return { title: "Página no encontrada | Roomly", robots: { index: false } };
  const room = result.data;
  const place = [room.neighborhood, room.city.name].filter(Boolean).join(", ");
  return {
    metadataBase: new URL(getPublicEnv().NEXT_PUBLIC_SITE_URL),
    title: `${room.title} · Habitación en ${place} | Roomly`,
    description: `Habitación en ${place}: ${formatEuros(room.priceMonth)} al mes, disponible desde el ${formatPublicDate(room.availableFrom)}.`,
    alternates: { canonical: publicRoomPath(room.city.slug, room.id) },
    robots: { index: true, follow: true },
  };
}

function yesNo(value: boolean, yes: string, no: string) {
  return value ? yes : no;
}

function stayText(room: PublicRoomDetail): string {
  const { minStayMonths: min, maxStayMonths: max } = room;
  if (min !== null && max !== null)
    return min === max ? `${min} meses` : `De ${min} a ${max} meses`;
  if (min !== null) return `Mínimo ${min} ${min === 1 ? "mes" : "meses"}`;
  if (max !== null) return `Máximo ${max} ${max === 1 ? "mes" : "meses"}`;
  return "Sin mínimo ni máximo";
}

function TextBlock({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="font-medium">{title}</h2>
      <p className="whitespace-pre-line text-sm">{text}</p>
    </section>
  );
}

export default async function PublicRoomPage({ params }: PageProps) {
  const { city, id } = await params;
  const result = await loadRoom(city, id);
  if (!result.ok) {
    if (result.error === "not_found") notFound();
    throw new Error(LOAD_ERROR);
  }
  const room = result.data;
  const place = [room.neighborhood, room.city.name].filter(Boolean).join(", ");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <Link href={roomSearchPath(room.city.slug)} className="text-sm underline">
        Volver a las habitaciones en {room.city.name}
      </Link>

      <div>
        <h1 className="text-xl font-medium">{room.title}</h1>
        <p
          className="mt-1 text-sm text-[var(--muted)]"
          data-testid="public-room-location"
        >
          {place}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Solo mostramos el barrio y la ciudad, nunca la dirección exacta.
        </p>
      </div>

      {!room.photos.available ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          No hemos podido cargar las fotos. Recarga la página en un momento.
        </p>
      ) : room.photos.images.length > 0 ? (
        <div className="flex flex-col gap-2">
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            aria-label="Fotos de la habitación"
          >
            {room.photos.images.map((image, index) => (
              <li key={image.id}>
                {image.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada que caduca: ver el comentario de la página.
                  <img
                    src={image.url}
                    alt={`Foto ${index + 1} de la habitación`}
                    className="aspect-[4/3] w-full rounded-[var(--radius)] border border-[var(--border)] object-cover"
                    loading={index === 0 ? "eager" : "lazy"}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] p-2 text-center text-xs text-[var(--muted)]">
                    No se ha podido cargar esta foto. Recarga la página.
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--muted)]">
            Los enlaces de las fotos caducan a los 10 minutos. Si dejan de verse, recarga
            la página.
          </p>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">Esta habitación no tiene fotos.</p>
      )}

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-6">
        <h2 className="sr-only">Datos de la habitación</h2>
        <dl
          className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"
          data-testid="public-room-facts"
        >
          <div>
            <dt className="text-[var(--muted)]">Precio</dt>
            <dd>
              <span className="text-lg font-medium">{formatEuros(room.priceMonth)}</span>{" "}
              al mes · {room.expensesIncluded ? "gastos incluidos" : "gastos aparte"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Fianza</dt>
            <dd>
              {room.depositAmount !== null
                ? formatEuros(room.depositAmount)
                : "No indicada"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Disponible desde</dt>
            <dd>{formatPublicDate(room.availableFrom)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Estancia</dt>
            <dd>{stayText(room)}</dd>
          </div>
          {room.totalRooms !== null ? (
            <div>
              <dt className="text-[var(--muted)]">La vivienda</dt>
              <dd>{bedroomsText(room.totalRooms)}</dd>
            </div>
          ) : null}
          {room.totalRoommates !== null ? (
            <div>
              <dt className="text-[var(--muted)]">Convivencia</dt>
              <dd>{roommatesText(room.totalRoommates)} (sin contarte a ti)</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[var(--muted)]">Mascotas</dt>
            <dd>{yesNo(room.petsAllowed, "Se admiten", "No se admiten")}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Tabaco</dt>
            <dd>{yesNo(room.smokingAllowed, "Se puede fumar", "No se puede fumar")}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Para quién</dt>
            <dd>
              {yesNo(
                room.studentsOnly,
                "Solo para estudiantes",
                "No es exclusiva para estudiantes"
              )}
            </dd>
          </div>
        </dl>
      </section>

      {room.features.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="font-medium">Características</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {room.features.map((feature) => (
              <li
                key={feature.key}
                className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1"
              >
                {feature.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <TextBlock title="Descripción" text={room.description} />
      <TextBlock title="Normas de la vivienda" text={room.houseRules} />
      <TextBlock title="Preferencias de convivencia" text={room.roommatePreferences} />

      {room.neighborhood ? <NeighborhoodsAttribution /> : null}
    </main>
  );
}
