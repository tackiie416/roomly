#!/usr/bin/env node
/**
 * Fotos de prueba para medir la subida en staging (sesión 87,
 * docs/STAGING.md, «Subida de 4 MiB»). Escribe JPEG válidos de tamaño exacto
 * en el directorio indicado (por defecto, ./upload-fixtures, ignorado por git):
 *
 *   node scripts/make-upload-fixtures.mjs [directorio]
 *
 *   - limite-4MiB.jpg        4 194 304 bytes: debe subirse;
 *   - limite-4MiB-mas-1.jpg  4 194 305 bytes: la app debe rechazarla con su aviso;
 *   - normal-1MiB.jpg        1 048 576 bytes: control.
 *
 * No se conecta a nada: la subida la hace una persona en el navegador.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exactSizeJpeg } from "../tests/support/exact-size-jpeg.mjs";

const MiB = 1024 * 1024;
const FIXTURES = [
  ["limite-4MiB.jpg", 4 * MiB, {}],
  ["limite-4MiB-mas-1.jpg", 4 * MiB + 1, {}],
  ["normal-1MiB.jpg", MiB, { width: 1000, height: 800 }],
];

const dir = path.resolve(process.argv[2] ?? "upload-fixtures");
mkdirSync(dir, { recursive: true });
for (const [name, size, options] of FIXTURES) {
  const bytes = await exactSizeJpeg(size, options);
  if (bytes.length !== size)
    throw new Error(`${name}: ${bytes.length} bytes, no ${size}`);
  writeFileSync(path.join(dir, name), bytes);
  console.log(`${name}: ${size} bytes`);
}
