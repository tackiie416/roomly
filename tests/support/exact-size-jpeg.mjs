// JPEG válido de un tamaño exacto en bytes, para medir subidas en el límite
// (sesión 65). Ruido determinista (comprime mal, así que pesa) y, justo
// después del SOI, segmentos de comentario (COM, FF FE) hasta el tamaño
// pedido: un JPEG con comentarios sigue siendo válido y el sanitizador los
// quita. Lo usan tests/unit y tests/e2e (Node, con sharp).
import sharp from "sharp";

const SOI_LENGTH = 2;
/** Un segmento COM ocupa 2 bytes de marcador + 2 de longitud + datos (≤ 65 533). */
const MAX_SEGMENT = 2 + 65535;

function noise(width, height, seed) {
  const data = Buffer.alloc(width * height * 3);
  let state = seed >>> 0;
  for (let i = 0; i < data.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = state >>> 24;
  }
  return data;
}

function comSegment(size) {
  const segment = Buffer.alloc(size, 0x78); // «x»
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment.writeUInt16BE(size - 2, 2);
  return segment;
}

/**
 * @param {number} target tamaño exacto en bytes
 * @param {{ width?: number, height?: number, seed?: number }} options
 */
export async function exactSizeJpeg(target, options = {}) {
  const width = options.width ?? 1600;
  const height = options.height ?? 1200;
  const base = await sharp(noise(width, height, options.seed ?? 42), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  let pad = target - base.length;
  if (pad < 0 || (pad > 0 && pad < 4)) {
    throw new Error(`base de ${base.length} bytes: no se puede llegar a ${target}`);
  }
  const segments = [];
  while (pad > 0) {
    let size = Math.min(pad, MAX_SEGMENT);
    if (pad - size > 0 && pad - size < 4) size = pad - 4;
    segments.push(comSegment(size));
    pad -= size;
  }
  const out = Buffer.concat([
    base.subarray(0, SOI_LENGTH),
    ...segments,
    base.subarray(SOI_LENGTH),
  ]);
  if (out.length !== target)
    throw new Error(`tamaño ${out.length}, se esperaba ${target}`);
  return out;
}
