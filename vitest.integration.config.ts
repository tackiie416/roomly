import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Suite de validación contra un proyecto Supabase REAL (ver
 * docs/SUPABASE_VALIDATION.md). Separada de vitest.config.ts a propósito:
 * `npm run test` nunca la ejecuta. Se lanza con `npm run test:supabase`
 * desde el workflow manual .github/workflows/supabase-validation.yml.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": dirname,
      // Como en vitest.config.ts: `server-only` lanza un error fuera de un
      // entorno de servidor de React. Las pruebas SVC/GC importan
      // lib/services/{compatibility,matching}.ts y usan su módulo vacío (el
      // que Next.js resuelve con la condición "react-server").
      "server-only": path.join(dirname, "node_modules/server-only/empty.js"),
    },
  },
});
