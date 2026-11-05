import Link from "next/link";
import type { PublicRoomCard as PublicRoomCardData } from "@/lib/services/room-search";
import { publicRoomPath } from "@/lib/validation/room-search";

/**
 * Tarjeta de la búsqueda pública (Fase 4.4). Muestra solo el DTO de lista
 * blanca (`PublicRoomCard`): título, barrio y ciudad, precio y gastos,
 * disponibilidad, dormitorios, convivientes y la primera foto firmada. Nada
 * de la propietaria.
 *
 * La foto va con `<img>` y no con `next/image`: la URL firmada caduca y la
 * optimización la guardaría en su caché más tiempo del que vale (como en
 * `/habitaciones/[id]/fotos`).
 */

/** `AAAA-MM-DD` → fecha en español, sin depender de la zona horaria del servidor. */
export function formatPublicDate(isoDate: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`)
  );
}

export function formatEuros(amount: number): string {
  return `${new Intl.NumberFormat("es-ES").format(amount)} €`;
}

export function roommatesText(count: number): string {
  if (count === 0) return "Vivirás sin compañeros";
  return count === 1 ? "Convivirás con 1 persona" : `Convivirás con ${count} personas`;
}

export function bedroomsText(count: number): string {
  return count === 1
    ? "1 dormitorio en la vivienda"
    : `${count} dormitorios en la vivienda`;
}

export function PublicRoomCard({
  room,
  citySlug,
}: {
  room: PublicRoomCardData;
  citySlug: string;
}) {
  const location = [room.neighborhood, room.city].filter(Boolean).join(", ");
  return (
    <li>
      <article
        className="flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]"
        data-testid="public-room-card"
      >
        {room.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada que caduca: ver el comentario del componente.
          <img
            src={room.cover.url}
            alt=""
            className="aspect-[4/3] w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-[var(--surface)] text-xs text-[var(--muted)]">
            Sin foto
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h2 className="font-medium">
            <Link href={publicRoomPath(citySlug, room.id)} className="hover:underline">
              {room.title}
            </Link>
          </h2>
          <p className="text-sm text-[var(--muted)]">{location}</p>
          <p>
            <span className="text-lg font-medium">{formatEuros(room.priceMonth)}</span>{" "}
            <span className="text-sm text-[var(--muted)]">
              al mes · {room.expensesIncluded ? "gastos incluidos" : "gastos aparte"}
            </span>
          </p>
          <dl className="grid grid-cols-1 gap-1 text-sm">
            <div>
              <dt className="sr-only">Disponibilidad</dt>
              <dd>Disponible desde el {formatPublicDate(room.availableFrom)}</dd>
            </div>
            {room.totalRooms !== null ? (
              <div>
                <dt className="sr-only">Dormitorios</dt>
                <dd>{bedroomsText(room.totalRooms)}</dd>
              </div>
            ) : null}
            {room.totalRoommates !== null ? (
              <div>
                <dt className="sr-only">Convivientes</dt>
                <dd>{roommatesText(room.totalRoommates)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </article>
    </li>
  );
}
