import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import { EXPLORE_PATH, MATCHES_PATH, MESSAGES_PATH } from "@/lib/auth/destination";
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
import { UndoMatch } from "@/components/chat/undo-match";
import { conversationPath } from "@/lib/chat/paths";

/**
 * Matches e intereses (`/matches`, Fase 5.1). Mismo guard que `/explorar`:
 * onboarding completo y test vigente completado. Cada persona sale como
 * `CandidateDTO` (lista blanca, lib/services/matching.ts): nunca respuestas,
 * fechas de nacimiento ni datos de contacto. Cada match tiene su chat
 * (Fase 6) y se puede deshacer. Un interés por habitación (Fase 6) dice por
 * qué habitación es: así las dos personas saben quién publica y quién se
 * interesa, sin que el detalle público lo muestre.
 */

class MatchesUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar tus matches. Vuelve a intentarlo en un momento.");
    this.name = "MatchesUnavailableError";
  }
}

function roomText(person: MatchSummary | InterestSummary, state: InterestState) {
  if (!("room" in person) || !person.room) return null;
  const title = person.room.title
    ? `«${person.room.title}»`
    : "una habitación que ya no está publicada";
  return state === "received"
    ? `Le interesa tu habitación ${title}`
    : `Por su habitación ${title}: es quien la publica`;
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
  const room = roomText(person, state);
  const chat = "conversationId" in person ? person.conversationId : null;
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
            {room ? (
              <p className="mt-1 text-sm" data-testid="room-context">
                {room}
              </p>
            ) : null}
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
          <span className="flex flex-wrap items-center gap-4 text-sm">
            {chat ? (
              <Link
                href={conversationPath(chat)}
                className="underline"
                data-testid="open-chat"
              >
                Abrir chat<span className="sr-only"> con {person.fullName}</span>
              </Link>
            ) : null}
            <Link href={personPath(person.id)} className="underline">
              Ver perfil<span className="sr-only"> de {person.fullName}</span>
            </Link>
          </span>
        </div>
        {state === "matched" ? (
          <UndoMatch targetId={person.id} name={person.fullName} />
        ) : null}
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
              Con un match ya podéis escribiros: abre el chat desde su tarjeta o desde{" "}
              <Link href={MESSAGES_PATH} className="underline">
                Mensajes
              </Link>
              .
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
