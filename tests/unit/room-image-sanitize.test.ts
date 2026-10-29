import { describe, expect, it } from "vitest";
import sharp, { type Sharp } from "sharp";
import {
  detectRasterFormat,
  remainingMetadata,
  sanitizeRoomImage,
} from "@/lib/images/sanitize-room-image";
import {
  ROOM_IMAGE_MAX_BYTES,
  ROOM_IMAGE_MAX_DIMENSION,
  ROOM_IMAGE_MAX_INPUT_PIXELS,
} from "@/lib/validation/room-images";

// Fase 4.2 — limpieza de las fotos de habitaciones con sharp: se vuelven a
// codificar desde sus píxeles, sin ningún metadato, y se rechaza por el
// contenido. Imágenes generadas en el propio test, sin archivos de muestra.

const solid = (width: number, height: number, background = "#836"): Sharp =>
  sharp({ create: { width, height, channels: 3, background } });

const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Ana Propietaria</dc:creator>' +
  "</rdf:Description></rdf:RDF></x:xmpmeta>";

/** Lo que trae una foto de móvil: marca y modelo, GPS, orientación y XMP. */
const phonePhoto = (width = 3000, height = 2000) =>
  solid(width, height)
    .withExif({
      IFD0: { Make: "MarcaMovil", Model: "ModeloX" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "41/1 23/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "2/1 10/1 0/1",
      },
    })
    .withXmp(XMP)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

/** El EXIF lleva el puntero al bloque GPS (etiqueta 0x8825). */
const hasGpsPointer = (exif: Buffer) =>
  exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]));

const accepted = async (input: Uint8Array, declaredType?: string) => {
  const result = await sanitizeRoomImage(input, { declaredType });
  if (!result.ok) throw new Error(`rechazada: ${result.reason}`);
  return result.image;
};

describe("sanitizeRoomImage: quita los metadatos y vuelve a codificar", () => {
  it("la foto de partida sí lleva GPS, marca, orientación y XMP (control)", async () => {
    const meta = await sharp(await phonePhoto()).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.exif?.includes("MarcaMovil")).toBe(true);
    expect(hasGpsPointer(meta.exif ?? Buffer.alloc(0))).toBe(true);
    expect(meta.xmp?.includes("Ana Propietaria")).toBe(true);
    expect(meta.icc).toBeDefined();
  });

  it("la salida es WebP sin EXIF (ni GPS), XMP, IPTC, ICC ni comentarios", async () => {
    const image = await accepted(await phonePhoto(), "image/jpeg");
    expect(image.contentType).toBe("image/webp");
    const meta = await sharp(image.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.comments ?? []).toEqual([]);
    expect(meta.orientation).toBeUndefined();
    expect(await remainingMetadata(image.data)).toEqual([]);
    // Ni rastro de los textos en los bytes guardados.
    expect(image.data.includes("MarcaMovil")).toBe(false);
    expect(image.data.includes("Ana Propietaria")).toBe(false);
  });

  it("aplica la orientación EXIF antes de quitarla y reduce al lado mayor de 2048", async () => {
    // 3000×2000 con orientación 6 (girada 90°) se ve vertical: 2000×3000.
    const image = await accepted(await phonePhoto(3000, 2000), "image/jpeg");
    expect(ROOM_IMAGE_MAX_DIMENSION).toBe(2048);
    expect([image.width, image.height]).toEqual([1365, 2048]);
    const meta = await sharp(image.data).metadata();
    expect([meta.width, meta.height]).toEqual([1365, 2048]);
  });

  it("no amplía una foto más pequeña", async () => {
    const image = await accepted(await solid(640, 480).jpeg().toBuffer(), "image/jpeg");
    expect([image.width, image.height]).toEqual([640, 480]);
  });

  it("quita el perfil ICC de un PNG y el EXIF de un WebP", async () => {
    const png = await solid(64, 48).withIccProfile("p3").png().toBuffer();
    expect((await sharp(png).metadata()).icc).toBeDefined();
    expect(
      await remainingMetadata(await accepted(png, "image/png").then((i) => i.data))
    ).toEqual([]);
    const webp = await solid(64, 48)
      .withExif({ IFD0: { Make: "MarcaMovil" } })
      .webp()
      .toBuffer();
    expect((await sharp(webp).metadata()).exif).toBeDefined();
    const cleaned = await accepted(webp, "image/webp");
    expect((await sharp(cleaned.data).metadata()).exif).toBeUndefined();
  });

  it("acepta JPEG, PNG y WebP, y nunca devuelve más de 4 MiB", async () => {
    for (const [type, input] of [
      ["image/jpeg", await solid(1200, 900).jpeg().toBuffer()],
      ["image/png", await solid(1200, 900).png().toBuffer()],
      ["image/webp", await solid(1200, 900).webp().toBuffer()],
    ] as const) {
      const image = await accepted(input, type);
      expect(image.contentType, type).toBe("image/webp");
      expect(image.data.byteLength, type).toBeLessThanOrEqual(ROOM_IMAGE_MAX_BYTES);
      expect((await sharp(image.data).metadata()).format, type).toBe("webp");
    }
  });
});

