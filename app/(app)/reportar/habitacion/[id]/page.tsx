import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { requireActiveProfile } from "@/lib/auth/session";
import { reportableRoom } from "@/lib/services/reports";
import { reportRoomAction } from "@/app/actions/safety";
import { safetyNotice } from "@/lib/safety/notices";
import { roomReportPath } from "@/lib/safety/paths";
import { publicRoomPath } from "@/lib/validation/room-search";
import {
  REPORT_DESCRIPTION_MAX_LENGTH,
  ROOM_REPORT_REASONS,
  ROOM_REPORT_REASON_LABELS,
} from "@/lib/validation/reports";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Reportar un anuncio (`/reportar/habitacion/<id>`, Fase 7). Basta una
 * cuenta activa. Solo un anuncio público y ajeno (`reportableRoom`); cualquier
 * otro id da un 404 indistinguible. Sin JavaScript: un formulario con su
 * Server Action. La propietaria nunca ve el reporte ni quién lo ha enviado.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reportar un anuncio | Roomly",
  robots: { index: false, follow: false },
};

const FIELD_ERRORS: Record<string, string> = {
  motivo: "Elige un motivo.",
  descripcion: `La descripción no puede tener más de ${REPORT_DESCRIPTION_MAX_LENGTH} caracteres.`,
};

class RoomReportUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar esta página. Vuelve a intentarlo en un momento.");
    this.name = "RoomReportUnavailableError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoomReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  await requireActiveProfile(roomReportPath(id));
  const room = await reportableRoom(await createClient(), createPublicClient(), id);
  if (!room.ok) {
    if (room.error === "not_found") notFound();
    throw new RoomReportUnavailableError();
  }
  const notice = safetyNotice(query.aviso);
  const errorKey = Array.isArray(query.error) ? query.error[0] : query.error;
  const fieldError =
    errorKey && Object.hasOwn(FIELD_ERRORS, errorKey) ? FIELD_ERRORS[errorKey] : null;
  const back = room.data.citySlug
    ? publicRoomPath(room.data.citySlug, room.data.roomId)
    : null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:p-8">
      {back ? (
        <p className="text-sm">
          <Link href={back} className="underline">
            ← Volver al anuncio
          </Link>
        </p>
      ) : null}
      <Card className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-medium" data-testid="room-report-title">
            Reportar el anuncio «{room.data.title}»
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            El equipo de Roomly revisará tu reporte y puede retirar el anuncio. No le
            diremos a la propietaria quién lo ha enviado. Si te han pedido dinero o datos
            bancarios, no los envíes.
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

        <form action={reportRoomAction} className="flex flex-col gap-4">
          <input type="hidden" name="roomId" value={room.data.roomId} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Motivo</legend>
            {ROOM_REPORT_REASONS.map((reason) => (
              <label key={reason} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="reason"
                  value={reason}
                  required
                  className="mt-1"
                />
                {ROOM_REPORT_REASON_LABELS[reason]}
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
          <div>
            <Button type="submit">Enviar reporte</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
