import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": dirname,
      // `server-only` lanza un error fuera de un entorno de servidor de React.
      // En los tests unitarios de lib/services/* se usa su propio módulo vacío
      // (el que Next.js resuelve con la condición "react-server").
      "server-only": path.join(dirname, "node_modules/server-only/empty.js"),
    },
  },
});
