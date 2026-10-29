import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
