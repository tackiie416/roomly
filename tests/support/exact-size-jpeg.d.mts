/** JPEG válido de exactamente `target` bytes (ver exact-size-jpeg.mjs). */
export function exactSizeJpeg(
  target: number,
  options?: { width?: number; height?: number; seed?: number }
): Promise<Buffer>;
