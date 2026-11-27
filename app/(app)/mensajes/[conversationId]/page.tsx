import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireCompletedQuestionnaire } from "@/lib/auth/session";
import { MESSAGES_PATH } from "@/lib/auth/destination";
import { getPublicEnv } from "@/lib/env";
import { getConversation } from "@/lib/services/chat";
import { sendChatMessage } from "@/app/actions/chat";
import { chatNotice } from "@/lib/chat/notices";
import { chatTime } from "@/lib/chat/format";
import { conversationPath } from "@/lib/chat/paths";
import { personPath } from "@/lib/interests/paths";
import { MESSAGE_MAX_LENGTH } from "@/lib/validation/chat";
import { ChatLiveRefresh } from "@/components/chat/live-refresh";
import { UndoMatch } from "@/components/chat/undo-match";
import { Button } from "@/components/ui/button";

/**
 * Chat con un match (`/mensajes/<id>`, Fase 6). Mismo guard que `/matches`.
 * El servicio decide el acceso con el cliente del usuario: una conversación
 * ajena, cerrada (match deshecho) o inexistente da un 404 indistinguible. Sin
 * `loading.tsx`, para que ese 404 sea un 404 de verdad (Fase 5.2).
 *
 * Funciona sin JavaScript: enviar es un formulario con su Server Action, los
 * mensajes anteriores se cargan con un enlace (cursor) y «Actualizar» vuelve
 * a pedir la página. Con `NEXT_PUBLIC_CHAT_REALTIME`, además, se refresca sola.
 * Cada formulario lleva un `clientToken` nuevo: un reenvío del mismo
 * formulario no duplica el mensaje.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Chat | Roomly",
  robots: { index: false, follow: false },
};

class ConversationUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar esta conversación. Vuelve a intentarlo en un momento.");
    this.name = "ConversationUnavailableError";
  }
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  await requireCompletedQuestionnaire(
    /^[0-9a-f-]{36}$/i.test(conversationId)
      ? conversationPath(conversationId)
      : MESSAGES_PATH
  );
  const result = await getConversation(await createClient(), conversationId, query.antes);
  if (!result.ok) {
    if (result.error === "not_found") notFound();
    throw new ConversationUnavailableError();
  }
  const chat = result.data;
  const notice = chatNotice(query.aviso);
  const name = chat.person?.fullName ?? "Persona no disponible";
  const firstName = chat.person?.fullName.split(" ")[0] ?? "esta persona";
  const clientToken = randomUUID();
  const realtime = getPublicEnv().NEXT_PUBLIC_CHAT_REALTIME === "true";

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:p-8">
      <p className="text-sm">
        <Link href={MESSAGES_PATH} className="underline">
          ← Volver a tus mensajes
        </Link>
      </p>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium" data-testid="chat-title">
            {name}
          </h1>
          {chat.person ? (
            <p className="text-sm text-[var(--muted)]">
              {chat.person.score}% de compatibilidad ·{" "}
              <Link href={personPath(chat.otherId)} className="underline">
                Ver perfil<span className="sr-only"> de {name}</span>
              </Link>
            </p>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Esta cuenta ya no está disponible: no puede recibir mensajes.
            </p>
          )}
        </div>
        {/* Un formulario GET (no un <Link>): siempre es una carga nueva de la
            página, también con la caché del router de Next.js y sin JavaScript. */}
        <form action={conversationPath(chat.id)} method="get">
          <button type="submit" className="text-sm underline" data-testid="chat-refresh">
            Actualizar
          </button>
        </form>
      </header>

      {notice ? (
        <p
          role="status"
          data-testid="chat-notice"
          className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <section
        aria-label={`Conversación con ${name}`}
        className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-3 sm:p-4"
      >
        {chat.olderCursor ? (
          <p className="text-center text-sm">
            <Link
              href={`${conversationPath(chat.id)}?antes=${encodeURIComponent(chat.olderCursor)}`}
              className="underline"
              data-testid="older-messages"
            >
              Ver mensajes anteriores
            </Link>
          </p>
        ) : null}
        {!chat.latest ? (
          <p className="text-center text-sm">
            <Link href={conversationPath(chat.id)} className="underline">
              Ir a los mensajes más recientes
            </Link>
          </p>
        ) : null}

        {chat.messages.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-[var(--muted)]"
            data-testid="chat-empty"
          >
            Todavía no hay mensajes. Preséntate y cuéntale a {firstName} qué buscas.
          </p>
        ) : (
          <ol className="flex flex-col gap-2" data-testid="chat-messages">
            {chat.messages.map((m, index) => (
              <li
                key={m.id}
                id={index === chat.messages.length - 1 ? "ultimo" : undefined}
                className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}
                data-testid={m.mine ? "message-mine" : "message-theirs"}
              >
                <p
                  className={`max-w-[85%] whitespace-pre-line break-words rounded-[var(--radius-lg)] px-3 py-2 text-sm ${
                    m.mine
                      ? "bg-[var(--accent)] text-white"
                      : "border border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <span className="sr-only">{m.mine ? "Tú: " : `${firstName}: `}</span>
                  {m.content}
                </p>
                <time
                  dateTime={m.createdAt}
                  className="mt-0.5 text-xs text-[var(--muted)]"
                >
                  {chatTime(m.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      {chat.person ? (
        <form action={sendChatMessage} id="escribir" className="flex flex-col gap-2">
          <input type="hidden" name="conversationId" value={chat.id} />
          <input type="hidden" name="clientToken" value={clientToken} />
          <label htmlFor="content" className="text-sm font-medium">
            Mensaje para {firstName}
          </label>
          <textarea
            key={clientToken}
            id="content"
            name="content"
            required
            maxLength={MESSAGE_MAX_LENGTH}
            rows={3}
            aria-describedby="content-hint"
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
          />
          <p id="content-hint" className="text-xs text-[var(--muted)]">
            Hasta {MESSAGE_MAX_LENGTH} caracteres. No compartas tu dirección exacta ni
            datos bancarios hasta conocer bien a la otra persona.
          </p>
          <div>
            <Button type="submit">Enviar</Button>
          </div>
        </form>
      ) : null}

      <UndoMatch targetId={chat.otherId} name={name} />
      {realtime ? <ChatLiveRefresh conversationId={chat.id} /> : null}
    </main>
  );
}
