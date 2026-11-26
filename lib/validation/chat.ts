import { z } from "zod";
import { charLength, uuidSchema } from "@/lib/validation/common";

/**
 * Chat entre matches (Fase 6). El mismo límite que la base de datos
 * (`chk_messages_content_length`, 20261127120000): 2000 caracteres contados
 * como `char_length` (code points), después de quitar los espacios de los
 * extremos. Un mensaje vacío tampoco pasa (`chk_content_not_empty`).
 */
export const MESSAGE_MAX_LENGTH = 2000;
/** Mensajes por página del chat (se lee uno más para saber si hay anteriores). */
export const MESSAGES_PAGE_SIZE = 50;

const EMPTY = "Escribe un mensaje antes de enviarlo.";
const TOO_LONG = `El mensaje no puede tener más de ${MESSAGE_MAX_LENGTH} caracteres.`;

/** Saltos de línea de Windows → `\n`, y sin espacios en los extremos. */
export function normalizeMessage(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export const messageInputSchema = z
  .object({
    conversationId: uuidSchema,
    /** Lo genera el servidor al pintar el formulario: un reenvío no duplica. */
    clientToken: uuidSchema,
    content: z
      .string({ error: EMPTY })
      .transform(normalizeMessage)
      .refine((value) => value.length > 0, { message: EMPTY })
      .refine((value) => charLength(value) <= MESSAGE_MAX_LENGTH, { message: TOO_LONG }),
  })
  .strict();

export type MessageInput = z.infer<typeof messageInputSchema>;

/**
 * Cursor de «Mensajes anteriores»: `<created_at>_<id>` del mensaje más antiguo
 * de la página. Solo se aceptan una fecha ISO y un UUID; cualquier otra cosa
 * se trata como «sin cursor» (la página más reciente).
 */
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export type MessageCursor = { createdAt: string; id: string };

export function encodeMessageCursor(cursor: MessageCursor): string {
  return `${cursor.createdAt}_${cursor.id}`;
}

export function parseMessageCursor(raw: unknown): MessageCursor | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length > 80) return null;
  const separator = value.lastIndexOf("_");
  if (separator <= 0) return null;
  const createdAt = value.slice(0, separator);
  const id = uuidSchema.safeParse(value.slice(separator + 1));
  if (
    !id.success ||
    !ISO_TIMESTAMP.test(createdAt) ||
    Number.isNaN(Date.parse(createdAt))
  )
    return null;
  return { createdAt, id: id.data };
}
