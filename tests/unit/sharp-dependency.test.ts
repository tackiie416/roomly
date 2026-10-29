import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

// Fase 4.2: el servidor limpia cada foto con sharp. Llega como dependencia
// directa y exacta (decisión del propietario), no como dependencia opcional de
// next, que un `npm ci --omit=optional` o un cambio de next podrían quitar.
describe("sharp como dependencia directa", () => {
  it("package.json lo fija en 0.35.4 exacta, en dependencies", () => {
    const pkg = read("package.json");
    expect(pkg.dependencies.sharp).toBe("0.35.4");
    expect(pkg.devDependencies?.sharp).toBeUndefined();
    expect(pkg.optionalDependencies?.sharp).toBeUndefined();
  });

  it("package-lock.json lo instala siempre (ni opcional ni de desarrollo), con integridad", () => {
    const lock = read("package-lock.json");
    expect(lock.packages[""].dependencies.sharp).toBe("0.35.4");
    const entry = lock.packages["node_modules/sharp"];
    expect(entry.version).toBe("0.35.4");
    expect(entry.resolved).toBe("https://registry.npmjs.org/sharp/-/sharp-0.35.4.tgz");
    expect(entry.integrity).toMatch(/^sha512-/);
    expect(entry.optional).toBeUndefined();
    expect(entry.dev).toBeUndefined();
    expect(entry.devOptional).toBeUndefined();
  });

  it("la versión instalada es la fijada", () => {
    expect(read("node_modules/sharp/package.json").version).toBe("0.35.4");
  });
});
