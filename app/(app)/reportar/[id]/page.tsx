import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import { MATCHES_PATH } from "@/lib/auth/destination";
import { knownCounterpart } from "@/lib/services/interests";
import { reportUserAction } from "@/app/actions/safety";
import { safetyNotice } from "@/lib/safety/notices";
import { reportPath } from "@/lib/safety/paths";
import {
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
} from "@/lib/validation/reports";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Reportar a una persona (`/reportar/<id>`, sesión 83). Mismo guard que
 * `/explorar` y `/matches`. Solo a alguien que ya conoces por la app
 * (`knownCounterpart`); cualquier otro id da un 404 indistinguible. Sin
 * JavaScript: un formulario con su Server Action. La persona reportada nunca
 * ve el reporte ni sabe quién lo ha enviado.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reportar | Roomly",
  robots: { index: false, follow: false },
};

const FIELD_ERRORS: Record<string, string> = {
  motivo: "Elige un motivo.",
  descripcion: `La descripción no puede tener más de ${REPORT_DESCRIPTION_MAX_LENGTH} caracteres.`,
};

class ReportUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar esta página. Vuelve a intentarlo en un momento.");
    this.name = "ReportUnavailableError";
  }
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await requireCompletedQuestionnaire(
    /^[0-9a-f-]{36}$/i.test(id) ? reportPath(id) : MATCHES_PATH
  );
  const known = await knownCounterpart(await createClient(), id);
  if (!known.ok) {
    if (known.error === "not_found") notFound();
    throw new ReportUnavailableError();
  }
  const name = known.data.name ?? "esta persona";
  const notice = safetyNotice(query.aviso);
  const errorKey = Array.isArray(query.error) ? query.error[0] : query.error;
  const fieldError =
    errorKey && Object.hasOwn(FIELD_ERRORS, errorKey) ? FIELD_ERRORS[errorKey] : null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:p-8">
      <p className="text-sm">
        <Link href={MATCHES_PATH} className="underline">
          ← Volver a tus matches
        </Link>
      </p>
      <Card className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-medium" data-testid="report-title">
            Reportar a {name}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            El equipo de Roomly revisará tu reporte. No le diremos a esta persona que la
            has reportado ni quién lo ha enviado. Si hay un peligro inmediato, llama al
            112.
          </p>
        </div>

        {notice ? (
          <p
            role="status"
            data-testid="safety-notice"
            className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
          >
            {notice}
          </p>
        ) : null}
        {fieldError ? (
          <p role="alert" data-testid="report-error" className="text-sm text-red-700">
            {fieldError}
          </p>
        ) : null}

        <form action={reportUserAction} className="flex flex-col gap-4">
          <input type="hidden" name="targetId" value={known.data.targetId} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Motivo</legend>
            {REPORT_REASONS.map((reason) => (
              <label key={reason} className="flex items-center gap-2 text-sm">
                <input type="radio" name="reason" value={reason} required />
                {REPORT_REASON_LABELS[reason]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="description" className="text-sm font-medium">
              Qué ha pasado (opcional)
            </label>
            <textarea
              id="description"
              name="description"
              maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
              rows={4}
              aria-describedby="description-hint"
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
            />
            <p id="description-hint" className="text-xs text-[var(--muted)]">
              Hasta {REPORT_DESCRIPTION_MAX_LENGTH} caracteres. No incluyas datos de
              terceros ni información que no haga falta para revisarlo.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="bloquear" value="1" className="mt-1" />
            <span>
              Bloquear también a esta persona: dejaréis de veros, se cierra el chat y no
              podrá escribirte.
            </span>
          </label>
          <div>
            <Button type="submit">Enviar reporte</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
