import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las rutas (sesión 86). Sin CSP de scripts:
 * Next.js inyecta scripts en línea y una política estricta necesita nonces
 * (pendiente, `docs/SECURITY.md`, «Cabeceras HTTP»). Las directivas de la CSP
 * de aquí no afectan a los scripts: impiden incrustar la app en un iframe
 * (clickjacking), cambiar la base de las URL, enviar formularios a otro origen
 * y los plugins. Lo fija tests/unit/next-config.test.ts.
 */
export const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Solo tiene efecto por HTTPS; en local (http) el navegador la ignora.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
] as const;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
  experimental: {
    serverActions: {
      // Fase 4.2 (R5): una foto de habitación puede tener 4 MiB
      // (ROOM_IMAGE_MAX_BYTES), y el cuerpo multipart añade unos KB de
      // cabeceras. Por defecto el límite es 1 MB. Vale para todas las Server
      // Actions (Next.js no permite fijarlo por acción); las demás validan sus
      // campos con esquemas `strict` y longitudes máximas. El límite del
      // alojamiento, si es menor, manda (docs/SECURITY.md, «Subida de
      // archivos»). Lo fija tests/unit/next-config.test.ts.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
