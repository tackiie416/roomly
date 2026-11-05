import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPublicEnv } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";
import { searchPublicRooms } from "@/lib/services/room-search";
import {
  type RawSearchParams,
  hasRoomSearchFilters,
  roomSearchHref,
  roomSearchPath,
} from "@/lib/validation/room-search";
import { NeighborhoodsAttribution } from "@/components/rooms/neighborhoods-attribution";
import { PublicRoomCard } from "@/components/rooms/public-room-card";
import { PublicRoomSearchForm } from "@/components/rooms/public-room-search-form";

/**
 * Búsqueda pública de habitaciones de una ciudad (`/[city]/habitaciones`,
 * Fase 4.4, R3 y R4). Sin sesión y sin guard: el proxy no la protege (no
 * empieza por ningún prefijo de lib/auth/protected-routes.ts) y las rutas
 * estáticas de la aplicación (`/habitaciones`, `/perfil`...) ganan a `[city]`.
 *
 * Lee SIEMPRE con el cliente de un visitante (`createPublicClient`), también
 * si hay una sesión: una propietaria o un admin ven aquí exactamente lo mismo
 * que cualquier visitante (sin borradores; R7 y el GRANT de anon los aplica la
 * base de datos). Ubicación: solo barrio y ciudad (R2).
 *
 * Dinámica en cada petición (`force-dynamic`), sin ISR ni caché: la salida
 * lleva URL firmadas que caducan a los 10 minutos.
 *
 * SEO (§34 de ROOMLY_MASTER_SPEC.md): la URL canónica es la de la ciudad sin
 * parámetros, y cualquier variante con filtros, orden o cursor lleva
 * `noindex, follow`, para no indexar combinaciones infinitas como páginas
 * distintas. Solo se indexan ciudades activas (las demás son 404) y con
 * alguna habitación publicada: sin páginas vacías.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ city: string }>;
  searchParams: Promise<RawSearchParams>;
};

const LOAD_ERROR =
  "No hemos podido cargar las habitaciones. Vuelve a intentarlo en un momento.";

/** Una búsqueda por petición, compartida por los metadatos y la página. */
const loadSearch = cache((citySlug: string, paramsKey: string) =>
  searchPublicRooms(
    createPublicClient(),
    citySlug,
    JSON.parse(paramsKey) as RawSearchParams
  )
);

async function load({ params, searchParams }: PageProps) {
  const { city } = await params;
  const raw = await searchParams;
  return { raw, result: await loadSearch(city, JSON.stringify(raw)) };
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { raw, result } = await load(props);
  if (!result.ok)
    return { title: "Página no encontrada | Roomly", robots: { index: false } };
  const { city } = result.data;
  const isVariant = Object.values(raw).some((value) => value !== undefined);
  // §34: sin páginas vacías indexadas. Una ciudad activa sin habitaciones
  // publicadas tampoco se indexa (hasta que tenga alguna).
  const isEmpty =
    result.data.outcome.kind === "results" && result.data.outcome.rooms.length === 0;
  return {
    metadataBase: new URL(getPublicEnv().NEXT_PUBLIC_SITE_URL),
    title: `Habitaciones en ${city.name} | Roomly`,
    description: `Habitaciones publicadas en ${city.name}: precio, barrio, disponibilidad y convivencia. Solo mostramos el barrio, nunca la dirección.`,
    alternates: { canonical: roomSearchPath(city.slug) },
    robots:
      isVariant || isEmpty
        ? { index: false, follow: true }
        : { index: true, follow: true },
  };
}

export default async function PublicRoomSearchPage(props: PageProps) {
  const { result } = await load(props);
  if (!result.ok) {
    if (result.error === "not_found") notFound();
    throw new Error(LOAD_ERROR);
  }
  const { city, neighborhoods, outcome } = result.data;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-medium">Habitaciones en {city.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Anuncios publicados. De cada habitación mostramos el barrio y la ciudad, nunca
          la dirección exacta.
        </p>
      </div>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-6">
        <PublicRoomSearchForm
          citySlug={city.slug}
          neighborhoods={neighborhoods}
          filters={outcome.kind === "results" ? outcome.filters : null}
        />
      </section>

      {outcome.kind === "invalid" ? (
        <div
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--border)] p-4 text-sm"
          data-testid="search-invalid"
        >
          <p className="font-medium">Algún filtro de la búsqueda no es válido.</p>
          <ul className="mt-1 list-disc pl-5">
            {Object.values(outcome.fieldErrors)
              .flat()
              .map((message) => (
                <li key={message}>{message}</li>
              ))}
          </ul>
          <p className="mt-2">
            Revisa los filtros o{" "}
            <Link href={roomSearchPath(city.slug)} className="underline">
              empieza una búsqueda nueva
            </Link>
            .
          </p>
        </div>
      ) : (
        <section aria-labelledby="results-title" className="flex flex-col gap-4">
          <h2 id="results-title" className="sr-only">
            Resultados
          </h2>
          {outcome.coversUnavailable ? (
            <p role="status" className="text-sm text-[var(--muted)]">
              No hemos podido cargar las fotos. Recarga la página en un momento.
            </p>
          ) : null}

          {outcome.rooms.length === 0 ? (
            <p className="text-sm text-[var(--muted)]" data-testid="search-empty">
              {outcome.filters.cursor
                ? "No hay más habitaciones con estos filtros."
                : hasRoomSearchFilters(outcome.filters)
                  ? "No hay habitaciones publicadas con estos filtros."
                  : `Todavía no hay habitaciones publicadas en ${city.name}.`}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {outcome.rooms.map((room) => (
                <PublicRoomCard key={room.id} room={room} citySlug={city.slug} />
              ))}
            </ul>
          )}

          {outcome.rooms.length > 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Los enlaces de las fotos caducan a los 10 minutos. Si dejan de verse,
              recarga la página.
            </p>
          ) : null}

          <nav aria-label="Páginas" className="flex flex-wrap gap-4 text-sm">
            {outcome.filters.cursor ? (
              <Link
                href={roomSearchHref(city.slug, { ...outcome.filters, cursor: null })}
                className="underline"
              >
                Volver a la primera página
              </Link>
            ) : null}
            {outcome.nextCursor ? (
              <Link
                href={roomSearchHref(city.slug, outcome.filters, outcome.nextCursor)}
                className="underline"
                rel="next"
              >
                Página siguiente
              </Link>
            ) : null}
          </nav>

          {outcome.rooms.some((room) => room.neighborhood) ? (
            <NeighborhoodsAttribution />
          ) : null}
        </section>
      )}
    </main>
  );
}
