/** Formato de fechas y textos del panel (Fase 7), en la zona de Barcelona. */

export const adminDateText = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const adminDayText = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    dateStyle: "medium",
  }).format(date);
};

export const SEEKING_STATUS_LABELS: Record<string, string> = {
  looking_for_room: "Busca habitación",
  has_room_looking_for_roommate: "Tiene habitación y busca compañía",
  flexible: "Flexible",
};

export const labelOr = (labels: Record<string, string>, key: string): string =>
  Object.hasOwn(labels, key) ? labels[key] : key;

/** Avisos de las acciones del panel (`?aviso=`): solo claves conocidas. */
export const ADMIN_NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  guardado: { text: "Cambios guardados y registrados.", tone: "ok" },
  suspendida: { text: "Cuenta suspendida. La acción queda registrada.", tone: "ok" },
  reactivada: { text: "Cuenta reactivada. La acción queda registrada.", tone: "ok" },
  retirada: { text: "Habitación retirada. La acción queda registrada.", tone: "ok" },
  restaurada: {
    text: "Habitación restaurada: queda pausada hasta que su propietaria la publique.",
    tone: "ok",
  },
  invalido: {
    text: "Revisa los datos: el motivo (de 3 a 1000 caracteres) y la casilla de confirmación son obligatorios.",
    tone: "error",
  },
  conflicto: {
    text: "Esa acción no es posible en el estado actual (por ejemplo, ya estaba hecha, es una cuenta de administración o es tu propia cuenta).",
    tone: "error",
  },
  "no-encontrado": { text: "No existe o ya no está disponible.", tone: "error" },
  error: {
    text: "No hemos podido guardar el cambio. Vuelve a intentarlo.",
    tone: "error",
  },
};

export function adminNotice(value: string | string[] | undefined) {
  const key = Array.isArray(value) ? value[0] : value;
  return key && Object.hasOwn(ADMIN_NOTICES, key) ? ADMIN_NOTICES[key] : null;
}
