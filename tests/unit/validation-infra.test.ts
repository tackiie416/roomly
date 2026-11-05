import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ROOM_FEATURE_KEYS,
  ROOM_PUBLICATION_REQUIRED_FIELDS,
} from "@/lib/validation/rooms";
import {
  ROOM_IMAGE_MAX_COUNT,
  ROOM_IMAGE_STORED_TYPE,
  ROOM_IMAGES_BUCKET,
  ROOM_IMAGES_BUCKET_MAX_BYTES,
  roomImageStoragePath,
} from "@/lib/validation/room-images";

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

  it("42 políticas, las mismas (tabla, política) que dejan las migraciones", () => {
    const expected = preflightValues(
      /-- P3[\s\S]*?with expected\(tablename, policyname, cmd\) as \(values([\s\S]*?)\n  \),/
    );
    expect(derived.policies.size).toBe(42);
    expect([...expected].sort()).toEqual([...derived.policies].sort());
  });

  it("rooms, room_addresses y room_images: las políticas por comando de 20261013120000, sin las antiguas FOR ALL, room_images solo de lectura desde 20261024120000 (pública y propia separadas desde 20261031120100) y rooms sin rooms_delete_own desde 20261030120000", () => {
    const rooms = [...derived.policies].filter((p) =>
      /^room(s|_addresses|_images)\./.test(p)
    );
    expect(rooms.sort()).toEqual([
      "room_addresses.room_addresses_delete_own",
      "room_addresses.room_addresses_insert_own",
      "room_addresses.room_addresses_select_own",
      "room_addresses.room_addresses_update_own",
      "room_images.room_images_admin_select",
      "room_images.room_images_select_own",
      "room_images.room_images_select_public",
      "rooms.rooms_admin_all",
      "rooms.rooms_insert_own",
      "rooms.rooms_select_active_public",
      "rooms.rooms_select_own",
      "rooms.rooms_update_own",
    ]);
  });

  it("20261030120000: sin borrado directo de clientes y delete_own_room solo para service_role, SECURITY INVOKER", () => {
    const migration = read(
      "supabase/migrations/20261030120000_rooms_delete_server_only.sql"
    );
    const code = migration.replace(/--.*$/gm, "");
    expect(code).toContain(
      "revoke delete, truncate on public.rooms from public, anon, authenticated;"
    );
    expect(code).toContain('drop policy "rooms_delete_own" on public.rooms;');
    expect(code).toMatch(
      /create function public\.delete_own_room\(p_room_id uuid, p_user_id uuid\)\s+returns text\[\]\s+language plpgsql\s+set search_path = ''/
    );
    expect(code.toLowerCase()).not.toContain("security definer");
    expect(code).toContain(
      "revoke all on function public.delete_own_room(uuid, uuid)\n  from public, anon, authenticated;"
    );
    expect(code).toContain(
      "grant execute on function public.delete_own_room(uuid, uuid) to service_role;"
    );
    // Cuenta activa, propietaria, bloqueo y rutas canónicas, en este orden.
    const order = [
      "room_delete_invalid:",
      "room_delete_isolation:",
      "p.deleted_at is null",
      "for share;",
      "r.owner_id = p_user_id",
      "for update;",
      "room_delete_path_invalid:",
      "delete from public.rooms r",
    ].map((needle) => code.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Ninguna migración posterior vuelve a dar DELETE de rooms a un cliente.
    const later = readdirSync("supabase/migrations")
      .filter((name) => name > "20261030120000_rooms_delete_server_only.sql")
      .map((name) => read(`supabase/migrations/${name}`));
    for (const sql of later) {
      expect(sql).not.toMatch(
        /grant[^;]*\b(delete|truncate|all)\b[^;]*on (table )?public\.rooms/i
      );
    }
    // El preflight vigente lo comprueba (P1, P4 y P6).
    const preflight = read("tests/supabase/preflight.sql");
    expect(preflight).toContain("to_regprocedure('public.delete_own_room(uuid, uuid)')");
    expect(preflight).toContain(
      "authenticated puede borrar rooms directamente (DELETE o TRUNCATE)"
    );
    expect(preflight).toContain(
      "('delete_own_room(uuid,uuid)', false, 'search_path=\"\"')"
    );
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

  it("15 triggers, los mismos que crean las migraciones", () => {
    const expected = preflightValues(
      /-- P6[\s\S]*?with expected\(tablename, tgname, fn\) as \(values([\s\S]*?)\n  \),/
    );
    expect(derived.triggers.size).toBe(15);
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

describe("Fase 4.2: fotos, R7 y Storage coherentes entre código, migración y preflight", () => {
  const MIGRATION =
    "supabase/migrations/20261024120000_room_images_storage_visibility.sql";
  const migration = read(MIGRATION).replace(/--.*$/gm, "");
  const preflight = read("tests/supabase/preflight.sql");
  const p1 = preflight.match(/-- P1[\s\S]*?-- P2/)?.[0] ?? "";

  it("el límite de fotos del trigger y de la comprobación previa es ROOM_IMAGE_MAX_COUNT", () => {
    expect(ROOM_IMAGE_MAX_COUNT).toBe(8);
    expect(migration).toContain(`if n_images >= ${ROOM_IMAGE_MAX_COUNT} then`);
    expect(migration).toContain(`having count(*) > ${ROOM_IMAGE_MAX_COUNT}`);
    expect(migration).toMatch(/for no key update;/);
  });

  it("el bucket (nombre, 5 MiB, image/webp) es el mismo en el código, la migración y P1", () => {
    const insert =
      migration.match(
        /insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/
      )?.[0] ?? "";
    expect(insert).toContain(
      `('${ROOM_IMAGES_BUCKET}', '${ROOM_IMAGES_BUCKET}', true, ${ROOM_IMAGES_BUCKET_MAX_BYTES}, array['${ROOM_IMAGE_STORED_TYPE}'])`
    );
    expect(p1).toContain(
      `b.id = '${ROOM_IMAGES_BUCKET}' and b.name = '${ROOM_IMAGES_BUCKET}'`
    );
    expect(p1).toContain(`b.file_size_limit = ${ROOM_IMAGES_BUCKET_MAX_BYTES}`);
    expect(p1).toContain(
      `b.allowed_mime_types = array['${ROOM_IMAGE_STORED_TYPE}']::text[]`
    );
  });

  it("la ruta del código es la que exige chk_room_images_storage_path", () => {
    expect(migration).toMatch(
      /add constraint chk_room_images_storage_path\s+check \(storage_path = room_id::text \|\| '\/' \|\| id::text \|\| '\.webp'\);/
    );
    expect(roomImageStoragePath("r", "i")).toBe("r/i.webp");
  });

  it("P1 exige exactamente las restricciones que añade la migración a room_images", () => {
    const added = [
      ...migration.matchAll(
        /alter table public\.room_images\s+add constraint ([a-z_]+)/g
      ),
    ]
      .map(([, name]) => name)
      .sort();
    const required = [...p1.matchAll(/\('(chk_room_images_[a-z_]+)',/g)]
      .map(([, name]) => name)
      .sort();
    expect(added).toEqual(["chk_room_images_position", "chk_room_images_storage_path"]);
    expect(required).toEqual(added);
  });

  it("ninguna política de la migración toca storage.objects, y room_images no tiene escritura de clientes", () => {
    expect(migration).not.toMatch(/create policy[^;]*on storage\./i);
    expect(migration).toMatch(
      /revoke insert, update, delete, truncate, references, trigger\s+on public\.room_images from anon, authenticated;/
    );
    expect(migration).not.toMatch(/grant [^;]*on public\.room_images/i);
  });
});

describe("Fase 4.2, D1: bucket privado (20261025120000) aditivo, idempotente y con L6_N2", () => {
  const MIGRATION = "supabase/migrations/20261025120000_room_images_private_bucket.sql";
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  const preflight = read("tests/supabase/preflight.sql");
  const p1 = preflight.match(/-- P1[\s\S]*?-- P2/)?.[0] ?? "";
  const p3 = preflight.match(/-- P3[\s\S]*?-- P4/)?.[0] ?? "";

  it("es aditiva: no crea ni borra tablas, políticas, triggers ni funciones, ni toca la 20261024120000", () => {
    expect(sql).not.toMatch(/\b(create|drop|alter)\s+(table|policy|trigger|function)\b/i);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    // Solo un UPDATE, del bucket, y solo si todavía es público.
    expect([...sql.matchAll(/\bupdate\s+([a-z_.]+)/gi)].map(([, t]) => t)).toEqual([
      "storage.buckets",
    ]);
    expect(sql).toMatch(
      /update storage\.buckets\s+set public = false, updated_at = now\(\)\s+where id = 'room-images' and public;/
    );
  });

  it("comprueba el bucket con los mismos valores que el código y P1", () => {
    expect(sql).toContain(
      `bucket.file_size_limit is not distinct from ${ROOM_IMAGES_BUCKET_MAX_BYTES}`
    );
    expect(sql).toContain(
      `bucket.allowed_mime_types is not distinct from array['${ROOM_IMAGE_STORED_TYPE}']::text[]`
    );
    expect(sql).toContain(`where b.id = '${ROOM_IMAGES_BUCKET}'`);
    expect(p1).toContain("b.public is false");
  });

  it("L6_N2: RLS de las dos tablas, ninguna política en objects ni de escritura en buckets, y «no se puede comprobar»", () => {
    for (const table of ["objects", "buckets"]) {
      expect(sql, table).toMatch(
        new RegExp(
          `if not coalesce\\(\\(select c\\.relrowsecurity from pg_catalog\\.pg_class c\\s+where c\\.oid = 'storage\\.${table}'::regclass\\), false\\) then`
        )
      );
      expect(p3, table).toContain(`FALLO P3: storage.${table} no tiene la RLS activa`);
    }
    expect(sql).toMatch(/where p\.schemaname = 'storage' and p\.tablename = 'objects';/);
    expect(sql).toMatch(
      /where p\.schemaname = 'storage' and p\.tablename = 'buckets' and p\.cmd <> 'SELECT';/
    );
    expect(sql).toContain("no se puede comprobar %s: tiene la RLS activa");
    expect(sql).toContain("exception when insufficient_privilege then");
    expect(p1).toContain("FALLO P1: no se puede comprobar %");
    // Todos los rechazos llevan el mismo código y un prefijo estable.
    const raises = [
      ...sql.matchAll(
        /raise exception using\s+errcode = '(\d{5})',\s+message = (?:format\()?\s*'([a-z_]+):/g
      ),
    ];
    expect(raises.length).toBeGreaterThanOrEqual(11);
    expect(new Set(raises.map(([, code]) => code))).toEqual(new Set(["55000"]));
    expect(new Set(raises.map(([, , prefix]) => prefix))).toEqual(
      new Set(["room_images_private_precheck", "room_images_private_postcheck"])
    );
  });
});

// Ajuste aprobado por el propietario (integración del hotfix con la cadena de
// la Fase 4): 20261014120000_public_profile_previews_write_lockdown.sql es un
// hotfix de seguridad anterior a la cadena, no una de las tres migraciones
// funcionales que fija R8. R8 no lo aplica (se aplica aparte, según
// docs/INCIDENT_PUBLIC_PROFILE_PREVIEWS.md). Se excluye SOLO por su nombre
// exacto: cualquier otra migración, o el hotfix con otro nombre, vuelve a
// contar y hace fallar la comprobación. Los pins y huellas de R8 no cambian.
const R8_PHASE3_LAST = "20261007120000_compatibility_responses_hardening.sql";
const R8_EXCLUDED_HOTFIX = "20261014120000_public_profile_previews_write_lockdown.sql";
const R8_EXCLUDED_HOTFIX_SHA256 =
  "eb53f35011ad63603129cf191536683a6015b40da79037545f47e8c224efdbb8";
const R8_FUNCTIONAL = [
  "20261013120000_rooms_deleted_account_writes.sql",
  "20261015120000_rooms_integrity_publication.sql",
  "20261016120000_barcelona_neighborhoods.sql",
];

/** Las 3 primeras migraciones posteriores a la Fase 3, sin el hotfix (solo por su nombre exacto). */
function r8FunctionalAfterPhase3(migrations: string[]): string[] {
  return migrations
    .filter((f) => f > R8_PHASE3_LAST)
    .filter((f) => f !== R8_EXCLUDED_HOTFIX)
    .sort()
    .slice(0, 3);
}

/** Problemas de orden, presencia o huella de las migraciones de R8 (vacío si todo cuadra). */
function r8OrderProblems(
  migrations: string[],
  pinned: Array<{ file: string; hash: string }>,
  hashOf: (file: string) => string
): string[] {
  const problems: string[] = [];
  const after = migrations.filter((f) => f > R8_PHASE3_LAST).sort();
  const functional = r8FunctionalAfterPhase3(migrations);
  const pinnedFiles = pinned.map((p) => p.file);
  if (JSON.stringify(pinnedFiles) !== JSON.stringify(functional)) {
    problems.push(
      `las 3 primeras migraciones funcionales posteriores a la Fase 3 son ${functional.join(", ")}; R8 fija ${pinnedFiles.join(", ")}`
    );
  }
  if (JSON.stringify(pinnedFiles) !== JSON.stringify(R8_FUNCTIONAL)) {
    problems.push(`R8 debe fijar exactamente ${R8_FUNCTIONAL.join(", ")}`);
  }
  const at = after.indexOf(R8_EXCLUDED_HOTFIX);
  if (at === -1) {
    problems.push(`falta el hotfix ${R8_EXCLUDED_HOTFIX}`);
  } else if (after[at - 1] !== R8_FUNCTIONAL[0] || after[at + 1] !== R8_FUNCTIONAL[1]) {
    problems.push("el hotfix no está justo entre 20261013120000 y 20261015120000");
  }
  for (const { file, hash } of pinned) {
    if (!migrations.includes(file) || hashOf(file) !== hash)
      problems.push(`huella distinta: ${file}`);
  }
  return problems;
}

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
  /** Cuerpo de una función de bash del script, hasta su `}` de cierre. */
  const fn = (name: string) => {
    const start = script.indexOf(`\n${name}() {\n`);
    expect(start, name).toBeGreaterThan(-1);
    return script.slice(start, script.indexOf("\n}\n", start));
  };
  const job = (name: string) => {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    const next = workflow.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
    return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  it("fija exactamente las 3 primeras migraciones funcionales posteriores a la Fase 3, con su SHA-256 real", () => {
    const migrations = readdirSync("supabase/migrations");
    expect(
      r8OrderProblems(migrations, pinned, (file) => sha256(`supabase/migrations/${file}`))
    ).toEqual([]);
    expect(pinned.map((p) => p.file)).toEqual(R8_FUNCTIONAL);
    for (const { file, hash } of pinned) {
      expect(sha256(`supabase/migrations/${file}`), file).toBe(hash);
    }
  });

  it("el hotfix 20261014120000 sigue en la instalación, intacto, y R8 no lo aplica ni lo fija", () => {
    expect(readdirSync("supabase/migrations")).toContain(R8_EXCLUDED_HOTFIX);
    expect(sha256(`supabase/migrations/${R8_EXCLUDED_HOTFIX}`)).toBe(
      R8_EXCLUDED_HOTFIX_SHA256
    );
    expect(script).not.toContain("20261014120000");
    expect(pinned.map((p) => p.file)).not.toContain(R8_EXCLUDED_HOTFIX);
  });

  describe("comprobación de orden de R8 con el hotfix excluido por su nombre exacto", () => {
    const real = readdirSync("supabase/migrations");
    const hashOf = (file: string) => sha256(`supabase/migrations/${file}`);
    const without = (name: string) => real.filter((f) => f !== name);

    it("1. el hotfix no cuenta entre las tres migraciones funcionales", () => {
      const after = real.filter((f) => f > R8_PHASE3_LAST).sort();
      expect(after.slice(0, 3)).toContain(R8_EXCLUDED_HOTFIX);
      expect(r8FunctionalAfterPhase3(real)).toEqual(R8_FUNCTIONAL);
    });

    it("2. las tres migraciones originales se reconocen exactamente, en su orden", () => {
      expect(r8OrderProblems(real, pinned, hashOf)).toEqual([]);
      expect(r8FunctionalAfterPhase3(real)).toEqual([
        "20261013120000_rooms_deleted_account_writes.sql",
        "20261015120000_rooms_integrity_publication.sql",
        "20261016120000_barcelona_neighborhoods.sql",
      ]);
    });

    it("3. si el hotfix cambia de nombre, la comprobación falla", () => {
      for (const renamed of [
        "20261014120000_public_profile_previews_write_lockdown_v2.sql",
        "20261014120001_public_profile_previews_write_lockdown.sql",
        "20261014120000_public_profile_previews.sql",
      ]) {
        const problems = r8OrderProblems(
          [...without(R8_EXCLUDED_HOTFIX), renamed],
          pinned,
          hashOf
        );
        expect(problems, renamed).toContain(`falta el hotfix ${R8_EXCLUDED_HOTFIX}`);
        expect(
          problems.some((p) => p.startsWith("las 3 primeras")),
          renamed
        ).toBe(true);
      }
      expect(r8OrderProblems(without(R8_EXCLUDED_HOTFIX), pinned, hashOf)).toContain(
        `falta el hotfix ${R8_EXCLUDED_HOTFIX}`
      );
    });

    it("4. una segunda migración inesperada entre las de R8 hace fallar la comprobación", () => {
      for (const extra of [
        "20261013130000_otra.sql",
        "20261014120001_public_profile_previews_write_lockdown.sql",
        "20261015130000_otra.sql",
      ]) {
        expect(
          r8OrderProblems([...real, extra], pinned, hashOf).some((p) =>
            p.startsWith("las 3 primeras")
          ),
          extra
        ).toBe(true);
      }
    });

    it("5. alterar cualquiera de los tres pins (nombre o huella) sigue fallando", () => {
      pinned.forEach((pin, i) => {
        const otherHash = pinned.map((p, j) =>
          j === i ? { ...p, hash: "0".repeat(64) } : p
        );
        expect(r8OrderProblems(real, otherHash, hashOf), pin.file).toContain(
          `huella distinta: ${pin.file}`
        );
        const otherFile = pinned.map((p, j) =>
          j === i ? { ...p, file: R8_EXCLUDED_HOTFIX } : p
        );
        expect(r8OrderProblems(real, otherFile, hashOf).length, pin.file).toBeGreaterThan(
          0
        );
      });
      expect(r8OrderProblems(real, pinned.slice(0, 2), hashOf).length).toBeGreaterThan(0);
    });
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

  it("el preflight de llegada es la copia congelada de la 4.1 (blob 7f28f5d9…), fijada con su SHA-256 real, aparte del de la Fase 3, y se comprueba antes de conectar", () => {
    const frozen = "tests/supabase/phase4-final-preflight.sql";
    const [, file, hash] = pinnedFile("phase4-final-preflight.sql") ?? [];
    expect(file).toBe(frozen);
    // Literales: la copia es la del run 21 y no cambia aunque cambie el pin.
    expect(hash).toBe("38ef7a3b011e72519eb4cc695408677c18f6743c547b6440e562565e9ef840ec");
    expect(sha256(frozen)).toBe(hash);
    expect(gitBlob(frozen)).toBe("7f28f5d90cfd8b9f55d12c85db0a6bf3a1a9a4ec");
    expect(script).toMatch(
      /^PHASE4_FINAL_PREFLIGHT="tests\/supabase\/phase4-final-preflight\.sql [0-9a-f]{64}"$/m
    );
    const [, , baselineHash] = pinnedFile("phase3-baseline-preflight.sql") ?? [];
    expect(baselineHash).not.toBe(hash);
    expect(script).toContain(
      'pinned=("$PHASE3_BASELINE" "$PHASE4_BASELINE_CHECKS" "$PHASE4_FINAL_PREFLIGHT")'
    );
    expect(script.indexOf('check_pinned "${pinned[@]}"')).toBeLessThan(
      script.indexOf('source "$ROOT/tests/supabase/guard.sh"')
    );
    // El flujo lee la copia verificada del archivo fijado, nunca el
    // repositorio directamente ni una ruta aparte.
    expect(script).toContain('body_parts+=("$(src_of "$PHASE4_FINAL_PREFLIGHT")")');
    expect(script).not.toMatch(/cat "\$ROOT\//);
    expect(script).not.toContain('cat "$ROOT/tests/supabase/preflight.sql"');
  });

  it("R8 no lee el preflight vigente: ni pin, ni ruta en el código, ni run-preflight.sh", () => {
    // Desde la 4.2, tests/supabase/preflight.sql describe la 4.2: si R8 lo
    // leyera, fallaría en P1 aunque la actualización fuera correcta.
    expect(pinnedFile("preflight.sql")).toBeNull();
    const code = script
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(code).not.toContain("tests/supabase/preflight.sql");
    expect(code).not.toContain("run-preflight.sh");
    expect(code).not.toMatch(/[\s"/]preflight\.sql\b/);
    expect(
      [...code.matchAll(/^[A-Z0-9_]+="tests\/supabase\/([^ "]+) [0-9a-f]{64}"$/gm)]
        .map((m) => m[1])
        .sort()
    ).toEqual([
      "phase3-baseline-preflight.sql",
      "phase4-final-preflight.sql",
      "phase4-upgrade-baseline.sql",
    ]);
    // El selftest lo comprueba en ejecución: el vigente cambiado sin tocar el
    // script, sin él, y sin la copia congelada.
    const selftest = read("tests/supabase/phase4-upgrade-selftest.sh");
    for (const id of ["g18.log", "g19.log", "g20.log"]) {
      expect(selftest, id).toContain(id);
    }
    expect(selftest).toContain("outcome dry_run_correcto b.log g18.log");
    expect(selftest).toMatch(/outcome no_ejecutada [^"]* g19\.log"/);
  });

  it("WARNING: client_min_messages = notice dentro de la transacción, R8-MSG al empezar y al final, y avisos de éxito obligatorios", () => {
    const begin = script.indexOf('echo "begin;"');
    const cmm = script.indexOf('echo "set local client_min_messages = notice;"');
    expect(begin).toBeGreaterThan(-1);
    expect(cmm).toBeGreaterThan(begin);
    expect(cmm).toBeLessThan(script.indexOf('msg_check "al empezar"'));
    // Cabecera (con R8-MSG al empezar), cuerpo común y final, en ese orden.
    expect(fn("pass_head").indexOf('echo "begin;"')).toBeLessThan(
      fn("pass_head").indexOf('msg_check "al empezar"')
    );
    expect(fn("build_pass")).toContain('concat_verified "$pass" "$head" "$BODY" "$foot"');
    // En el cuerpo, el preflight congelado va primero y el de llegada, el último.
    const bodyOrder = [
      'body_parts+=("$(src_of "$PHASE3_BASELINE")")',
      'body_parts+=("$(src_of "$PHASE4_BASELINE_CHECKS")")',
      'body_parts+=("$SRC/${entry% *}")',
      'body_parts+=("$(src_of "$PHASE4_FINAL_PREFLIGHT")")',
      'concat_verified "$BODY" "${body_parts[@]}"',
    ].map((s) => script.indexOf(s));
    expect(bodyOrder[0]).toBeGreaterThan(-1);
    expect(bodyOrder).toEqual([...bodyOrder].sort((a, b) => a - b));
    expect(fn("pass_foot").indexOf('msg_check "antes de ${ending}"')).toBeLessThan(
      fn("pass_foot").indexOf('echo "${ending};"')
    );
    expect(script.indexOf('msg_check "antes de ${ending}"')).toBeLessThan(
      script.indexOf('echo "${ending};"')
    );
    expect(script).toContain(
      'EXPECTED_NOTICES=("ok - R8-MSG:" "ok - P6:" "ok - R8-BASE:" "ok - P6:" "ok - R8-MSG:")'
    );
    // Ningún archivo del flujo cambia client_min_messages: ocultaría WARNING.
    const streamFiles = [
      "tests/supabase/phase3-baseline-preflight.sql",
      "tests/supabase/phase4-upgrade-baseline.sql",
      "tests/supabase/phase4-final-preflight.sql",
      ...pinned.map((p) => `supabase/migrations/${p.file}`),
    ];
    for (const file of streamFiles) {
      expect(read(file), file).not.toMatch(/client_min_messages/i);
    }
  });

  it("un fallo en la pasada con COMMIT no afirma que no se aplicó nada: pide el preflight de llegada antes de repetir", () => {
    const afterCommit = script.slice(script.indexOf("run_pass commit"));
    expect(afterCommit).toContain("apply NO CONFIRMADO");
    expect(afterCommit).toContain("incierto");
    expect(afterCommit).toContain("tests/supabase/phase4-final-preflight.sql");
    expect(afterCommit).not.toContain("run-preflight.sh");
    expect(afterCommit).not.toMatch(/nada aplicado|se ha revertido/);
    const runPass = script.slice(
      script.indexOf("run_pass() {"),
      script.indexOf("\n}\n", script.indexOf("run_pass() {"))
    );
    expect(runPass).not.toMatch(/nada aplicado|se ha revertido|no se ha aplicado/);
  });

  it("B1: el flujo se construye entero antes de conectar, desde copias verificadas, y psql lo lee de un archivo", () => {
    const guardAt = script.indexOf('source "$ROOT/tests/supabase/guard.sh"');
    for (const step of [
      'source "$ROOT/tests/supabase/sql-suite-lib.sh"',
      'stage_pinned "$entry"',
      'concat_verified "$BODY" "${body_parts[@]}"',
      "build_pass rollback",
      "build_pass commit",
    ]) {
      expect(script.indexOf(step), step).toBeGreaterThan(-1);
      expect(script.indexOf(step), step).toBeLessThan(guardAt);
    }
    const stage = fn("stage_pinned");
    expect(stage).toContain('cp "$ROOT/$path" "$copy"');
    expect(stage).toContain('[ "$(sha256sum "$copy" | cut -c1-64)" = "$expected" ]');
    expect(stage).toContain('roomly_sql_transform "$copy"');
    expect(stage).toContain('grep -q "roomly_file"');
    const concat = fn("concat_verified");
    expect(concat).toContain(
      'cmp -s <(tail -c "+$((offset + 1))" "$out" | head -c "$size") "$part"'
    );
    expect(concat).toContain('[ "$(stat -c %s "$out")" -eq "$offset" ]');
    // Un solo ROLLBACK o COMMIT por pasada, el penúltimo, y después su línea.
    expect(fn("build_pass")).toContain("(commit|rollback)[[:space:]]*;");
    expect(fn("pass_foot")).toContain('section "${ending} hecho"');
    // psql lee el archivo de la pasada; nada se canaliza hacia psql.
    expect(fn("run_pass")).toContain('<"$WORK/pass-${ending}.sql"');
    expect(script).not.toMatch(/\|\s*psql\b/);
  });

  it("B2: el COMMIT solo cuenta si psql llega a la última línea del flujo; NO VÁLIDO exige esa línea", () => {
    const runPass = fn("run_pass");
    const marker = runPass.indexOf('grep -qxF "== R8 · ${ending} hecho" "$out"');
    expect(marker).toBeGreaterThan(runPass.indexOf('if [ "$status" -ne 0 ]; then'));
    expect(marker).toBeLessThan(runPass.indexOf('if [ "$warn" -ne 0 ]; then'));
    expect(marker).toBeLessThan(runPass.indexOf('if [ "$seen" != "$expected" ]; then'));
    const afterCommit = script.slice(script.indexOf("run_pass commit || status=$?"));
    expect(afterCommit).toMatch(
      /"\$status" -eq 1 \]; then\n {2}echo "RESULTADO: apply NO CONFIRMADO/
    );
    expect(afterCommit).toMatch(
      /"\$status" -eq 2 \]; then\n {2}echo "RESULTADO: apply NO VÁLIDO: el COMMIT se ejecutó/
    );
  });

  it("L1: una línea ERROR del servidor con psql terminado en 0 da resultado incierto (1), no válido ni NO VÁLIDO", () => {
    const runPass = fn("run_pass");
    const errorCheck = runPass.indexOf(
      "if grep -qE '^(psql:<stdin>:[0-9]+: )?ERROR:  ' \"$out\"; then"
    );
    expect(errorCheck).toBeGreaterThan(runPass.indexOf('if [ "$status" -ne 0 ]; then'));
    expect(errorCheck).toBeLessThan(runPass.indexOf('if [ "$warn" -ne 0 ]; then'));
    expect(errorCheck).toBeLessThan(
      runPass.indexOf('if [ "$seen" != "$expected" ]; then')
    );
    // Su rama devuelve 1 (incierto con COMMIT), nunca 2 (NO VÁLIDO: COMMIT ejecutado).
    const branch = runPass.slice(errorCheck, runPass.indexOf("\n  fi\n", errorCheck));
    expect(branch).toMatch(/\n {4}return 1$/);
  });

  it("B3: una señal durante la pasada con COMMIT da un resultado incierto; antes, nada confirmado", () => {
    const guardAt = script.indexOf('source "$ROOT/tests/supabase/guard.sh"');
    for (const [sig, num] of [
      ["HUP", 1],
      ["INT", 2],
      ["TERM", 15],
    ]) {
      const trap = `trap 'on_signal ${sig} ${num}' ${sig}`;
      expect(script).toContain(trap);
      expect(script.indexOf(trap)).toBeLessThan(guardAt);
    }
    const [commitBranch, otherBranch] = fn("on_signal").split("\n  else\n");
    expect(commitBranch).toContain('if [ "$STAGE" = "la pasada con COMMIT" ]; then');
    expect(commitBranch).toContain("incierto");
    expect(commitBranch).not.toMatch(/nada confirmado|nada aplicado/);
    expect(otherBranch).toContain("nada confirmado");
    // La etapa pasa a «con COMMIT» entre las dos pasadas, y ya no cambia.
    const stageCommit = script.indexOf('STAGE="la pasada con COMMIT"');
    expect(stageCommit).toBeGreaterThan(script.indexOf("run_pass rollback || status=$?"));
    expect(stageCommit).toBeLessThan(script.indexOf("run_pass commit || status=$?"));
    expect(script.slice(stageCommit + 1)).not.toContain('STAGE="');
  });

  it("B4–B5: las secciones de docs/SUPABASE_VALIDATION.md que cita el script existen y separan los procedimientos", () => {
    const doc = read("docs/SUPABASE_VALIDATION.md");
    const cited = new Set(
      [
        ...script.matchAll(
          /«([^»]+)» en docs\/SUPABASE_VALIDATION\.md|docs\/SUPABASE_VALIDATION\.md, «([^»]+)»/g
        ),
      ].map((m) => m[1] ?? m[2])
    );
    expect([...cited].sort()).toEqual([
      "Copia congelada del preflight de la 4.1",
      "Recuperación",
    ]);
    for (const name of cited) {
      expect(doc, name).toMatch(new RegExp(`^#{3,4} ${name}$`, "m"));
    }
    const section = (name: string) => {
      const start = doc.indexOf(`#### ${name}\n`);
      const next = doc.slice(start + 1).search(/\n#{2,4} /);
      return doc.slice(start, next === -1 ? undefined : start + 1 + next);
    };
    const recovery = section("Recuperación");
    expect(recovery).toContain("phase4_upgrade=none");
    expect(recovery).toContain(
      "**Si el preflight pasa, siguen la suite SQL, la api-suite y AU3/AU5**"
    );
    expect(recovery).toContain("Que falte esa línea no demuestra que la transacción se");
    expect(recovery).toContain("**no se repite `apply`**");
    const pin = section("Copia congelada del preflight de la 4.1");
    for (const step of [
      "roomly_sql_transform",
      "PHASE3_BASELINE",
      "phase4-upgrade-selftest.sh",
      "una sola",
      "38ef7a3b011e72519eb4cc695408677c18f6743c547b6440e562565e9ef840ec",
      "7f28f5d90cfd8b9f55d12c85db0a6bf3a1a9a4ec",
      "Nunca R8",
      "Nunca se rebaja la comprobación",
    ]) {
      expect(pin, step).toContain(step);
    }
    expect(doc).not.toContain("#### Cambiar el SHA-256 del preflight vigente");
  });

  it("L5: los resultados inciertos y la recuperación remiten a la copia congelada, no al preflight vigente", () => {
    const results = script
      .split("\n")
      .filter((line) => line.includes('echo "RESULTADO:'));
    expect(results.length).toBeGreaterThan(0);
    for (const line of results) {
      expect(line).not.toContain("run-preflight.sh");
    }
    for (const kind of ["apply NO CONFIRMADO", "apply NO VÁLIDO"]) {
      const line = results.find((l) => l.includes(`RESULTADO: ${kind}`)) ?? "";
      expect(line, kind).toContain(
        "la copia congelada tests/supabase/phase4-final-preflight.sql"
      );
      expect(line, kind).toContain("«Recuperación» en docs/SUPABASE_VALIDATION.md");
    }
    expect(script).toContain(
      'add_line "$(section "preflight de llegada (copia congelada de la 4.1) sobre el resultado")"'
    );
    expect(script).not.toMatch(/section "preflight vigente/);
    const doc = read("docs/SUPABASE_VALIDATION.md");
    const start = doc.indexOf("#### Recuperación\n");
    const recovery = doc.slice(start, doc.indexOf("\n#### ", start + 1));
    expect(recovery).toContain(
      "4. **El preflight de llegada** (`tests/supabase/phase4-final-preflight.sql`"
    );
    expect(recovery).toContain("default_transaction_read_only=on");
    expect(recovery).toContain("-f tests/supabase/phase4-final-preflight.sql");
    expect(recovery).not.toContain(
      "**La validación normal** (`phase4_upgrade=none`), sabiendo"
    );
    expect(recovery).toContain("**no confirma** el estado de llegada de R8");
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

  it("workflow: el job phase4-upgrade tiene timeout-minutes: 20 a nivel de job", () => {
    const upgrade = job("phase4-upgrade");
    expect(upgrade).toMatch(/\n {4}timeout-minutes: 20\n/);
    expect([...upgrade.matchAll(/timeout-minutes:/g)]).toHaveLength(1);
    expect(upgrade.indexOf("timeout-minutes: 20")).toBeLessThan(
      upgrade.indexOf("    steps:")
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

describe("Fase 4.2 (D3): conciliación de las fotos, solo lectura", () => {
  const sql = read("tests/supabase/room-images-reconcile.sql").replace(/--.*$/gm, "");
  const tool = read("tests/supabase/room-images-reconcile.sh");
  const toolCode = tool
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  it("el SQL solo lee: ni escrituras, ni DDL, ni control de transacciones, ni funciones con efectos", () => {
    expect(sql).not.toMatch(
      /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|vacuum|reindex|cluster|lock|call|comment|refresh|security\s+label|import|listen|notify)\b/i
    );
    // Ni control de transacciones (el `begin` de un bloque DO no lo es) ni
    // cambios de sesión: la transacción la abre y la cierra el script.
    expect(sql).not.toMatch(
      /^\s*(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release)\s*;/im
    );
    expect(sql).not.toMatch(
      /\bset\s+(role|session|transaction|local)\b|set_config\s*\(/i
    );
    expect(sql).not.toMatch(
      /\b(nextval|setval|pg_terminate_backend|pg_cancel_backend|lo_\w+|dblink|pg_advisory\w*)\s*\(/i
    );
    expect(sql).not.toMatch(/^\s*\\/m);
    // Lee storage.objects y room_images, y nada de Storage fuera del bucket.
    expect(sql).toContain("where o.bucket_id = 'room-images'");
    expect(sql).toMatch(/RECONCILE NO VERIFICABLE/);
  });

  it("el script lo envuelve en una transacción READ ONLY que termina en ROLLBACK, con la sesión en solo lectura", () => {
    expect(toolCode).toContain(
      'echo "begin transaction isolation level repeatable read read only;"'
    );
    expect(toolCode).toContain('echo "rollback;"');
    expect(toolCode).not.toMatch(/\bcommit\b/i);
    expect(toolCode).toContain(
      'export PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on"'
    );
  });

  it("no hay ningún modo de aplicación, reparación ni borrado, ni usa la API de Storage", () => {
    expect(toolCode).not.toMatch(/--(apply|fix|repair|delete|remove|clean|purge)\b/i);
    expect(toolCode).not.toMatch(
      /\b(remove|createAdminClient|service_role|storage\.from|curl|SUPABASE_SERVICE_ROLE_KEY)\b/
    );
    const options = [...toolCode.matchAll(/^\s{4}(--[a-z-]+)\)/gm)].map((m) => m[1]);
    expect(options).toEqual(["--min-age-hours", "--as-of"]);
  });

  it("nunca imprime la URL de la base de datos ni los errores de conexión de psql", () => {
    expect(toolCode).not.toMatch(/echo[^\n]*DB_URL/);
    expect(toolCode).toContain('roomly_sql_filter_output "$WORK/error.log"');
    expect(toolCode).toContain('>"$WORK/report.tsv" 2>"$WORK/error.log"');
  });

  it("umbral de 24 h por defecto, configurable y validado antes de conectar", () => {
    expect(toolCode).toMatch(/^MIN_AGE_HOURS=24$/m);
    expect(toolCode).toMatch(/-lt 1 \] \|\| \[ "\$MIN_AGE_HOURS" -gt 8760 \]/);
    expect(sql).toContain("make_interval(hours => :min_age_hours)");
  });

  it("cada selftest de tests/supabase está en test:infra y en la CI", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const ci = read(".github/workflows/ci.yml");
    const selftests = readdirSync("tests/supabase").filter((f) =>
      f.endsWith("-selftest.sh")
    );
    expect(selftests).toContain("room-images-reconcile-selftest.sh");
    for (const file of selftests) {
      expect(pkg.scripts["test:infra"], file).toContain(`bash tests/supabase/${file}`);
      expect(ci, file).toContain(`- run: bash tests/supabase/${file}`);
    }
  });
});
