import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Fase 2.8 — coherencia de la infraestructura de validación, sin red:
//   - identidad roomly-validation-2 en todos los puntos de entrada;
//   - preflight.sql con exactamente las políticas y triggers de las migraciones;
//   - E1 (local, simulado) y E2 (real, manual) separados;
//   - secrets del workflow: service_role nunca en la app ni en Playwright,
//     limpieza siempre, sin artefactos del E2.

const read = (file: string) => readFileSync(file, "utf8");
/** Código sin comentarios (// y /* *\/), para comprobaciones sobre el fuente. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const MARKER = "roomly-validation-2";
const OLD_MARKER = "roomly-validation";

describe("identidad del proyecto P1: roomly-validation-2, comparación exacta", () => {
  it("guard.sh define la marca nueva", () => {
    expect(read("tests/supabase/guard.sh")).toMatch(
      /^ROOMLY_VALIDATION_MARKER="roomly-validation-2"$/m
    );
  });

  it("preflight.sql (P0) compara con la marca nueva y con <> exacto", () => {
    const sql = read("tests/supabase/preflight.sql");
    expect(sql).toContain(`'') <> '${MARKER}' then`);
    expect(sql).not.toContain(`'${OLD_MARKER}'`);
  });

  it("el runner SQL usa la marca de guard.sh en cada sesión, sin literal propio", () => {
    const lib = read("tests/supabase/sql-suite-lib.sh");
    expect(lib).toContain("${ROOMLY_VALIDATION_MARKER:?");
    expect(lib).toMatch(/<> '\$\{marker\}' then/);
    expect(lib).not.toContain(`'${OLD_MARKER}'`);
    const runner = read("tests/supabase/run-sql-suite.sh");
    const guardAt = runner.indexOf('source "$ROOT/tests/supabase/guard.sh"');
    const libAt = runner.indexOf('source "$ROOT/tests/supabase/sql-suite-lib.sh"');
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(libAt);
  });

  it("la suite de integración y la limpieza del E2 pasan por guard.sh", () => {
    expect(read("tests/integration/supabase-validation.test.ts")).toContain(
      "tests/supabase/guard.sh"
    );
    expect(read("tests/e2e/real/cleanup.mjs")).toContain("tests/supabase/guard.sh");
  });

  it("ningún script de validación acepta la marca antigua", () => {
    for (const file of readdirSync("tests/supabase")) {
      if (file === "guard-selftest.sh") continue; // la usa como caso negativo
      const text = read(path.join("tests/supabase", file));
      expect(text, file).not.toMatch(/(=|<>|!=)\s*'roomly-validation'/);
      expect(text, file).not.toMatch(/"roomly-validation"/);
    }
  });

  it("el workflow confirma exactamente roomly-validation-2 y usa su Environment en todos los jobs", () => {
    const workflow = read(".github/workflows/supabase-validation.yml");
    expect(workflow).toContain(`if [ "$CONFIRM" != "${MARKER}" ]; then`);
    const jobs = workflow
      .slice(workflow.indexOf("\njobs:\n"))
      .split(/\n(?=  [a-z0-9-]+:\n)/)
      .slice(1);
    expect(jobs.map((job) => job.trim().split(":")[0])).toEqual([
      "guard",
      "migrate",
      "preflight",
      "sql-suite",
      "api-suite",
      "auth-redirects",
      "e2e-real",
    ]);
    for (const job of jobs) {
      expect(job, job.split("\n")[0]).toContain(`    environment: ${MARKER}\n`);
    }
  });
});

/** Estado final de políticas / triggers tras aplicar las migraciones en orden. */
function fromMigrations() {
  const policies = new Set<string>();
  const triggers = new Set<string>();
  const dir = "supabase/migrations";
  for (const file of readdirSync(dir).sort()) {
    const sql = read(path.join(dir, file)).replace(/--.*$/gm, "");
    const statements =
      /(create|drop) (policy|trigger) +"?([a-z_0-9]+)"?[\s\S]*?\bon +(?:public\.)?([a-z_]+)/gi;
    for (const [, verb, kind, name, table] of sql.matchAll(statements)) {
      const set = kind.toLowerCase() === "policy" ? policies : triggers;
      const key = `${table}.${name}`;
      if (verb.toLowerCase() === "create") set.add(key);
      else set.delete(key);
    }
  }
  return { policies, triggers };
}

