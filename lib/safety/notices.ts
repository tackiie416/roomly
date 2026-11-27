/**
 * Avisos de bloquear y reportar (sesión 83). Como en el resto de la app, la
 * página solo muestra el texto de esta lista: un `aviso` inventado no muestra
 * nada.
 */
export const SAFETY_NOTICES = {
  bloqueado:
    "Has bloqueado a esta persona. Ya no os veréis en Explorar ni podréis enviaros intereses ni mensajes. No se le avisa.",
  "ya-bloqueado": "Ya tenías bloqueada a esta persona.",
  "bloqueado-reportado":
    "Hemos recibido tu reporte y has bloqueado a esta persona. El equipo lo revisará; no le diremos quién lo ha enviado.",
  desbloqueado:
    "Has desbloqueado a esta persona. Lo que se borró al bloquear (match, intereses y chat) no vuelve.",
  "no-bloqueado": "Esa persona no estaba bloqueada.",
  reportado:
    "Hemos recibido tu reporte. El equipo lo revisará; no le diremos a esa persona quién lo ha enviado.",
  "ya-reportado":
    "Ya tienes un reporte abierto sobre esta persona. El equipo lo revisará; no hace falta enviarlo otra vez.",
  limite:
    "Has hecho muchos reportes o bloqueos en las últimas 24 horas. Vuelve a intentarlo más tarde.",
  "no-disponible": "Esta persona ya no está disponible.",
  error: "No hemos podido completar la acción. Vuelve a intentarlo en un momento.",
} as const;

export type SafetyNoticeCode = keyof typeof SAFETY_NOTICES;

export function safetyNotice(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !Object.hasOwn(SAFETY_NOTICES, value)) return null;
  return SAFETY_NOTICES[value as SafetyNoticeCode];
}