describe("sanitizeRoomImage: rechazos", () => {
  const reasonOf = async (input: Uint8Array, declaredType?: string) => {
    const result = await sanitizeRoomImage(input, { declaredType });
    return result.ok ? "aceptada" : result.reason;
  };

  it("SVG, aunque se presente como foto", async () => {
    const svg = Buffer.from(
      "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><script>alert(1)</script></svg>"
    );
    expect(await reasonOf(svg, "image/jpeg")).toBe("unsupported_format");
    expect(await reasonOf(svg)).toBe("unsupported_format");
  });

  it("GIF, HEIF/AVIF y TIFF", async () => {
    for (const [name, input] of [
      ["gif", await solid(16, 16).gif().toBuffer()],
      ["avif", await solid(16, 16).avif().toBuffer()],
      ["tiff", await solid(16, 16).tiff().toBuffer()],
    ] as const) {
      expect(await reasonOf(input), name).toBe("unsupported_format");
    }
  });

  it("imágenes animadas: WebP y GIF de varios fotogramas", async () => {
    const frames = [
      await solid(16, 16, "#f00").png().toBuffer(),
      await solid(16, 16, "#0f0").png().toBuffer(),
    ];
    const animatedWebp = await sharp(frames, { join: { animated: true } })
      .webp()
      .toBuffer();
    expect((await sharp(animatedWebp, { animated: true }).metadata()).pages).toBe(2);
    expect(await reasonOf(animatedWebp, "image/webp")).toBe("animated");
    // Un GIF, animado o no, ni siquiera tiene una firma aceptada.
    const animatedGif = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer();
    expect(await reasonOf(animatedGif)).toBe("unsupported_format");
  });

  it("archivos vacíos, que no son imágenes o truncados", async () => {
    expect(await reasonOf(new Uint8Array())).toBe("empty");
    // Sin la firma de un formato aceptado: se rechaza antes de llegar a sharp.
    expect(await reasonOf(Buffer.from("esto no es una imagen"))).toBe(
      "unsupported_format"
    );
    const jpeg = await solid(400, 300).jpeg().toBuffer();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length * 0.6));
    expect(await reasonOf(truncated)).toBe("invalid_image");
    const png = await solid(400, 300).png().toBuffer();
    expect(await reasonOf(png.subarray(0, Math.floor(png.length * 0.6)))).toBe(
      "invalid_image"
    );
  });

  it("más de 4 MiB de entrada (sin llegar a decodificar)", async () => {
    const input = new Uint8Array(ROOM_IMAGE_MAX_BYTES + 1);
    input.set([0xff, 0xd8, 0xff]);
    expect(await reasonOf(input)).toBe("too_large");
  });

  it("4 MiB exactos de entrada no se rechazan por tamaño", async () => {
    const jpeg = await solid(64, 64).jpeg().toBuffer();
    const exact = Buffer.concat([jpeg, Buffer.alloc(ROOM_IMAGE_MAX_BYTES - jpeg.length)]);
    expect(exact.byteLength).toBe(ROOM_IMAGE_MAX_BYTES);
    expect(await reasonOf(exact, "image/jpeg")).toBe("aceptada");
  });

  it("más de 40 MP, aunque comprimida pese poco", async () => {
    expect(ROOM_IMAGE_MAX_INPUT_PIXELS).toBe(40_000_000);
    const huge = await solid(8000, 6000, "#fff").png({ compressionLevel: 9 }).toBuffer();
    expect(huge.byteLength).toBeLessThan(ROOM_IMAGE_MAX_BYTES);
    expect(await reasonOf(huge, "image/png")).toBe("too_many_pixels");
    // Control: justo en el límite (8000×5000) sí se acepta.
    const limit = await solid(8000, 5000, "#fff").png({ compressionLevel: 9 }).toBuffer();
    expect(await reasonOf(limit, "image/png")).toBe("aceptada");
  });

  it("una salida que superaría el límite de bytes", async () => {
    // Ruido en un JPEG de calidad mínima: pesa poco, y en WebP de calidad 80
    // pesa más.
    let seed = 7;
    const noise = Buffer.alloc(600 * 400 * 3).map(() => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    });
    const input = await sharp(noise, { raw: { width: 600, height: 400, channels: 3 } })
      .jpeg({ quality: 5 })
      .toBuffer();
    const result = await sanitizeRoomImage(input, {
      limits: {
        maxBytes: input.byteLength,
        maxDimension: ROOM_IMAGE_MAX_DIMENSION,
        maxInputPixels: ROOM_IMAGE_MAX_INPUT_PIXELS,
      },
    });
    expect(result).toEqual({ ok: false, reason: "output_too_large" });
    // Control: con el límite real, la misma foto se acepta.
    expect(await reasonOf(input)).toBe("aceptada");
  });
});

