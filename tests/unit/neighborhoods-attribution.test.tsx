import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/onboarding", () => ({
  submitOnboardingProfile: async () => ({}),
  submitOnboardingPreferences: async () => ({}),
}));

import {
  NEIGHBORHOODS_SOURCE,
  NeighborhoodsAttribution,
} from "@/components/rooms/neighborhoods-attribution";
import { PreferencesForm } from "@/components/onboarding/preferences-form";

// Atribución del catálogo de barrios (R1, CC BY 4.0), sesión 69: los
// metadatos que verificó el propietario en datos.gob.es, un único componente
// y su presencia junto al selector de barrios del onboarding y de
// /preferencias (el mismo PreferencesForm). Las pantallas de habitaciones lo
// comprueban en rooms-crud-pages.test.tsx, y E1 lo comprueba en el navegador,
// también sin JavaScript.

const EXPECTED_TEXT =
  "Barrios de Barcelona: datos procedentes del conjunto “Unidades administrativas de la ciudad de Barcelona”, publicado por el Ayuntamiento de Barcelona (Open Data BCN), recurso “BarcelonaCiutat_Barris.json”. ROOMLY utiliza los nombres de los 73 barrios y genera identificadores internos; no reutiliza los códigos de distrito ni las geometrías del recurso. Licencia CC BY 4.0. Esta atribución no implica que el Ayuntamiento de Barcelona avale ROOMLY.";

const DATASET_URL =
  "https://datos.gob.es/es/catalogo/l01080193-unidades-administrativas-de-la-ciudad-de-barcelona";
const RESOURCE_URL =
  "https://opendata-ajuntament.barcelona.cat/data/dataset/808daafa-d9ce-48c0-925a-fa5afdb1ed41/resource/75197dfe-0306-4c5e-9643-34948af07fb6/download";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/deed.es";

const html = renderToStaticMarkup(<NeighborhoodsAttribution />);
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const links = (markup: string) =>
  [...markup.matchAll(/<a href="([^"]+)"[^>]*rel="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
    ([, href, rel, label]) => ({ href, rel, label })
  );

