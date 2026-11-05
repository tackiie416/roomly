import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// Fase 4.2 (L3) — el sanitizador no cambia la configuración global de sharp.
// La caché y la concurrencia de libvips son del proceso entero, y en
// producción las comparte el optimizador de imágenes de Next.js (sharp es un
// paquete externo del servidor). Antes, `sharp.cache(false)` se ejecutaba al
// importar el módulo.

const SOURCE = "lib/images/sanitize-room-image.ts";

const globals = () => {
  const cache = sharp.cache();
  return {
    memory: cache.memory.max,
    files: cache.files.max,
    items: cache.items.max,
    concurrency: sharp.concurrency(),
  };
};

describe("L3: sanitize-room-image no toca la configuración global de sharp", () => {
  it("importar el módulo y limpiar una foto deja la caché y la concurrencia como estaban", async () => {
    vi.resetModules();
    const before = globals();
    const { sanitizeRoomImage } = await import("@/lib/images/sanitize-room-image");
    expect(globals()).toEqual(before);

    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#456" },
    })
      .jpeg()
      .toBuffer();
    const result = await sanitizeRoomImage(jpeg, { declaredType: "image/jpeg" });
    expect(result.ok).toBe(true);
    expect(globals()).toEqual(before);
  });

  it("el código no llama a ninguna función global de sharp", () => {
    const code = readFileSync(SOURCE, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const fn of ["cache", "concurrency", "simd", "block", "unblock", "counters"]) {
      expect(code, fn).not.toMatch(new RegExp(`\\bsharp\\.${fn}\\s*\\(`));
    }
  });
});
