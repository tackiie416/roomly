import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

// Fase 4.2: el servidor limpia cada foto con sharp. Llega como dependencia
// directa y exacta (decisión del propietario), no como dependencia opcional de
// next, que un `npm ci --omit=optional` o un cambio de next podrían quitar.
// 0.35.5 corrige GHSA-wq5f-xc86-pv6w (librsvg 2.63.2).
describe("sharp como dependencia directa", () => {
  it("package.json lo fija en 0.35.5 exacta, en dependencies", () => {
    const pkg = read("package.json");
    expect(pkg.dependencies.sharp).toBe("0.35.5");
    expect(pkg.devDependencies?.sharp).toBeUndefined();
    expect(pkg.optionalDependencies?.sharp).toBeUndefined();
  });

  it("package-lock.json lo instala siempre (ni opcional ni de desarrollo), con integridad", () => {
    const lock = read("package-lock.json");
    expect(lock.packages[""].dependencies.sharp).toBe("0.35.5");
    const entry = lock.packages["node_modules/sharp"];
    expect(entry.version).toBe("0.35.5");
    expect(entry.resolved).toBe("https://registry.npmjs.org/sharp/-/sharp-0.35.5.tgz");
    expect(entry.integrity).toMatch(/^sha512-/);
    expect(entry.optional).toBeUndefined();
    expect(entry.dev).toBeUndefined();
    expect(entry.devOptional).toBeUndefined();
  });

  it("la versión instalada es la fijada", () => {
    expect(read("node_modules/sharp/package.json").version).toBe("0.35.5");
  });
});

// Versiones mínimas que corrigen las alertas críticas y altas revisadas en la
// sesión 64 (docs/SECURITY.md, «Dependencias»). Un retroceso por debajo de
// ellas tiene que fallar aquí, no solo en `npm audit`.
const parse = (version: string) => version.split(".").map(Number);
const atLeast = (version: string, floor: string) => {
  const [a, b] = [parse(version), parse(floor)];
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
};

describe("versiones mínimas corregidas", () => {
  it("next sigue en la línea 16 y no baja de 16.4.1 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r)", () => {
    const lock = read("package-lock.json");
    const version = lock.packages["node_modules/next"].version;
    expect(version).toMatch(/^16\.\d+\.\d+$/);
    expect(atLeast(version, "16.4.1"), version).toBe(true);
    expect(read("package.json").dependencies.next).toBe(version);
    expect(lock.packages["node_modules/eslint-config-next"].version).toBe(version);
  });

  it("zod no baja de 4.6.6 (GHSA-mrhx-c7xc-m3w5)", () => {
    const version = read("package-lock.json").packages["node_modules/zod"].version;
    expect(atLeast(version, "4.6.6"), version).toBe(true);
  });

  it("source-map-js no baja de 1.2.2 (GHSA-68fv-2mgg-jv7q) en ninguna copia del lockfile", () => {
    const packages = read("package-lock.json").packages as Record<
      string,
      { version: string }
    >;
    const copies = Object.entries(packages).filter(([path]) =>
      path.endsWith("node_modules/source-map-js")
    );
    expect(copies.length).toBeGreaterThan(0);
    for (const [path, entry] of copies) {
      expect(atLeast(entry.version, "1.2.2"), path).toBe(true);
    }
  });
});
