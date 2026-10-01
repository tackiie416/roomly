/**
 * Errores de autenticación mostrados al usuario (Fase 2.2).
 *
 * Nunca se muestra ni se reenvía texto de Supabase (`error.message`,
 * `error_description`): todo error se reduce a un código propio con un
 * mensaje fijo en español.
 */

export const LOGIN_ERROR_MESSAGES = {
  auth_callback_failed: "No hemos podido completar el acceso. Pide un enlace nuevo.",
  link_expired: "El enlace ha caducado o ya se ha usado. Pide uno nuevo.",
  rate_limited:
    "Has pedido demasiados enlaces seguidos. Espera unos minutos y vuelve a probar.",
  invalid_email: "Revisa el correo: no parece una dirección válida.",
  send_failed: "No hemos podido enviarte el enlace. Vuelve a intentarlo en un momento.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;

/** Solo los errores que pueden llegar por URL a `/login`. */
const URL_ERROR_CODES: readonly LoginErrorCode[] = [
  "auth_callback_failed",
  "link_expired",
];

/** `?error=` de `/login` → código conocido, o `null` (se ignora cualquier otro texto). */
export function toLoginErrorCode(
  value: string | null | undefined
): LoginErrorCode | null {
  return URL_ERROR_CODES.find((code) => code === value) ?? null;
}

const EXPIRED_LINK_CODES = new Set([
  "otp_expired",
  "flow_state_expired",
  "flow_state_not_found",
]);

/**
 * Error del callback (parámetros `error`/`error_code` que añade Supabase, o
 * el error de `exchangeCodeForSession`) → código propio.
 */
export function callbackErrorCode(errorCode: string | null | undefined): LoginErrorCode {
  return errorCode && EXPIRED_LINK_CODES.has(errorCode)
    ? "link_expired"
    : "auth_callback_failed";
}

/** Error de `signInWithOtp` → código propio. */
export function otpErrorCode(error: { code?: string; status?: number }): LoginErrorCode {
  if (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  ) {
    return "rate_limited";
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return "invalid_email";
  }
  return "send_failed";
}
