import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import { EXPLORE_PATH, MATCHES_PATH } from "@/lib/auth/destination";
import { getPersonPage } from "@/lib/services/interests";
import type { SeekingStatus } from "@/lib/services/matching";
import { interestNotice } from "@/lib/interests/notices";
import { InterestActions } from "@/components/interests/interest-actions";
import { NeighborhoodsAttribution } from "@/components/rooms/neighborhoods-attribution";
import { Card } from "@/components/ui/card";

/**
 * «Ver perfil» (`/explorar/<id>`, Fase 5.2). Mismo guard que `/explorar`.
 * La regla de acceso (docs/ROADMAP.md, Fase 5) la aplica el servicio: solo si
 * quien mira vería a esa persona en `/explorar` o ya hay match. En cualquier
 * otro caso, 404 indistinguible (no se puede saber si el id existe). La
 * página solo recibe `PersonProfileDTO` (lista blanca): sin email, fecha de
 * nacimiento, presupuestos exactos, respuestas ni puntuaciones por categoría.
 */

export const metadata: Metadata = { robots: { index: false, follow: false } };

class PersonUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar este perfil. Vuelve a intentarlo en un momento.");
    this.name = "PersonUnavailableError";
  }
}

const SEEKING_LABELS: Record<SeekingStatus, string> = {
  looking_for_room: "Busca habitación",
  has_room_looking_for_roommate: "Tiene habitación y busca compañeros",
  flexible: "Abierto a las dos cosas",
};

function budgetText(range: { min: number | null; max: number | null } | null) {
  if (!range) return "Sin presupuesto indicado";
  if (range.min !== null && range.max !== null)
    return `${range.min}–${range.max} € al mes`;
  if (range.max !== null) return `Hasta ${range.max} € al mes`;
  return `Desde ${range.min} € al mes`;
}

const monthText = (month: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompletedQuestionnaire();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const result = await getPersonPage(await createClient(), id);
  if (!result.ok) {
    if (result.error === "not_found") notFound();
    throw new PersonUnavailableError();
  }
  const { profile: person, state } = result.data;
  const notice = interestNotice(query.aviso);
  const extra = person.neighborhoodsTotal - person.neighborhoods.length;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:p-8">
      <p className="text-sm">
        <Link
          href={state === "matched" ? MATCHES_PATH : EXPLORE_PATH}
          className="underline"
        >
          ← {state === "matched" ? "Volver a tus matches" : "Volver a Explorar"}
        </Link>
      </p>

      {notice ? (
        <p
          role="status"
          data-testid="interest-notice"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <Card className="flex flex-col gap-5" data-testid="person-profile">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] text-lg font-medium"
            >
              {person.fullName.trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <h1 className="text-xl font-medium">{person.fullName}</h1>
              <p className="text-sm text-[var(--muted)]">
                {person.age} años
                {person.university ? ` · ${person.university}` : ""}
              </p>
            </div>
          </div>
          <p className="text-right">
            <span className="text-3xl font-medium">{person.score}%</span>
            <span className="block text-xs text-[var(--muted)]">compatibilidad</span>
          </p>
        </div>

        {person.bio ? (
          <section aria-labelledby="bio-heading">
            <h2 id="bio-heading" className="text-sm font-medium">
              Sobre {person.fullName.split(" ")[0]}
            </h2>
            <p className="mt-1 text-sm whitespace-pre-line">{person.bio}</p>
          </section>
        ) : null}

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Qué busca</dt>
            <dd>{SEEKING_LABELS[person.seekingStatus]}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Estudios</dt>
            <dd>{person.fieldOfStudy ?? "Sin indicar"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Zona</dt>
            <dd>
              {person.neighborhoods.length > 0
                ? `${person.neighborhoods.join(", ")}${extra > 0 ? ` y ${extra} más` : ""}`
                : "Sin zonas preferidas"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Presupuesto</dt>
            <dd>{budgetText(person.budgetRange)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Entrada</dt>
            <dd>
              {person.moveInMonth
                ? `Desde ${monthText(person.moveInMonth)}`
                : "Sin fecha"}
            </dd>
          </div>
        </dl>

        {person.strengths.length > 0 ? (
          <section aria-labelledby="strengths-heading" className="text-sm">
            <h2 id="strengths-heading" className="font-medium">
              Por qué encajáis
            </h2>
            <ul className="mt-1 flex flex-col gap-1">
              {person.strengths.map((text) => (
                <li key={text}>✓ {text}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {person.differences.length > 0 ? (
          <section aria-labelledby="differences-heading" className="text-sm">
            <h2 id="differences-heading" className="font-medium">
              Posibles diferencias
            </h2>
            <ul className="mt-1 flex flex-col gap-1">
              {person.differences.map((text) => (
                <li key={text}>⚠ {text}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <InterestActions
          targetId={person.id}
          name={person.fullName}
          state={state}
          back="perfil"
        />
        {state === "matched" ? (
          <p className="text-sm text-[var(--muted)]">
            El chat todavía no está disponible: por ahora, el match solo indica que os
            interesáis mutuamente.
          </p>
        ) : null}
      </Card>

      {person.neighborhoods.length > 0 ? <NeighborhoodsAttribution /> : null}
    </main>
  );
}
