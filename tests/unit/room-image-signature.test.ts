import { beforeEach, describe, expect, it, vi } from "vitest";

// Fase 4.2 (N1) — lo que no tiene la firma de un formato aceptado no llega a
// sharp. sharp se espía (sin cambiar lo que hace): el contenido rechazado por
// la firma no puede abrir ningún decodificador de libvips.

const calls = vi.hoisted(() => ({ count: 0 }));

vi.mock("sharp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sharp")>();
  const real = actual.default;
  const spied = Object.assign((...args: Parameters<typeof real>) => {
    calls.count += 1;
    return real(...args);
  }, real);
  return { ...actual, default: spied };
});

const { sanitizeRoomImage } = await import("@/lib/images/sanitize-room-image");
const sharp = (await import("sharp")).default;

const ascii = (text: string) => Buffer.from(text, "latin1");

describe("N1: sin firma aceptada, sharp no se llama", () => {
  beforeEach(() => {
    calls.count = 0;
  });

  it("SVG, GIF, TIFF, AVIF, BMP, texto y vacío se rechazan sin llamar a sharp", async () => {
    // Las imágenes de prueba se generan antes de empezar a contar.
    const samples = [
      ascii("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>"),
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } })
        .gif()
        .toBuffer(),
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } })
        .tiff()
        .toBuffer(),
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } })
        .avif()
        .toBuffer(),
      ascii("BM\0\0\0\0\0\0\0\0\0\0\0\0\0\0"),
      ascii("esto no es una imagen"),
    ];
    calls.count = 0;
    for (const input of samples) {
      const result = await sanitizeRoomImage(input, { declaredType: "image/jpeg" });
      expect(result).toEqual({ ok: false, reason: "unsupported_format" });
    }
    expect(await sanitizeRoomImage(new Uint8Array())).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(calls.count).toBe(0);
  });

  it("un tipo declarado que no coincide con la firma también se rechaza antes de sharp", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#888" },
    })
      .png()
      .toBuffer();
    calls.count = 0;
    expect(await sanitizeRoomImage(png, { declaredType: "image/jpeg" })).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
    expect(calls.count).toBe(0);
  });

  it("control: una foto válida sí pasa por sharp (decodificar, codificar y comprobar)", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();
    calls.count = 0;
    const result = await sanitizeRoomImage(jpeg, { declaredType: "image/jpeg" });
    expect(result.ok).toBe(true);
    expect(calls.count).toBeGreaterThan(0);
  });
});