/** Código sin comentarios. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [full.split(path.sep).join("/")] : [];
  });
}
const APP_FILES = [
  ...sourceFiles("app"),
  ...sourceFiles("components"),
  ...sourceFiles("lib"),
];
const COMPONENT = "components/rooms/neighborhoods-attribution.tsx";

describe("NeighborhoodsAttribution: texto y enlaces verificados", () => {
  it("dice exactamente el texto acordado", () => {
    expect(text(html)).toBe(EXPECTED_TEXT);
  });

  it("nombra el conjunto y el recurso correctos, sin confundirlos", () => {
    expect(NEIGHBORHOODS_SOURCE.datasetTitle).toBe(
      "Unidades administrativas de la ciudad de Barcelona"
    );
    expect(NEIGHBORHOODS_SOURCE.resourceName).toBe("BarcelonaCiutat_Barris.json");
    expect(text(html)).toContain(
      "del conjunto “Unidades administrativas de la ciudad de Barcelona”"
    );
    expect(text(html)).toContain("recurso “BarcelonaCiutat_Barris.json”");
    expect(text(html)).not.toMatch(/conjunto\s*[«“"]?\s*BarcelonaCiutat_Barris/);
  });

  it("enlaza la ficha de datos.gob.es, la descarga original y la licencia en español", () => {
    expect(links(html)).toEqual([
      {
        href: DATASET_URL,
        rel: "noopener noreferrer",
        label: "Unidades administrativas de la ciudad de Barcelona",
      },
      {
        href: RESOURCE_URL,
        rel: "noopener noreferrer",
        label: "BarcelonaCiutat_Barris.json",
      },
      { href: LICENSE_URL, rel: "noopener noreferrer license", label: "CC BY 4.0" },
    ]);
  });

  it("la descarga es la del recurso JSON de ese conjunto en Open Data BCN", () => {
    expect(NEIGHBORHOODS_SOURCE.datasetId).toBe("808daafa-d9ce-48c0-925a-fa5afdb1ed41");
    expect(NEIGHBORHOODS_SOURCE.resourceId).toBe("75197dfe-0306-4c5e-9643-34948af07fb6");
    expect(NEIGHBORHOODS_SOURCE.resourceUrl).toBe(
      `https://opendata-ajuntament.barcelona.cat/data/dataset/${NEIGHBORHOODS_SOURCE.datasetId}/resource/${NEIGHBORHOODS_SOURCE.resourceId}/download`
    );
  });

  it("la transformación descrita es la de la migración de los barrios", () => {
    const migration = readFileSync(
      "supabase/migrations/20261016120000_barcelona_neighborhoods.sql",
      "utf8"
    );
    // 73 barrios; se insertan solo el nombre y el slug derivado (el id lo
    // genera la base de datos). Ni distritos ni geometrías.
    expect(migration.match(/^\s*\['\d{2}', '[a-z0-9-]+', '.+'\],?$/gm)).toHaveLength(73);
    expect(migration).toMatch(
      /insert into public\.neighborhoods \(city_id, name, slug\)\s+select barcelona, official\[i\]\[3\], official\[i\]\[2\]/
    );
    const sql = migration.replace(/--.*$/gm, "");
    // `center_lat` solo aparece al crear la ciudad con los valores del seed,
    // no en los barrios (su INSERT es el de arriba).
    expect(sql).not.toMatch(/districte|geometria|official\[i\]\[1\]/);
  });

  it("sin JavaScript: es HTML estático (sin directiva de cliente ni estado)", () => {
    const source = readFileSync(COMPONENT, "utf8");
    expect(source).not.toMatch(/"use client"|useState|useEffect|onClick/);
  });
});

describe("Un único texto de atribución, sin la redacción antigua", () => {
  it("solo el componente nombra la fuente o la licencia de los barrios", () => {
    const owners = APP_FILES.filter((file) =>
      /Open Data BCN|CC BY|BarcelonaCiutat_Barris|creativecommons\.org/.test(code(file))
    );
    expect(owners).toEqual([COMPONENT]);
  });

  it("ningún archivo de la app conserva textos antiguos", () => {
    for (const file of APP_FILES) {
      const source = code(file);
      expect(source, file).not.toMatch(/conjunto «BarcelonaCiutat_Barris»/);
      expect(source, file).not.toMatch(/© Ajuntament de Barcelona/);
      expect(source, file).not.toMatch(/el Ajuntament avale/);
      expect(source, file).not.toMatch(
        /href="https:\/\/opendata-ajuntament\.barcelona\.cat\/"/
      );
    }
  });
});

describe("Junto al selector de barrios del onboarding y de /preferencias", () => {
  const CITY = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
  const props = {
    cities: [{ id: CITY, name: "Barcelona" }],
    universities: [],
    neighborhoods: [{ id: "n1", name: "Gràcia", city_id: CITY }],
  };
  const fieldset = (markup: string) =>
    markup.match(
      /<fieldset[^>]*>(?:(?!<\/fieldset>)[\s\S])*Barrios que prefieres[\s\S]*?<\/fieldset>/
    )?.[0] ?? "";

  it.each([
    ["onboarding, sin ciudad elegida", {}, {}],
    ["onboarding, con ciudad", { city_id: CITY }, {}],
    [
      "/preferencias",
      { city_id: CITY },
      {
        submitAction: async () => ({}),
        submitLabel: "Guardar preferencias",
        cityRequired: false,
      },
    ],
  ])("%s: dentro del fieldset de los barrios", (_label, initialValues, extra) => {
    const markup = renderToStaticMarkup(
      <PreferencesForm {...props} initialValues={initialValues} {...extra} />
    );
    const group = fieldset(markup);
    expect(group).not.toBe("");
    expect(group).toContain('data-testid="neighborhoods-attribution"');
    expect(text(group)).toContain(EXPECTED_TEXT);
    expect(markup.match(/data-testid="neighborhoods-attribution"/g)).toHaveLength(1);
  });
});
