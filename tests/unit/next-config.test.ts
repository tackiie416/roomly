import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { ROOM_IMAGE_MAX_BYTES } from "@/lib/validation/room-images";

// El mismo parser que usa Next.js para el límite (action-handler.js).
const bytes = createRequire(import.meta.url)("next/dist/compiled/bytes") as {
  parse: (value: string) => number;
};

// Fase 4.2 (R5): Next.js lee el cuerpo entero de una Server Action hasta
// `serverActions.bodySizeLimit` (1 MB por defecto) y responde 413 por encima.
// El límite tiene que dejar pasar una foto de 4 MiB con las cabeceras del
// multipart, sin abrir mucho más la puerta a cuerpos grandes en el resto de
// acciones.
describe("next.config.ts: límite del cuerpo de las Server Actions", () => {
  const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;

  it("es 5 MB, como lo interpreta Next.js (paquete bytes)", () => {
    expect(limit).toBe("5mb");
    expect(bytes.parse(String(limit))).toBe(5 * 1024 * 1024);
  });

  it("cabe una foto de 4 MiB con 64 KiB de margen para el multipart", () => {
    expect(bytes.parse(String(limit))).toBeGreaterThanOrEqual(
      ROOM_IMAGE_MAX_BYTES + 64 * 1024
    );
  });

  it("no supera el búfer del proxy (10 MB por defecto: proxyClientMaxBodySize sin cambiar)", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeUndefined();
    expect(bytes.parse(String(limit))).toBeLessThan(10 * 1024 * 1024);
  });
});
