import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import { EXPLORE_PATH, TEST_PATH } from "@/lib/auth/destination";
import { getCandidates, type CandidateDTO } from "@/lib/services/matching";
import { Card } from "@/components/ui/card";

/**
 * Candidatos compatibles (`/explorar`, Fase 3.5, D13). Guard en la propia
 * página: onboarding completo y test completado en la versión vigente; si
 * no, 307 a `/test`. Los candidatos salen de `getCandidates`, que solo
 * devuelve `CandidateDTO` (lista blanca): esta página no recibe ni puede
 * mostrar respuestas, fechas de nacimiento, presupuestos exactos ni
 * puntuaciones por categoría. Sin «Ver perfil» ni «Me interesa» (D14; Fase 5).
 * Si falta la clave de servicio o falla la consulta, error genérico (2.7).
 */

class CandidatesUnavailableError extends Error {
  constructor() {
    super(
      "No hemos podido cargar los compañeros compatibles. Vuelve a intentarlo en un momento."
    );
    this.name = "CandidatesUnavailableError";
  }
}

/** `?pagina=N`: entero ≥ 1; cualquier otra cosa es la página 1. */
function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function budgetText(range: CandidateDTO["budgetRange"]): string | null {
  if (!range) return null;
  if (range.min !== null && range.max !== null)
    return `${range.min}–${range.max} € al mes`;
  if (range.max !== null) return `Hasta ${range.max} € al mes`;
  return `Desde ${range.min} € al mes`;
}

function CandidateCard({ candidate }: { candidate: CandidateDTO }) {
  const extra = candidate.neighborhoodsTotal - candidate.neighborhoods.length;
  const budget = budgetText(candidate.budgetRange);
  return (
    <li>
      <Card className="flex flex-col gap-3" data-testid="candidate">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] text-sm font-medium"
            >
              {candidate.fullName.trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <h2 className="font-medium">{candidate.fullName}</h2>
              <p className="text-sm text-[var(--muted)]">
                {candidate.age} años
                {candidate.university ? ` · ${candidate.university}` : ""}
              </p>
            </div>
          </div>
          <p className="text-right">
            <span className="text-2xl font-medium">{candidate.score}%</span>
            <span className="block text-xs text-[var(--muted)]">compatibilidad</span>
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Zona</dt>
            <dd>
              {candidate.neighborhoods.length > 0
                ? `${candidate.neighborhoods.join(", ")}${extra > 0 ? ` y ${extra} más` : ""}`
                : "Sin zonas preferidas"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Presupuesto</dt>
            <dd>{budget ?? "Sin presupuesto indicado"}</dd>
          </div>
        </dl>
        {candidate.strengths.length > 0 ? (
          <div className="text-sm">
            <h3 className="font-medium">Por qué encajáis</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {candidate.strengths.map((text) => (
                <li key={text}>✓ {text}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {candidate.differences.length > 0 ? (
          <div className="text-sm">
            <h3 className="font-medium">Posibles diferencias</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {candidate.differences.map((text) => (
                <li key={text}>⚠ {text}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompletedQuestionnaire();
  const page = parsePage((await searchParams).pagina);

  const result = await getCandidates(await createClient(), page);
  if (!result.ok) throw new CandidatesUnavailableError();
  const { candidates, total, totalPages, viewerAcceptsRoommates } = result.data;
  const pageHref = (n: number) =>
    n === 1 ? EXPLORE_PATH : `${EXPLORE_PATH}?pagina=${n}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-medium">Compañeros compatibles</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Personas de tu ciudad con fechas, presupuesto y número de compañeros compatibles
          con los tuyos, ordenadas por compatibilidad. Puedes{" "}
          <Link href={TEST_PATH} className="underline">
            revisar tu test
          </Link>{" "}
          cuando quieras.
        </p>
      </div>

      {!viewerAcceptsRoommates ? (
        <p
          role="status"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          En tus preferencias indicas que no quieres compañeros, así que no te mostramos
          candidatos. Si quieres compartir piso,{" "}
          <Link href="/preferencias" className="underline">
            cambia el número de compañeros
          </Link>
          .
        </p>
      ) : total === 0 ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          Todavía no hay compañeros compatibles contigo. Vuelve más adelante o revisa tus
          preferencias.
        </p>
      ) : candidates.length === 0 ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          Esta página no existe.{" "}
          <Link href={EXPLORE_PATH} className="underline">
            Vuelve a la primera
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">
            {total === 1 ? "1 compañero compatible" : `${total} compañeros compatibles`}
          </p>
          <ul className="flex flex-col gap-4">
            {candidates.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </ul>
        </>
      )}

      {totalPages > 1 && candidates.length > 0 ? (
        <nav aria-label="Páginas" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="underline">
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[var(--muted)]">
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="underline">
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
