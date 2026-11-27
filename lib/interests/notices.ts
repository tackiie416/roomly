/**
 * Avisos de «Me interesa» (Fase 5.1). La Server Action redirige a la página
 * de origen con `?aviso=<código>`; la página solo muestra el texto de esta
 * lista, así que un `aviso` inventado no muestra nada.
 */
export const INTEREST_NOTICES = {
  enviado: "Le hemos enviado tu «Me interesa». Si también le interesas, haréis match.",
  "ya-enviado": "Ya le habías enviado «Me interesa».",
  match: "¡Tenéis un match! Las dos personas habéis mostrado interés.",
  retirado: "Has retirado tu «Me interesa».",
  "no-enviado": "No tenías ningún «Me interesa» enviado a esta persona.",
  "con-match": "Ya tenéis un match: el interés no se puede retirar.",
  limite:
    "Has enviado muchos «Me interesa» en las últimas 24 horas. Vuelve a intentarlo más tarde.",
  "no-disponible": "Esta persona ya no está disponible.",
  // Fase 6: deshacer un match e interés por habitación.
  deshecho: "Has deshecho el match. El chat se ha cerrado para las dos personas.",
  "sin-match": "No tenías ningún match con esta persona.",
  "habitacion-enviado":
    "Hemos enviado tu interés por la habitación. Aquí abajo ves quién la publica; si también le interesas, haréis match.",
  "habitacion-ya-enviado": "Ya habías mostrado interés a quien publica esta habitación.",
  "habitacion-no-disponible": "Esta habitación ya no admite intereses.",
  "habitacion-propia": "Esta habitación es tuya.",
  error: "No hemos podido completar la acción. Vuelve a intentarlo en un momento.",
} as const;

export type InterestNoticeCode = keyof typeof INTEREST_NOTICES;

export function interestNotice(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !Object.hasOwn(INTEREST_NOTICES, value)) return null;
  return INTEREST_NOTICES[value as InterestNoticeCode];
}