describe("N1: la firma de los bytes decide antes de sharp", () => {
  const reasonOf = async (input: Uint8Array, declaredType?: string) => {
    const result = await sanitizeRoomImage(input, { declaredType });
    return result.ok ? "aceptada" : result.reason;
  };
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const withAscii = (text: string) => Buffer.from(text, "latin1");

  it("reconoce JPEG, PNG y WebP reales por sus primeros bytes", async () => {
    expect(detectRasterFormat(await solid(8, 8).jpeg().toBuffer())).toBe("jpeg");
    expect(detectRasterFormat(await solid(8, 8).png().toBuffer())).toBe("png");
    expect(detectRasterFormat(await solid(8, 8).webp().toBuffer())).toBe("webp");
    expect(
      detectRasterFormat(await solid(8, 8).webp({ lossless: true }).toBuffer())
    ).toBe("webp");
  });

  it("no reconoce SVG, GIF, TIFF, HEIF/AVIF, BMP ni otros RIFF", async () => {
    for (const [name, input] of [
      ["svg", withAscii("<svg xmlns='http://www.w3.org/2000/svg'/>")],
      ["svg con declaración XML", withAscii("<?xml version='1.0'?><svg/>")],
      ["gif", await solid(8, 8).gif().toBuffer()],
      ["tiff", await solid(8, 8).tiff().toBuffer()],
      ["avif", await solid(8, 8).avif().toBuffer()],
      ["bmp", withAscii("BM\0\0\0\0\0\0\0\0\0\0\0\0\0\0")],
      ["wav (RIFF)", withAscii("RIFF\x24\0\0\0WAVEfmt \x10\0\0\0")],
      ["webp con un bloque desconocido", withAscii("RIFF\x24\0\0\0WEBPVP9 \0\0\0\0")],
      [
        "png sin IHDR",
        Buffer.concat([
          bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
          withAscii("\0\0\0\rIDAT"),
        ]),
      ],
      ["jpeg cortado en la firma", bytes(0xff, 0xd8)],
    ] as const) {
      expect(detectRasterFormat(input), name).toBeNull();
      expect(await reasonOf(input), name).toBe("unsupported_format");
    }
  });

  it("un archivo cuyo tipo declarado no coincide con su firma se rechaza", async () => {
    const jpeg = await solid(16, 16).jpeg().toBuffer();
    const png = await solid(16, 16).png().toBuffer();
    expect(await reasonOf(jpeg, "image/png")).toBe("type_mismatch");
    expect(await reasonOf(png, "image/jpeg")).toBe("type_mismatch");
    expect(await reasonOf(png, "image/webp")).toBe("type_mismatch");
    // Un SVG que dice ser JPEG no llega ni a compararse: no tiene firma.
    expect(await reasonOf(withAscii("<svg/>"), "image/jpeg")).toBe("unsupported_format");
    // Control: con el tipo correcto, se aceptan.
    expect(await reasonOf(jpeg, "image/jpeg")).toBe("aceptada");
    expect(await reasonOf(png, "image/png")).toBe("aceptada");
  });

  it("una firma válida seguida de basura la rechaza la decodificación", async () => {
    let seed = 7;
    const garbage = Buffer.alloc(2048, 0).map(() => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    });
    for (const head of [
      bytes(0xff, 0xd8, 0xff, 0xe0),
      Buffer.concat([
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        withAscii("\0\0\0\rIHDR"),
      ]),
      withAscii("RIFF\0\x08\0\0WEBPVP8 "),
    ]) {
      const forged = Buffer.concat([head, garbage]);
      expect(detectRasterFormat(forged)).not.toBeNull();
      expect(await reasonOf(forged)).toBe("invalid_image");
    }
  });

  it("los límites de tamaño y de píxeles siguen igual con la firma", async () => {
    const tooBig = new Uint8Array(ROOM_IMAGE_MAX_BYTES + 1);
    tooBig.set([0xff, 0xd8, 0xff]);
    expect(await reasonOf(tooBig)).toBe("too_large");
    const huge = await solid(8000, 6000, "#fff").png({ compressionLevel: 9 }).toBuffer();
    expect(detectRasterFormat(huge)).toBe("png");
    expect(await reasonOf(huge, "image/png")).toBe("too_many_pixels");
  });
});

describe("remainingMetadata: la comprobación final detecta lo que quedara", () => {
  it("encuentra EXIF, XMP e ICC en una imagen sin limpiar", async () => {
    expect(await remainingMetadata(await phonePhoto(64, 48))).toEqual([
      "exif",
      "xmp",
      "icc",
    ]);
  });

  it("y nada en la salida del sanitizador", async () => {
    const image = await accepted(await phonePhoto(64, 48), "image/jpeg");
    expect(await remainingMetadata(image.data)).toEqual([]);
  });
});
