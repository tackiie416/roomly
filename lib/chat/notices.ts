/**
 * Avisos del chat (Fase 6). Como los de «Me interesa»: la Server Action
 * redirige con `?aviso=<código>` y la página solo muestra textos de esta
 * lista, así que un `aviso` inventado no muestra nada.
 */
export const CHAT_NOTICES = {
  vacio: "Escribe un mensaje antes de enviarlo.",
  largo: "El mensaje no puede tener más de 2000 caracteres.",
  "no-disponible": "Esta persona ya no puede recibir mensajes.",
  limite: "Has enviado muchos mensajes seguidos. Espera un minuto y vuelve a intentarlo.",
  cerrado: "Esa conversación ya no está disponible.",
  error: "No hemos podido enviar el mensaje. Vuelve a intentarlo en un momento.",
} as const;

export type ChatNoticeCode = keyof typeof CHAT_NOTICES;

export function chatNotice(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !Object.hasOwn(CHAT_NOTICES, value)) return null;
  return CHAT_NOTICES[value as ChatNoticeCode];
}
