import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

/**
 * Cobertura del motor de matching (`npm run test:coverage:matching`).
 *
 * Ejecuta los mismos tests que `npm run test` (tests/unit/**, la
 * configuración de vitest.config.ts) y mide con V8 solo `lib/matching/`.
 * Con `include`, el informe trae todos los archivos de esa carpeta, también
 * los que ningún test carga. Sin umbrales a propósito: solo mide; qué nivel
 * cuenta como «casi total» (criterio de la Fase 3) lo decide el propietario.
 * Los informes van a coverage/matching/, que no se versiona (.gitignore).
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        provider: "v8",
        include: ["lib/matching/**/*.ts"],
        // Todos los archivos en la tabla, también los que están al 100 %.
        reporter: [["text", { skipFull: false, maxCols: 120 }], "json-summary"],
        reportsDirectory: "coverage/matching",
      },
    },
  })
);
