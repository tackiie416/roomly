import Link from "next/link";
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
  roomDeletePath,
  roomEditPath,
  roomPhotosPath,
} from "@/lib/rooms/paths";
import { listCitiesByIds, listNeighborhoods } from "@/lib/services/reference-data";
import { listOwnRooms, type OwnRoomListItem } from "@/lib/services/rooms";
import { ROOM_PUBLICATION_MESSAGES, ROOM_STATUS_LABELS } from "@/lib/validation/rooms";
import { NeighborhoodsAttribution } from "@/components/rooms/neighborhoods-attribution";
import { Card } from "@/components/ui/card";

const LOAD_ERROR =
  "No hemos podido cargar tus habitaciones. Vuelve a intentarlo en un momento.";

/** `AAAA-MM-DD` → fecha en español, sin depender de la zona horaria del servidor. */
function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`)
  );
}

/**
 * Habitaciones propias (`/habitaciones`, sesión 68). El guard va en la
 * página, antes de leer nada. Solo las de la sesión (también para un admin:
 * esto no es la moderación) y sin las de borrado lógico, en una consulta; los
 * nombres de ciudad y barrio, en una consulta cada uno (sin N+1). Ubicación:
 * solo ciudad y barrio (R2).
 */
export default async function OwnRoomsPage() {
  await requireActiveProfile(ROOMS_PATH);
  const supabase = await createClient();

  const result = await listOwnRooms(supabase);
  if (!result.ok) {
    if (result.error === "unauthenticated") redirect(loginPath({ next: ROOMS_PATH }));
    if (result.error === "deleted") redirect(DEACTIVATED_PATH);
    if (result.error === "no_profile") redirect(ONBOARDING_PROFILE_PATH);
    throw new Error(LOAD_ERROR);
  }
  const rooms = result.data;

  const cityIds = [...new Set(rooms.map((room) => room.city_id))];
  const [cities, neighborhoods] = await Promise.all([
    listCitiesByIds(supabase, cityIds),
    listNeighborhoods(supabase, cityIds),
  ]);
  if (!cities.ok || !neighborhoods.ok) throw new Error(LOAD_ERROR);
  const cityName = new Map(cities.data.map((city) => [city.id, city.name]));
  const neighborhoodName = new Map(neighborhoods.data.map((n) => [n.id, n.name]));
  const location = (room: OwnRoomListItem) =>
    [
      room.neighborhood_id ? neighborhoodName.get(room.neighborhood_id) : null,
      cityName.get(room.city_id),
    ]
      .filter(Boolean)
      .join(", ");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-medium">Tus habitaciones</h1>
        <Link
          href={NEW_ROOM_PATH}
          className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm text-white hover:opacity-90"
        >
          Nueva habitación
        </Link>
      </div>

      {rooms.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            Todavía no tienes habitaciones. Crea una: se guarda como borrador hasta que la
            publiques.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Tus habitaciones">
          {rooms.map((room) => (
            <li key={room.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-medium">{room.title}</h2>
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                    {ROOM_STATUS_LABELS[room.status] ?? room.status}
                  </span>
                </div>
                <p className="text-sm text-[var(--muted)]">
                  {room.price_month} € al mes · {location(room)} · Disponible desde el{" "}
                  {formatDate(room.available_from)}
                </p>
                {room.status !== "active" &&
                room.status !== "removed" &&
                room.missingForPublication.length > 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    Para publicarla:{" "}
                    {room.missingForPublication
                      .map((field) =>
                        ROOM_PUBLICATION_MESSAGES[field].replace(/^Para publicar, /, "")
                      )
                      .join("; ")}
                    .
                  </p>
                ) : null}
                <nav
                  aria-label={`Gestionar «${room.title}»`}
                  className="flex flex-wrap gap-4 text-sm"
                >
                  <Link href={roomEditPath(room.id)} className="underline">
                    {room.status === "removed" ? "Ver" : "Editar"}
                  </Link>
                  <Link href={roomPhotosPath(room.id)} className="underline">
                    Fotos
                  </Link>
                  <Link href={roomDeletePath(room.id)} className="text-red-700 underline">
                    Borrar
                  </Link>
                </nav>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {rooms.some((room) => room.neighborhood_id) ? <NeighborhoodsAttribution /> : null}
    </main>
  );
}
