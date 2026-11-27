import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import { MATCHES_PATH, MESSAGES_PATH } from "@/lib/auth/destination";
import { listConversations } from "@/lib/services/chat";
import { chatNotice } from "@/lib/chat/notices";
import { conversationPath } from "@/lib/chat/paths";
import { chatTime } from "@/lib/chat/format";
import { Card } from "@/components/ui/card";

/**
 * Mensajes (`/mensajes`, Fase 6): las conversaciones abiertas, una por match,
 * la más reciente primero. Mismo guard que `/matches`. Cada persona sale como
 * `CandidateDTO` (lista blanca); sin vista previa de los mensajes, solo si hay
 * alguno sin leer.
 */

export const metadata: Metadata = {
  title: "Mensajes | Roomly",
  robots: { index: false, follow: false },
};

class ConversationsUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar tus mensajes. Vuelve a intentarlo en un momento.");
    this.name = "ConversationsUnavailableError";
  }
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompletedQuestionnaire(MESSAGES_PATH);
  const notice = chatNotice((await searchParams).aviso);
  const result = await listConversations(await createClient());
  if (!result.ok) throw new ConversationsUnavailableError();
  const conversations = result.data;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:p-8">
      <div>
        <h1 className="text-xl font-medium">Mensajes</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Solo puedes escribir a tus matches. Si alguien deshace el match, el chat se
          cierra para las dos personas.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          data-testid="chat-notice"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {conversations.length === 0 ? (
        <Card className="flex flex-col gap-2" data-testid="conversations-empty">
          <p>Todavía no tienes conversaciones.</p>
          <p className="text-sm text-[var(--muted)]">
            Cuando hagas match con alguien, podréis escribiros aquí. Mira tus{" "}
            <Link href={MATCHES_PATH} className="underline">
              matches
            </Link>
            .
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Conversaciones">
          {conversations.map((c) => {
            const name = c.person?.fullName ?? "Persona no disponible";
            return (
              <li key={c.id}>
                <Link
                  href={conversationPath(c.id)}
                  className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] p-4 hover:bg-[var(--surface)]"
                  data-testid="conversation-link"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className={c.unread ? "font-medium" : undefined}>{name}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {c.lastMessageAt
                        ? `Último mensaje: ${chatTime(c.lastMessageAt)}`
                        : "Sin mensajes todavía"}
                    </span>
                  </span>
                  {c.unread ? (
                    <span
                      className="shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs text-white"
                      data-testid="unread"
                    >
                      Nuevo<span className="sr-only"> mensaje sin leer</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
