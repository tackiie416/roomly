import { MESSAGES_PATH } from "@/lib/auth/destination";

/** Chat de una conversación (Fase 6): `/mensajes/<id>`, con el id ya validado. */
export function conversationPath(id: string): string {
  return `${MESSAGES_PATH}/${id}`;
}
