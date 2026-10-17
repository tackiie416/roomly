import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ROOM_FEATURE_KEYS,
  ROOM_PUBLICATION_REQUIRED_FIELDS,
} from "@/lib/validation/rooms";

// Fase 2.8 — coherencia de la infraestructura de validación, sin red:
//   - identidad roomly-validation-3 en todos los puntos de entrada (Fase 3:
//     proyecto nuevo; la marca de la Fase 2.8 ya no pasa);
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
const MARKER = "roomly-validation-3";
const OLD_MARKER = "roomly-validation";
/** Marca de la Fase 2.8 (uwxb…): aislamiento, no debe pasar ninguna guarda. */
const PREVIOUS_MARKER = "roomly-validation-2";

describe("identidad del proyecto P1: roomly-validation-3, comparación exacta", () => {
  it("guard.sh define la marca nueva", () => {
    expect(read("tests/supabase/guard.sh")).toMatch(
      /^ROOMLY_VALIDATION_MARKER="roomly-validation-3"$/m
    );
  });

  it("preflight.sql (P0) compara con la marca nueva y con <> exacto", () => {
    const sql = read("tests/supabase/preflight.sql");
    expect(sql).toContain(`'') <> '${MARKER}' then`);
    expect(sql).not.toContain(`'${OLD_MARKER}'`);
    expect(sql).not.toContain(PREVIOUS_MARKER);
  });

  it("el runner SQL usa la marca de guard.sh en cada sesión, sin literal propio", () => {
    const lib = read("tests/supabase/sql-suite-lib.sh");
    expect(lib).toContain("${ROOMLY_VALIDATION_MARKER:?");
    expect(lib).toMatch(/<> '\$\{marker\}' then/);
    expect(lib).not.toContain(`'${OLD_MARKER}'`);
    expect(lib).not.toContain(PREVIOUS_MARKER);
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

  it("aislamiento: ningún punto de entrada ejecutable menciona la marca de la Fase 2.8", () => {
    // Solo los auto-tests la usan, como caso negativo que debe abortar.
    const negativeCases = new Set([
      "guard-selftest.sh",
      "phase4-upgrade-selftest.sh",
      "preflight-selftest.sh",
      "sql-suite-selftest.sh",
    ]);
    const files = [
      ...readdirSync("tests/supabase")
        .filter((file) => !negativeCases.has(file))
        .map((file) => path.join("tests/supabase", file)),
      ...readdirSync(".github/workflows").map((file) =>
        path.join(".github/workflows", file)
      ),
      ...readdirSync("tests/e2e/real", { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name)),
      "tests/integration/supabase-validation.test.ts",
      "playwright.real.config.ts",
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(read(file), file).not.toContain(PREVIOUS_MARKER);
    }
  });

  it("aislamiento: los auto-tests prueban que la marca de la Fase 2.8 se rechaza", () => {
    const guard = read("tests/supabase/guard-selftest.sh");
    expect(guard).toContain(`comment on database \${VAL_DB} is '${MARKER}'`);
    expect(guard).toContain(`comment on database \${OTHER_DB} is '${PREVIOUS_MARKER}'`);
    expect(guard).toMatch(/expect fail "5: aislamiento: proyecto anterior/);
    for (const entry of [
      "apply-migrations",
      "run-preflight",
      "run-sql-suite",
      "preflight.sql",
    ]) {
      expect(guard).toMatch(new RegExp(`expect fail "5: ${entry.replace(".", "\\.")}`));
    }
    expect(read("tests/supabase/preflight-selftest.sh")).toContain(
      `P0|marca del proyecto anterior ${PREVIOUS_MARKER} (aislamiento)|`
    );
    expect(read("tests/supabase/sql-suite-selftest.sh")).toContain(
      `comment on database \${DB} is '${PREVIOUS_MARKER}'`
    );
  });

  it("el workflow confirma exactamente roomly-validation-3 y usa su Environment en todos los jobs", () => {
    const workflow = read(".github/workflows/supabase-validation.yml");
    expect(workflow).toContain(`if [ "$CONFIRM" != "${MARKER}" ]; then`);
    const jobs = workflow
      .slice(workflow.indexOf("\njobs:\n"))
      .split(/\n(?=  [a-z0-9-]+:\n)/)
      .slice(1);
    expect(jobs.map((job) => job.trim().split(":")[0])).toEqual([
      "guard",
      "migrate",
      "phase4-upgrade",
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

  it("44 políticas, las mismas (tabla, política) que dejan las migraciones", () => {
    const expected = preflightValues(
      /-- P3[\s\S]*?with expected\(tablename, policyname, cmd\) as \(values([\s\S]*?)\n  \),/
    );
    expect(derived.policies.size).toBe(44);
    expect([...expected].sort()).toEqual([...derived.policies].sort());
  });

  it("rooms, room_addresses y room_images: las políticas por comando de 20261013120000, sin las antiguas FOR ALL", () => {
    const rooms = [...derived.policies].filter((p) =>
      /^room(s|_addresses|_images)\./.test(p)
    );
    expect(rooms.sort()).toEqual([
      "room_addresses.room_addresses_delete_own",
      "room_addresses.room_addresses_insert_own",
      "room_addresses.room_addresses_select_own",
      "room_addresses.room_addresses_update_own",
      "room_images.room_images_delete_own",
      "room_images.room_images_insert_own",
      "room_images.room_images_select",
      "room_images.room_images_update_own",
      "rooms.rooms_admin_all",
      "rooms.rooms_delete_own",
      "rooms.rooms_insert_own",
      "rooms.rooms_select_active_public",
      "rooms.rooms_select_own",
      "rooms.rooms_update_own",
    ]);
  });

  it("P3 comprueba que las escrituras de habitaciones exigen cuenta activa", () => {
    const p3 =
      read("tests/supabase/preflight.sql").match(/-- P3[\s\S]*?-- P4/)?.[0] ?? "";
    expect(p3).toContain("tablename in ('rooms', 'room_addresses', 'room_images')");
    expect(p3).toContain("like '%deleted_at IS NULL%'");
    expect(p3).toMatch(
      /FALLO P3: políticas de escritura de habitaciones sin la comprobación de cuenta activa/
    );
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

  it("compatibility_responses: solo la política SELECT de 20261007120000, sin la antigua FOR ALL", () => {
    const cr = [...derived.policies].filter((p) =>
      p.startsWith("compatibility_responses.")
    );
    expect(cr).toEqual(["compatibility_responses.compatibility_responses_select_own"]);
  });

  it("13 triggers, los mismos que crean las migraciones", () => {
    const expected = preflightValues(
      /-- P6[\s\S]*?with expected\(tablename, tgname, fn\) as \(values([\s\S]*?)\n  \),/
    );
    expect(derived.triggers.size).toBe(13);
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

describe("Fase 4.1: catálogo, GRANT y restricciones de rooms coherentes", () => {
  const MIGRATION = "supabase/migrations/20261015120000_rooms_integrity_publication.sql";
  const migration = read(MIGRATION).replace(/--.*$/gm, "");
  const preflight = read("tests/supabase/preflight.sql");
  const test16 = read("tests/db/16_rooms_publication.sql");
  const keys = (text: string) =>
    [...text.matchAll(/'([a-z_]+)'/g)].map(([, k]) => k).sort();
  const catalog = [...ROOM_FEATURE_KEYS].sort();
  const columnList = (text: string) =>
    text
      .split(",")
      .map((column) => column.trim())
      .sort();
  const RESERVED_INSERT = [
    "approx_lat",
    "approx_lng",
    "created_at",
    "deleted_at",
    "status",
    "updated_at",
  ];
  const RESERVED_UPDATE = [
    "approx_lat",
    "approx_lng",
    "created_at",
    "deleted_at",
    "id",
    "owner_id",
    "updated_at",
  ];
  const grantInsert = columnList(
    migration.match(
      /grant insert \(([\s\S]*?)\) on public\.rooms to authenticated/
    )?.[1] ?? ""
  );
  const grantUpdate = columnList(
    migration.match(
      /grant update \(([\s\S]*?)\) on public\.rooms to authenticated/
    )?.[1] ?? ""
  );

  it("el catálogo del código (ROOM_FEATURES) es el de la migración, P1 y tests/db/16", () => {
    expect(catalog).toHaveLength(12);
    const arrays = [...migration.matchAll(/array\[([\s\S]*?)\]::text\[\]/g)].map(
      ([, a]) => a
    );
    expect(arrays).toHaveLength(2); // comprobación previa y chk_rooms_features_catalog
    for (const array of arrays) expect(keys(array)).toEqual(catalog);
    const unique = [
      ...migration.matchAll(/array_positions\(features, '([a-z_]+)'\)/g),
    ].map(([, k]) => k);
    expect(unique.sort()).toEqual(catalog);
    expect(
      keys(preflight.match(/catalog is distinct from array\[([\s\S]*?)\]/)?.[1] ?? "")
    ).toEqual(catalog);
    const inTest = [...test16.matchAll(/unnest\(array\[([\s\S]*?)\]\) as k/g)].map(
      ([, a]) => a
    );
    expect(inTest).toHaveLength(2);
    for (const array of inTest) expect(keys(array)).toEqual(catalog);
  });

  it("toda columna de rooms está concedida o reservada al servidor, sin huecos", () => {
    const table =
      read("supabase/migrations/20260925120000_initial_schema.sql").match(
        /create table rooms \(([\s\S]*?)\n\);/
      )?.[1] ?? "";
    const columns = [...table.matchAll(/^ {2}([a-z_]+) /gm)]
      .map(([, c]) => c)
      .filter((c) => c !== "constraint")
      .sort();
    expect(columns).toHaveLength(26);
    expect([...grantInsert, ...RESERVED_INSERT].sort()).toEqual(columns);
    expect([...grantUpdate, ...RESERVED_UPDATE].sort()).toEqual(columns);
    expect(grantUpdate).toContain("status");
    expect(grantInsert).not.toContain("status");
  });

  it("P4 y tests/db/16 esperan exactamente las columnas que concede la migración", () => {
    const p4 =
      preflight.match(/-- rooms \(20261015120000[\s\S]*?if array_length/)?.[0] ?? "";
    expect(p4.match(/got_insert is distinct from '([^']+)'/)?.[1]).toBe(
      grantInsert.join(",")
    );
    expect(p4.match(/got_update is distinct from '([^']+)'/)?.[1]).toBe(
      grantUpdate.join(",")
    );
    const rs4 = [...test16.matchAll(/\n {4}= '([a-z_,]+)'/g)].map(([, list]) => list);
    expect(rs4).toEqual([grantInsert.join(","), grantUpdate.join(",")]);
  });

  it("P1 exige exactamente las restricciones que añade la migración a rooms", () => {
    const added = [
      ...migration.matchAll(/alter table public\.rooms\s+add constraint ([a-z_]+)/g),
    ]
      .map(([, name]) => name)
      .sort();
    const p1 = preflight.match(/-- P1[\s\S]*?-- P2/)?.[0] ?? "";
    const required = [
      ...(p1.match(/from \(values ([\s\S]*?)\) as v\(conname\)/)?.[1] ?? "").matchAll(
        /\('([a-z_]+)'\)/g
      ),
    ]
      .map(([, name]) => name)
      .sort();
    expect(added).toHaveLength(6);
    expect(required).toEqual(added);
  });

  it("los requisitos de publicación del código son los de chk_rooms_publishable", () => {
    const check =
      migration.match(
        /add constraint chk_rooms_publishable\s+check \(([\s\S]*?)\n {2}\);/
      )?.[1] ?? "";
    expect(check).toMatch(/status <> 'active'/);
    const required = [...check.matchAll(/([a-z_]+) is not null/g)].map(([, c]) => c);
    expect(required).toEqual([...ROOM_PUBLICATION_REQUIRED_FIELDS]);
  });
});

describe("Fase 4.1, R1: barrios oficiales de Barcelona coherentes", () => {
  const MIGRATION = "supabase/migrations/20261016120000_barcelona_neighborhoods.sql";
  const migration = read(MIGRATION);
  const seed = read("supabase/seed.sql");
  type Row = { code: string; slug: string; name: string };
  const rows = (text: string, open: string, close: string): Row[] =>
    [
      ...text.matchAll(
        new RegExp(`\\${open}'(\\d{2})', '([a-z0-9-]+)', '((?:[^']|'')*)'\\${close}`, "g")
      ),
    ].map(([, code, slug, name]) => ({ code, slug, name: name.replace(/''/g, "'") }));
  const official = rows(migration, "[", "]");
  /** La regla de la migración: minúsculas, sin acentos y «-» entre tramos. */
  const slugify = (name: string) =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const fingerprint = createHash("md5")
    .update(
      [...official]
        .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
        .map((r) => `${r.slug}|${r.name}`)
        .join("\n"),
      "utf8"
    )
    .digest("hex");

  it("la migración trae 73 barrios, códigos 01–73 y slugs derivados del nombre", () => {
    expect(official).toHaveLength(73);
    expect(official.map((r) => r.code)).toEqual(
      Array.from({ length: 73 }, (_, i) => String(i + 1).padStart(2, "0"))
    );
    expect(new Set(official.map((r) => r.slug)).size).toBe(73);
    expect(new Set(official.map((r) => r.name)).size).toBe(73);
    for (const r of official) {
      expect(r.slug).toBe(slugify(r.name));
      expect(r.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("crea Barcelona con los mismos valores que el seed, y el seed no la duplica", () => {
    const columns = "(name, slug, is_active, center_lat, center_lng)";
    const barcelona = (text: string) =>
      text.match(/\(\s*'Barcelona',\s*'barcelona',[^)]*\)/)?.[0].replace(/\s+/g, " ");
    expect(migration).toContain(`insert into public.cities ${columns}`);
    expect(seed).toContain(`insert into cities ${columns} values`);
    expect(barcelona(migration)).toBeDefined();
    expect(barcelona(migration)).toBe(barcelona(seed));
    expect(seed).toMatch(
      /\('Zaragoza', 'zaragoza', [^)]*\)\s*on conflict \(slug\) do nothing;/
    );
    expect(seed).not.toMatch(/insert into (public\.)?neighborhoods/);
  });

  it("es idempotente y no borra ni transforma barrios existentes", () => {
    const sql = migration.replace(/--.*$/gm, "");
    expect(sql).toMatch(/on conflict \(city_id, slug\) do nothing;/);
    expect(sql).not.toMatch(/\b(delete|truncate|update)\b/i);
    expect(sql).not.toMatch(/\b(create|alter|drop|grant|revoke)\b/i);
    expect(sql).toMatch(
      /errcode = '23514',\s+message = format\('neighborhoods_r1_precheck:/
    );
  });

  it("tests/db/18 trae la misma lista que la migración", () => {
    expect(rows(read("tests/db/18_neighborhoods_catalog.sql"), "(", ")")).toEqual(
      official
    );
  });

  it("P1 del preflight, tests/db/18 y el selftest de actualización exigen la huella de la migración", () => {
    const preflight = read("tests/supabase/preflight.sql");
    for (const file of [
      "tests/supabase/preflight.sql",
      "tests/db/18_neighborhoods_catalog.sql",
      "tests/supabase/migration-upgrade-selftest.sh",
    ]) {
      expect(read(file)).toContain(`'${fingerprint}'`);
    }
    expect(preflight).toMatch(new RegExp(`n_barcelona <> ${official.length} or`));
  });
});

describe("R8: herramienta de actualización de la Fase 4 (phase4-upgrade.sh)", () => {
  const SCRIPT = "tests/supabase/phase4-upgrade.sh";
  const script = read(SCRIPT);
  const workflow = read(".github/workflows/supabase-validation.yml");
  const sha256 = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  /** Id de blob de git (sha1 de «blob <tamaño>\0<contenido>»), sin depender del historial. */
  const gitBlob = (file: string) => {
    const content = readFileSync(file);
    return createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]))
      .digest("hex");
  };
  const pinned = [
    ...script.matchAll(/^ {2}"([0-9]{14}_[a-z0-9_]+\.sql) ([0-9a-f]{64})"$/gm),
  ].map(([, file, hash]) => ({ file, hash }));
  const pinnedFile = (name: string) =>
    script.match(
      new RegExp(`^[A-Z0-9_]+="(tests/supabase/${name}) ([0-9a-f]{64})"$`, "m")
    );
  const job = (name: string) => {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    const next = workflow.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
    return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  it("fija exactamente las 3 primeras migraciones posteriores a la Fase 3, con su SHA-256 real", () => {
    const after = readdirSync("supabase/migrations")
      .filter((f) => f > "20261007120000_compatibility_responses_hardening.sql")
      .sort()
      .slice(0, 3);
    expect(pinned.map((p) => p.file)).toEqual(after);
    expect(pinned.map((p) => p.file)).toEqual([
      "20261013120000_rooms_deleted_account_writes.sql",
      "20261015120000_rooms_integrity_publication.sql",
      "20261016120000_barcelona_neighborhoods.sql",
    ]);
    for (const { file, hash } of pinned) {
      expect(sha256(`supabase/migrations/${file}`), file).toBe(hash);
    }
  });

  it("el preflight congelado es el del run 19 (blob 7155e796…) y los dos archivos de estado de partida llevan su SHA-256 real", () => {
    const frozen = "tests/supabase/phase3-baseline-preflight.sql";
    expect(gitBlob(frozen)).toBe("7155e79601220f896530d8f35fe314ee91ff203d");
    for (const name of ["phase3-baseline-preflight.sql", "phase4-upgrade-baseline.sql"]) {
      const [, file, hash] = pinnedFile(name) ?? [];
      expect(file, name).toBe(`tests/supabase/${name}`);
      expect(sha256(file), name).toBe(hash);
    }
  });

  it("dry_run termina siempre en ROLLBACK; apply ensaya antes y exige la confirmación exacta", () => {
    expect(script).toMatch(/^run_pass rollback \|\| status=\$\?$/m);
    expect(script.indexOf("run_pass rollback")).toBeLessThan(
      script.indexOf("run_pass commit")
    );
    const phrase = script.match(/^PHASE4_APPLY_PHRASE="([a-z0-9-]+)"$/m)?.[1];
    expect(phrase).toBe("aplicar-fase4-en-roomly-validation-3");
    expect(workflow).toContain(`escribe ${phrase}`);
  });

  it("no usa la CLI de Supabase, ni Netlify o Vercel, ni variables públicas", () => {
    const code = script.replace(/^\s*#.*$/gm, "");
    expect(code).not.toMatch(/supabase (db|link)|netlify|vercel|NEXT_PUBLIC_/i);
  });

  it("workflow: entrada phase4_upgrade (none, dry_run, apply; por defecto none) y confirmación aparte", () => {
    const inputs = workflow.slice(
      workflow.indexOf("    inputs:"),
      workflow.indexOf("\npermissions:")
    );
    expect(inputs).toMatch(
      /phase4_upgrade:\n[\s\S]*?type: choice\n {8}options:\n {10}- none\n {10}- dry_run\n {10}- apply\n {8}default: none\n/
    );
    expect(inputs).toMatch(
      /confirm_phase4_upgrade:\n[\s\S]*?required: false\n {8}type: string\n {8}default: ""\n/
    );
  });

  it("workflow: la guarda valida las entradas antes de leer secrets, y el job solo recibe la conexión de BD", () => {
    const guard = job("guard");
    expect(guard.indexOf("phase4-upgrade.sh --check-inputs")).toBeGreaterThan(-1);
    expect(guard.indexOf("phase4-upgrade.sh --check-inputs")).toBeLessThan(
      guard.indexOf("secrets.")
    );
    const upgrade = job("phase4-upgrade");
    expect(upgrade).toContain("needs: guard");
    expect(upgrade).toContain(`environment: ${MARKER}`);
    expect([...upgrade.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort()).toEqual([
      "SUPABASE_VALIDATION_DB_URL",
      "SUPABASE_VALIDATION_PROJECT_REF",
    ]);
    expect(upgrade).toContain(
      'run: bash tests/supabase/phase4-upgrade.sh "$PHASE4_UPGRADE"'
    );
  });

  it("workflow: dry_run no ejecuta suites, y ni migrate ni el E2 se combinan con la actualización", () => {
    expect(job("preflight")).toContain("inputs.phase4_upgrade != 'dry_run'");
    expect(job("preflight")).toContain(
      "needs.phase4-upgrade.result == 'success' || needs.phase4-upgrade.result == 'skipped'"
    );
    for (const name of ["migrate", "e2e-real"]) {
      expect(job(name), name).toContain(
        "inputs.phase4_upgrade != 'dry_run' && inputs.phase4_upgrade != 'apply'"
      );
    }
  });

  it("su selftest corre en test:infra y en la CI", () => {
    const infra = JSON.parse(read("package.json")).scripts["test:infra"] as string;
    expect(infra).toContain("bash tests/supabase/phase4-upgrade-selftest.sh");
    expect(read(".github/workflows/ci.yml")).toContain(
      "- run: bash tests/supabase/phase4-upgrade-selftest.sh"
    );
  });
});

describe("E1 (local, simulado) y E2 (real, manual) separados", () => {
  const e1 = read("playwright.config.ts");
  const e2 = code("playwright.real.config.ts");
  // D1 busca la clave service_role ficticia y el nombre de su variable en el
  // build de E1, así que es el único spec que los contiene. Queda fuera de la
  // regla general y tiene la suya, más estricta (más abajo).
  const D1_SPEC = "tests/e2e/local/no-service-key-in-client.spec.ts";

  it("directorios distintos y npm run test:e2e = solo E1", () => {
    expect(e1).toContain('testDir: "./tests/e2e/local"');
    expect(e2).toContain('testDir: "./tests/e2e/real"');
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:e2e"]).toBe("playwright test");
    expect(pkg.scripts["test:e2e:real"]).toBe(
      "playwright test -c playwright.real.config.ts"
    );
  });

  it("E1: la app solo recibe la URL del mock y las claves ficticias (anon y, desde la Fase 3, service_role); nunca reutiliza un servidor", () => {
    const env = e1.match(/env: \{([\s\S]*?)\}/)?.[1] ?? "";
    expect([...env.matchAll(/([A-Z_]+):/g)].map((m) => m[1]).sort()).toEqual([
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
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
    const local = readdirSync("tests/e2e/local").map((f) => `tests/e2e/local/${f}`);
    // La excepción es solo para D1, y D1 tiene que seguir en E1.
    expect(local).toContain(D1_SPEC);
    const files = [
      "playwright.real.config.ts",
      ...local.filter((f) => f !== D1_SPEC),
      "tests/e2e/real/student-real.spec.ts",
      "tests/e2e/real/e2e-real-lib.mjs",
    ];
    for (const file of files)
      expect(code(file), file).not.toMatch(/SERVICE_ROLE_KEY|serviceKey|auth\.admin/);
  });

  it("D1, la única excepción: solo lee el build en disco y busca la clave ficticia y el nombre de su variable; no los usa, no hace peticiones ni abre un navegador", () => {
    const spec = code(D1_SPEC);
    // Lo único de service_role: importar la clave ficticia, usarla como aguja y
    // el nombre de la variable como aguja. Nunca la clave escrita en el spec.
    expect([...spec.matchAll(/\w*service[-_]?role\w*/gi)].map((m) => m[0])).toEqual([
      "MOCK_SERVICE_ROLE_KEY",
      "MOCK_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "MOCK_SERVICE_ROLE_KEY",
    ]);
    // Importaciones fijas: fs solo de lectura, path, Playwright y, de
    // mock-config.mjs, solo la clave ficticia (ni la URL del mock ni nada más).
    expect([...spec.matchAll(/^import .*$/gm)].map((m) => m[0])).toEqual([
      'import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";',
      'import path from "node:path";',
      'import { expect, test } from "@playwright/test";',
      'import { MOCK_SERVICE_ROLE_KEY } from "../support/mock-config.mjs";',
    ]);
    expect(spec.match(/\bimport\b/g)).toHaveLength(4);
    for (const forbidden of [
      // Credenciales y entorno.
      /\bprocess\b/,
      /auth\.admin|serviceKey|@supabase|createClient/,
      /apikey|authorization|bearer/i,
      // Red.
      /\bfetch\b|https?:|XMLHttpRequest|WebSocket|EventSource/,
      /\b(?:require|eval|Function|globalThis)\b/,
      // Navegador y fixtures de Playwright.
      /\b(?:page|browser|context|request)\b|\.goto\(|newPage|newContext/,
      // Escritura y salida.
      /\b(?:writeFile|appendFile|rmSync|unlink|rename|mkdir|copyFile|cpSync|truncate|symlink|chmod)/,
      /console\./,
    ]) {
      expect(spec, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("E1 (playwright.config.ts) solo pasa a la app la clave service_role FICTICIA del mock", () => {
    // Fase 3: la app usa service_role en el servidor (candidatos y escritura
    // del test). En E1 es la clave ficticia de mock-config.mjs, que solo
    // acepta el mock; nunca una real ni una variable del entorno.
    const config = code("playwright.config.ts");
    const uses = [...config.matchAll(/\b[A-Z_]*SERVICE_ROLE_KEY\b(?:: [A-Z_]+)?/g)].map(
      (m) => m[0]
    );
    expect(uses.sort()).toEqual(
      ["MOCK_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY: MOCK_SERVICE_ROLE_KEY"].sort()
    );
    expect(config).not.toMatch(
      /process\.env\.[A-Z_]*SERVICE|SUPABASE_VALIDATION_SERVICE_ROLE_KEY|auth\.admin/
    );
    expect(read("tests/e2e/support/mock-config.mjs")).toMatch(
      /export const MOCK_SERVICE_ROLE_KEY = "e1-mock-service-role-key-no-es-un-secreto";/
    );
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
    expect(workflow).toMatch(
      /preflight:[\s\S]*?needs: \[guard, migrate, phase4-upgrade\]/
    );
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
