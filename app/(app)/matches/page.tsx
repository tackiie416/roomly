import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import { EXPLORE_PATH, MATCHES_PATH } from "@/lib/auth/destination";
import {
  getInterestOverview,
  type InterestState,
  type InterestSummary,
  type MatchSummary,
} from "@/lib/services/interests";
import { interestNotice } from "@/lib/interests/notices";
import { InterestActions } from "@/components/interests/interest-actions";
import { personPath } from "@/lib/interests/paths";
import { Card } from "@/components/ui/card";

/**
 * Matches e intereses (`/matches`, Fase 5.1). Mismo guard que `/explorar`:
 * onboarding completo y test vigente completado. Cada persona sale como
 * `CandidateDTO` (lista blanca, lib/services/matching.ts): nunca respuestas,
 * fechas de nacimiento ni datos de contacto. El chat es de la Fase 6, así que
 * un match todavía no abre ninguna conversación.
 */

class MatchesUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar tus matches. Vuelve a intentarlo en un momento.");
    this.name = "MatchesUnavailableError";
  }
}

function PersonCard({
  person,
  state,
  detail,
}: {
  person: MatchSummary | InterestSummary;
  state: InterestState;
  detail: string;
}) {
  return (
    <li>
      <Card className="flex flex-col gap-3" data-testid={`person-${state}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">
              <Link href={personPath(person.id)} className="hover:underline">
                {person.fullName}
              </Link>
            </h3>
            <p className="text-sm text-[var(--muted)]">
              {person.age} años
              {person.university ? ` · ${person.university}` : ""}
            </p>
            <p className="text-xs text-[var(--muted)]">{detail}</p>
          </div>
          <p className="text-right">
            <span className="text-2xl font-medium">{person.score}%</span>
            <span className="block text-xs text-[var(--muted)]">compatibilidad</span>
          </p>
        </div>
        {person.strengths.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {person.strengths.map((text) => (
              <li key={text}>✓ {text}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InterestActions
            targetId={person.id}
            name={person.fullName}
            state={state}
            back="matches"
          />
          <Link href={personPath(person.id)} className="text-sm underline">
            Ver perfil<span className="sr-only"> de {person.fullName}</span>
          </Link>
        </div>
      </Card>
    </li>
  );
}

const dateText = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompletedQuestionnaire(MATCHES_PATH);
  const notice = interestNotice((await searchParams).aviso);
  const result = await getInterestOverview(await createClient());
  if (!result.ok) throw new MatchesUnavailableError();
  const { matches, received, sent } = result.data;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 sm:p-8">
      <div>
        <h1 className="text-xl font-medium">Matches</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Cuando dos personas se envían «Me interesa», hacen match. Busca compañeros en{" "}
          <Link href={EXPLORE_PATH} className="underline">
            Explorar
          </Link>
          .
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          data-testid="interest-notice"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <section aria-labelledby="matches-heading" className="flex flex-col gap-3">
        <h2 id="matches-heading" className="font-medium">
          Tus matches
        </h2>
        {matches.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Todavía no tienes ningún match.</p>
        ) : (
          <>
            <p className="text-sm text-[var(--muted)]">
              El chat todavía no está disponible: por ahora, el match solo indica que os
              interesáis mutuamente.
            </p>
            <ul className="flex flex-col gap-4">
              {matches.map((m) => (
                <PersonCard
                  key={m.id}
                  person={m}
                  state="matched"
                  detail={`Match desde el ${dateText(m.matchedAt)}`}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="received-heading" className="flex flex-col gap-3">
        <h2 id="received-heading" className="font-medium">
          Te han mostrado interés
        </h2>
        {received.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nadie pendiente de respuesta.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {received.map((i) => (
              <PersonCard
                key={i.id}
                person={i}
                state="received"
                detail={`Desde el ${dateText(i.at)}`}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sent-heading" className="flex flex-col gap-3">
        <h2 id="sent-heading" className="font-medium">
          Intereses enviados
        </h2>
        {sent.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No tienes intereses sin respuesta.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {sent.map((i) => (
              <PersonCard
                key={i.id}
                person={i}
                state="sent"
                detail={`Enviado el ${dateText(i.at)}`}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
