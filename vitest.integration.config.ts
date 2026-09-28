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
    },
  },
});
