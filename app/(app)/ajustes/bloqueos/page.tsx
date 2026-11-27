import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_PATH, requireActiveProfile } from "@/lib/auth/session";
import { BLOCKED_PATH } from "@/lib/auth/destination";
import { listBlockedPeople } from "@/lib/services/interests";
import { unblockUserAction } from "@/app/actions/safety";
import { safetyNotice } from "@/lib/safety/notices";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Personas bloqueadas (`/ajustes/bloqueos`, sesión 83). Solo los bloqueos
 * propios (RLS de `user_blocks`). Desbloquear es un formulario por persona,
 * sin JavaScript; no devuelve el match, los intereses ni el chat borrados.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Personas bloqueadas | Roomly",
  robots: { index: false, follow: false },
};

class BlocksUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar tus bloqueos. Vuelve a intentarlo en un momento.");
    this.name = "BlocksUnavailableError";
  }
}

const dateText = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));

export default async function BlockedPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActiveProfile(BLOCKED_PATH);
  const query = await searchParams;
  const result = await listBlockedPeople(await createClient());
  if (!result.ok) throw new BlocksUnavailableError();
  const notice = safetyNotice(query.aviso);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:p-8">
      <p className="text-sm">
        <Link href={SETTINGS_PATH} className="underline">
          ← Volver a ajustes
        </Link>
      </p>
      <Card className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-medium">Personas bloqueadas</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            No os veis en Explorar ni podéis enviaros intereses ni mensajes. Ninguna de
            las dos recibe un aviso.
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
        {result.data.length === 0 ? (
          <p className="text-sm text-[var(--muted)]" data-testid="blocked-empty">
            No has bloqueado a nadie.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="blocked-list">
            {result.data.map((person) => {
              const name = person.name ?? "Cuenta no disponible";
              return (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3 last:border-0"
                  data-testid="blocked-person"
                >
                  <div>
                    <p className="text-sm font-medium">{name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      Bloqueada el {dateText(person.blockedAt)}
                    </p>
                  </div>
                  <form action={unblockUserAction}>
                    <input type="hidden" name="targetId" value={person.id} />
                    <Button type="submit" variant="secondary">
                      Desbloquear<span className="sr-only"> a {name}</span>
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </main>
  );
}
