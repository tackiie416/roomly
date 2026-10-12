import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { MOCK_SERVICE_ROLE_KEY } from "../support/mock-config.mjs";

// D1 — la clave service_role no llega a lo que Next.js sirve al navegador.
// Corre dentro de E1: el webServer de playwright.config.ts hace `npm run build`
// con la clave FICTICIA de mock-config.mjs antes de los specs, y aquí se lee
// ese build en disco, byte a byte (sin decodificar los archivos):
//   - todo .next/static, lo que se sirve en /_next/static: chunks de JS, CSS,
//     manifiestos del build y media;
//   - el HTML y los payloads RSC prerenderizados (.next/server/{app,pages}).
// Falla si aparece el valor ficticio de la clave o el nombre de la variable, y
// solo informa del tipo de coincidencia y de la ruta relativa.
//
// Es un control estático de exposición accidental sobre el build de E1. No
// mira el HTML que se genera en cada petición ni prueba otros entornos, la
// clave real o Supabase. No abre el navegador ni hace peticiones: lo fija
// tests/unit/validation-infra.test.ts, que solo le permite estas dos agujas.

const ROOT = path.resolve(__dirname, "../../..");
const NEXT_DIR = path.join(ROOT, ".next");

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

/** Cada aguja en UTF-8 (y así en cualquier codificación compatible con ASCII) y en UTF-16. */
const NEEDLES = [
  { kind: "valor ficticio de la clave", text: MOCK_SERVICE_ROLE_KEY },
  { kind: "nombre de la variable de la clave", text: "SUPABASE_SERVICE_ROLE_KEY" },
].map(({ kind, text }) => ({
  kind,
  variants: [
    Buffer.from(text, "utf8"),
    Buffer.from(text, "utf16le"),
    Buffer.from(text, "utf16le").swap16(),
  ],
}));

/** Archivos bajo `dir`, recursivo. Cualquier otra entrada hace fallar: nada se salta. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    if (entry.isFile()) return [full];
    throw new Error(`Entrada que no es archivo ni directorio en el build: ${rel(full)}`);
  });
}

/**
 * Comprueba que .next es un build completo de Next.js y devuelve los archivos
 * públicos que se inspeccionan. Estructura verificada con Next.js 16
 * (Turbopack): .next/BUILD_ID, .next/build-manifest.json y
 * .next/static/{chunks,media,<BUILD_ID>}.
 */
function publicBuildFiles() {
  const buildIdFile = path.join(NEXT_DIR, "BUILD_ID");
  expect(existsSync(buildIdFile), ".next/BUILD_ID no existe: falta el build").toBe(true);
  expect(lstatSync(buildIdFile).isFile(), ".next/BUILD_ID no es un archivo").toBe(true);
  const buildId = readFileSync(buildIdFile, "utf8").trim();
  expect(buildId, ".next/BUILD_ID no es un id de build").toMatch(/^[A-Za-z0-9_-]{8,}$/);

  const staticDir = path.join(NEXT_DIR, "static");
  expect(existsSync(staticDir), ".next/static no existe").toBe(true);
  expect(lstatSync(staticDir).isDirectory(), ".next/static no es un directorio").toBe(
    true
  );
  const staticFiles = filesUnder(staticDir);
  expect(staticFiles.length, ".next/static está vacío").toBeGreaterThan(0);
  const chunks = staticFiles.filter(
    (file) => rel(file).startsWith(".next/static/chunks/") && file.endsWith(".js")
  );
  expect(chunks.length, ".next/static/chunks no tiene JavaScript").toBeGreaterThan(0);

  // El BUILD_ID es el de este build: el manifiesto apunta a .next/static/<BUILD_ID>/
  // y todo lo que lista el navegador está entre los archivos inspeccionados.
  const manifest = JSON.parse(
    readFileSync(path.join(NEXT_DIR, "build-manifest.json"), "utf8")
  ) as {
    polyfillFiles?: string[];
    rootMainFiles?: string[];
    lowPriorityFiles?: string[];
  };
  expect(
    manifest.rootMainFiles?.length,
    "build-manifest.json sin rootMainFiles"
  ).toBeGreaterThan(0);
  const listed = [
    ...(manifest.polyfillFiles ?? []),
    ...(manifest.rootMainFiles ?? []),
    ...(manifest.lowPriorityFiles ?? []),
  ];
  expect(listed, "build-manifest.json no apunta a .next/static/<BUILD_ID>/").toContain(
    `static/${buildId}/_buildManifest.js`
  );
  const inspected = new Set(staticFiles.map(rel));
  for (const file of listed) {
    expect(
      inspected.has(`.next/${file}`),
      `${file}: listado en build-manifest.json`
    ).toBe(true);
  }

  const prerendered = ["server/app", "server/pages"]
    .map((dir) => path.join(NEXT_DIR, dir))
    .filter((dir) => existsSync(dir))
    .flatMap(filesUnder)
    .filter((file) => /\.(html|rsc)$/.test(file));
  expect(
    prerendered.filter((file) => file.endsWith(".html")).length,
    "no hay HTML prerenderizado en .next/server"
  ).toBeGreaterThan(0);

  const files = [...staticFiles, ...prerendered];
  // Un archivo comprimido no se puede inspeccionar byte a byte: no se da por bueno.
  expect(files.filter((file) => /\.(gz|br|zst)$/.test(file)).map(rel)).toEqual([]);
  return files;
}

test("D1: el build de E1 está completo y se inspecciona entero", () => {
  // La aguja es la clave ficticia del mock, nunca una real.
  expect(MOCK_SERVICE_ROLE_KEY).toMatch(/^e1-mock-[a-z-]+-no-es-un-secreto$/);
  expect(publicBuildFiles().length).toBeGreaterThan(0);
});

test("D1: ni el valor ficticio de la clave ni el nombre de su variable están en los bundles públicos", () => {
  const files = publicBuildFiles();
  const found: Array<{ kind: string; file: string }> = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const { kind, variants } of NEEDLES) {
      if (variants.some((needle) => bytes.indexOf(needle) !== -1)) {
        found.push({ kind, file: rel(file) });
      }
    }
  }
  expect(found, "coincidencias (tipo y ruta relativa)").toEqual([]);
});
