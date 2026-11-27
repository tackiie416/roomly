import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Fase 7 — cada página del panel llama a requireAdmin() ella misma (no basta
// el layout: Next.js renderiza la página en paralelo, docs/SECURITY.md, 2.2),
// y ninguna toca service_role ni escribe tablas directamente.

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const ADMIN_PAGES = pages(join(process.cwd(), "app/admin"));

describe("páginas de /admin", () => {
  it("existen las cinco secciones y sus fichas", () => {
    const rel = ADMIN_PAGES.map((p) => p.slice(process.cwd().length + 1)).sort();
    expect(rel).toEqual([
      "app/admin/habitaciones/[id]/page.tsx",
      "app/admin/habitaciones/page.tsx",
      "app/admin/metricas/page.tsx",
      "app/admin/page.tsx",
      "app/admin/reportes/page.tsx",
      "app/admin/usuarios/[id]/page.tsx",
      "app/admin/usuarios/page.tsx",
    ]);
  });

  it.each(ADMIN_PAGES)("%s llama a requireAdmin() y no usa el cliente admin", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(/await requireAdmin\(\)/);
    expect(source).not.toMatch(/supabase\/admin|service_role|createAdminClient/);
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it("no hay loading.tsx en el panel (rompería las páginas sin JavaScript)", () => {
    expect(() => statSync(join(process.cwd(), "app/admin/loading.tsx"))).toThrow();
  });
});