function preflightValues(block: RegExp) {
  const sql = read("tests/supabase/preflight.sql");
  const section = sql.match(block)?.[1] ?? "";
  return new Set(
    [...section.matchAll(/\('([a-z_]+)', '([a-z_0-9]+)'/g)].map(([, t, n]) => `${t}.${n}`)
  );
}

describe("preflight.sql: lista exacta derivada de las migraciones", () => {
  const derived = fromMigrations();

  it("37 políticas, las mismas (tabla, política) que dejan las migraciones", () => {
    const expected = preflightValues(
      /-- P3[\s\S]*?with expected\(tablename, policyname, cmd\) as \(values([\s\S]*?)\n  \),/
    );
    expect(derived.policies.size).toBe(37);
    expect([...expected].sort()).toEqual([...derived.policies].sort());
  });

  it("housing_preferences: las cuatro políticas de 20260930130000, sin la antigua", () => {
    const hp = [...derived.policies].filter((p) => p.startsWith("housing_preferences."));
    expect(hp.sort()).toEqual([
      "housing_preferences.housing_preferences_delete_own",
      "housing_preferences.housing_preferences_insert_own",
      "housing_preferences.housing_preferences_select_own",
      "housing_preferences.housing_preferences_update_own",
    ]);
  });

  it("12 triggers, los mismos que crean las migraciones", () => {
    const expected = preflightValues(
      /-- P6[\s\S]*?with expected\(tablename, tgname, fn\) as \(values([\s\S]*?)\n  \),/
    );
    expect(derived.triggers.size).toBe(12);
    expect([...expected].sort()).toEqual([...derived.triggers].sort());
  });

  it("no cuenta: compara conjuntos en los dos sentidos", () => {
    const sql = read("tests/supabase/preflight.sql");
    expect(sql).not.toMatch(/count\(\*\) from pg_policies[^;]*<> *3[58]/);
    expect(sql.match(/except select \* from/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("solo lectura: sin tablas temporales ni DDL", () => {
    const sql = read("tests/supabase/preflight.sql").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(
      /\b(create|alter|drop|insert|update|delete|grant|revoke)\s+(temporary|table|policy|function|trigger|into|on)\b/i
    );
  });
});

describe("E1 (local, simulado) y E2 (real, manual) separados", () => {
  const e1 = read("playwright.config.ts");
  const e2 = code("playwright.real.config.ts");

  it("directorios distintos y npm run test:e2e = solo E1", () => {
    expect(e1).toContain('testDir: "./tests/e2e/local"');
    expect(e2).toContain('testDir: "./tests/e2e/real"');
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:e2e"]).toBe("playwright test");
    expect(pkg.scripts["test:e2e:real"]).toBe(
      "playwright test -c playwright.real.config.ts"
    );
  });

  it("E1: la app solo recibe la URL del mock y la clave anon ficticia; nunca reutiliza un servidor", () => {
    const env = e1.match(/env: \{([\s\S]*?)\}/)?.[1] ?? "";
    expect([...env.matchAll(/([A-Z_]+):/g)].map((m) => m[1]).sort()).toEqual([
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
    expect(e1.match(/reuseExistingServer: false/g)).toHaveLength(2);
    expect(read("tests/e2e/support/mock-config.mjs")).toContain("http://127.0.0.1:");
  });

  it("E2: sin trace, vídeo, capturas, report HTML, instantánea de página ni reintentos; sin webServer", () => {
    for (const setting of [
      'trace: "off"',
      'video: "off"',
      'screenshot: "off"',
      'reporter: "list"',
      "retries: 0",
      'preserveOutput: "never"',
    ]) {
      expect(e2).toContain(setting);
    }
    expect(e2).toContain('process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1"');
    expect(e2).not.toContain("webServer");
  });

  it("ningún archivo de Playwright ni del E2E usa la clave service_role ni la API admin", () => {
    const files = [
      "playwright.config.ts",
      "playwright.real.config.ts",
      ...readdirSync("tests/e2e/local").map((f) => `tests/e2e/local/${f}`),
      "tests/e2e/real/student-real.spec.ts",
      "tests/e2e/real/e2e-real-lib.mjs",
    ];
    for (const file of files)
      expect(code(file), file).not.toMatch(/SERVICE_ROLE_KEY|serviceKey|auth\.admin/);
  });

  it("E2 recorre el flujo real: sin generateLink, verifyOtp, token_hash ni contraseña", () => {
    const spec = code("tests/e2e/real/student-real.spec.ts");
    expect(spec).not.toMatch(
      /generateLink|verifyOtp|token_hash|signInWithPassword|setSession|addCookies/
    );
    expect(spec).toContain('getByRole("button", { name: "Enviar enlace" })');
    expect(code("app/(auth)/callback/route.ts")).not.toMatch(/token_hash|verifyOtp/);
  });

  it("E1 y E2 no se importan entre sí (salvo la lógica pura compartida)", () => {
    for (const f of readdirSync("tests/e2e/local")) {
      expect(read(`tests/e2e/local/${f}`), f).not.toContain("/real/");
    }
    expect(read("tests/e2e/real/student-real.spec.ts")).not.toContain("support/");
  });
});

describe("workflow manual: secrets por paso", () => {
  const workflow = read(".github/workflows/supabase-validation.yml");
  const e2eJob = workflow.slice(workflow.indexOf("\n  e2e-real:"));
  const steps = e2eJob.split(/\n      - /).slice(1);
  const step = (text: string) => {
    const found = steps.find((s) => s.includes(text));
    expect(found, text).toBeDefined();
    return found as string;
  };

  it("la app se construye y arranca solo con NEXT_PUBLIC_* (URL + anon)", () => {
    const app = step("Build y arranque de la app");
    const vars = [...app.matchAll(/^ {10}([A-Z_]+):/gm)].map((m) => m[1]).sort();
    expect(vars).toEqual([
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("el proceso de Playwright no recibe service_role ni la conexión de BD", () => {
    const e2 = step("E2 — formulario real");
    expect(e2).not.toMatch(/SERVICE_ROLE|DB_URL/);
    expect(e2).toContain("npx playwright test -c playwright.real.config.ts");
  });

  it("service_role solo en la preparación y la limpieza", () => {
    const withServiceRole = steps.filter((s) => s.includes("SERVICE_ROLE_KEY"));
    expect(withServiceRole.map((s) => s.split("\n")[0])).toEqual([
      expect.stringContaining("Preparación"),
      expect.stringContaining("Limpieza"),
    ]);
  });

  it("la limpieza se ejecuta siempre y va después del E2", () => {
    const cleanup = step("Limpieza");
    expect(cleanup).toContain("if: ${{ always() }}");
    expect(cleanup).toContain("node tests/e2e/real/cleanup.mjs after");
    expect(e2eJob.indexOf("E2 — formulario real")).toBeLessThan(
      e2eJob.indexOf("Limpieza")
    );
  });

  it("dirección enmascarada, id único por ejecución y ningún artefacto subido", () => {
    expect(e2eJob).toContain(
      "E2E_RUN_ID: e2e-${{ github.run_id }}-${{ github.run_attempt }}"
    );
    expect(step("Enmascarar")).toContain("::add-mask::");
    expect(workflow).not.toContain("upload-artifact");
  });

  it("E2 detrás de las guardas: needs sql-suite (que necesita preflight y guard) y opt-in explícito", () => {
    expect(e2eJob).toContain("needs: sql-suite");
    expect(e2eJob).toContain("inputs.run_e2e_real");
    expect(workflow).toMatch(/sql-suite:[\s\S]*?needs: preflight/);
    expect(workflow).toMatch(/preflight:[\s\S]*?needs: \[guard, migrate\]/);
  });

  it("ninguna variable NEXT_PUBLIC_* lleva un secret privilegiado", () => {
    for (const file of [
      ".github/workflows/supabase-validation.yml",
      ".github/workflows/ci.yml",
    ]) {
      for (const [, name, value] of read(file).matchAll(/(NEXT_PUBLIC_[A-Z_]+): (.*)/g)) {
        expect(`${name}: ${value}`, file).not.toMatch(
          /SERVICE_ROLE|DB_URL|MAILBOX|PASSWORD/
        );
      }
    }
  });
});
