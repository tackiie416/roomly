import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getPublicRoom, searchPublicRooms } from "@/lib/services/room-search";
import type { RoomImagesDeps } from "@/lib/services/room-images";
import type { DbClient } from "@/lib/services/result";
import { ROOM_SEARCH_ORDERS, encodeRoomSearchCursor } from "@/lib/validation/room-search";
import { createFakeSupabase, type Call } from "./helpers/fake-supabase";

// Fase 4.4 (sesión 71) — comprobaciones sobre el código de la búsqueda
// pública:
//   - el GRANT de anon sobre `rooms` (20261031120100, leído de la migración)
//     es EXACTAMENTE el conjunto de columnas que el servicio lee, filtra u
//     ordena: ninguna columna concedida sobra y ninguna usada falta;
//   - ni el servicio ni las páginas nombran la dirección, la identidad de la
//     propietaria, el estado o el borrado lógico;
//   - las páginas leen con el cliente de un visitante (sin sesión) y no usan
//     ISR (sus URL firmadas caducan).

/** Código sin comentarios. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full.split(path.sep).join("/")] : [];
  });
}

const MIGRATION = "supabase/migrations/20261031120100_public_read_minimum.sql";
const SERVICE = "lib/services/room-search.ts";
const VALIDATION = "lib/validation/room-search.ts";
const PUBLIC_CLIENT = "lib/supabase/public.ts";
const PAGES_DIR = "app/(marketing)/[city]/habitaciones";
const SEARCH_PAGE = `${PAGES_DIR}/page.tsx`;
const DETAIL_PAGE = `${PAGES_DIR}/[id]/page.tsx`;
const PUBLIC_COMPONENTS = sourceFiles("components/rooms").filter((file) =>
  /\/public-/.test(file)
);
const PUBLIC_FILES = [
  SERVICE,
  VALIDATION,
  PUBLIC_CLIENT,
  ...sourceFiles(PAGES_DIR),
  ...PUBLIC_COMPONENTS,
];

/** Columnas del `grant select (...) on public.rooms to anon` de la migración. */
function anonGrant(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = /grant select \(([^)]*)\) on public\.rooms to anon;/i.exec(sql);
  if (!match) throw new Error("No se encuentra el GRANT de anon en la migración");
  return match[1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .sort();
}

/** Columnas que toca una consulta: seleccionadas, filtradas (también dentro de `or`) y ordenadas. */
function touchedColumns(call: Call): string[] {
  const columns = String(call.columns ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  for (const filter of call.filters) {
    if (filter.kind === "or") {
      for (const match of String(filter.value).matchAll(
        /([a-z_]+)\.(?:is|eq|lt|lte|gt|gte)\./g
      ))
        columns.push(match[1]);
    } else {
      columns.push(filter.column);
    }
  }
  for (const order of call.order ?? []) columns.push(order.replace(/\.desc$/, ""));
  return columns;
}

const ID = "00000001-0000-4000-8000-000000000000";
const signerDeps: RoomImagesDeps = {
  adminClient: () =>
    ({
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => ({
            data: paths.map((p) => ({
              path: p,
              signedUrl: `https://s/${p}`,
              error: null,
            })),
            error: null,
          }),
        }),
      },
    }) as unknown as DbClient,
  sanitize: async () => {
    throw new Error("no");
  },
  newId: () => ID,
  now: () => new Date("2026-10-31T10:00:00Z"),
  signedUrlTtlSeconds: 600,
  reportRecovery: () => undefined,
};

/** Todas las consultas a `rooms` del servicio, con todos los filtros, órdenes y cursores, y el detalle. */
async function allRoomsCalls(): Promise<Call[]> {
  const fake = createFakeSupabase({
    userId: null,
    respond: (call) => {
      if (call.table === "cities")
        return {
          data: {
            id: "c0000000-0000-4000-8000-000000000001",
            name: "Barcelona",
            slug: "barcelona",
          },
          error: null,
        };
      if (call.table === "neighborhoods")
        return call.terminal === "maybeSingle"
          ? { data: { name: "Gràcia" }, error: null }
          : {
              data: [
                {
                  id: "a0000000-0000-4000-8000-000000000001",
                  name: "Gràcia",
                  slug: "gracia",
                },
              ],
              error: null,
            };
      if (call.table === "rooms" && call.terminal === "maybeSingle")
        return {
          data: {
            id: ID,
            neighborhood_id: "a0000000-0000-4000-8000-000000000001",
            features: [],
          },
          error: null,
        };
      return { data: [], error: null };
    },
  });
  const values = {
    recientes: "2026-10-31T09:00:00.000001+00:00",
    precio_asc: 400,
    precio_desc: 400,
    disponibilidad: "2026-12-01",
  } as const;
  for (const order of ROOM_SEARCH_ORDERS) {
    await searchPublicRooms(
      fake.client,
      "barcelona",
      {
        barrio: "gracia",
        precio_max: "600",
        entrada: "2026-12-01",
        meses: "6",
        caracteristica: "wifi",
        mascotas: "si",
        fumar: "no",
        estudiantes: "1",
        dormitorios_max: "3",
        convivientes_max: "2",
        orden: order,
        cursor: encodeRoomSearchCursor({ order, value: values[order], id: ID }),
      },
      signerDeps
    );
  }
  await getPublicRoom(fake.client, "barcelona", ID, signerDeps);
  return fake.calls.filter((call) => call.table === "rooms");
}

describe("GRANT de anon sobre rooms = columnas que usa la búsqueda pública", () => {
  it("el GRANT se ha leído de la migración (20 columnas)", () => {
    expect(anonGrant()).toHaveLength(20);
  });

  it("ninguna columna concedida sobra y ninguna usada falta", async () => {
    const calls = await allRoomsCalls();
    expect(calls.length).toBeGreaterThanOrEqual(ROOM_SEARCH_ORDERS.length + 2);
    const used = [...new Set(calls.flatMap(touchedColumns))].sort();
    expect(used).toEqual(anonGrant());
  });

  it("fuera del GRANT: la propietaria, las coordenadas, el estado, el borrado y las fechas internas", () => {
    for (const column of [
      "owner_id",
      "approx_lat",
      "approx_lng",
      "status",
      "deleted_at",
      "created_at",
      "updated_at",
    ])
      expect(anonGrant()).not.toContain(column);
  });
});

describe("el código público no nombra datos privados", () => {
  it("existen los archivos de la búsqueda y del detalle", () => {
    for (const file of [SERVICE, VALIDATION, PUBLIC_CLIENT, SEARCH_PAGE, DETAIL_PAGE])
      expect(existsSync(file)).toBe(true);
  });

  it("ni dirección, ni identidad, ni estado, ni borrado lógico, ni coordenadas", () => {
    const forbidden =
      /room_addresses|address_exact|owner_id|approx_lat|approx_lng|deleted_at|full_name|avatar_url|public_profile_previews|["']profiles["']|(?<!role=)["']status["']/;
    const offenders = PUBLIC_FILES.filter((file) => forbidden.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it("el servicio no usa service_role, Storage ni RPC: solo room-images.ts firma", () => {
    const service = code(SERVICE);
    expect(service).not.toMatch(
      /supabase\/admin|createAdminClient|env\.server|\.storage|\.rpc\(/
    );
    expect(service).toMatch(/from "@\/lib\/services\/room-images"/);
  });
});

describe("cliente de un visitante, sin sesión", () => {
  it("lib/supabase/public.ts: clave pública, sin cookies ni sesión guardada, solo servidor", () => {
    const source = code(PUBLIC_CLIENT);
    expect(source).toMatch(/import "server-only"/);
    expect(source).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(source).toMatch(/persistSession: false/);
    expect(source).toMatch(/autoRefreshToken: false/);
    expect(source).not.toMatch(/cookies|SERVICE_ROLE|env\.server|@supabase\/ssr/);
  });

  it("las páginas públicas leen con createPublicClient, nunca con el cliente de la sesión", () => {
    for (const file of [SEARCH_PAGE, DETAIL_PAGE]) {
      const source = code(file);
      expect(source).toMatch(/createPublicClient\(\)/);
      expect(source).not.toMatch(/@\/lib\/supabase\/server|@\/lib\/supabase\/admin/);
    }
  });

  it("sin ISR ni generación estática: la salida lleva URL firmadas que caducan", () => {
    for (const file of [SEARCH_PAGE, DETAIL_PAGE]) {
      const source = code(file);
      expect(source).not.toMatch(
        /export const revalidate|generateStaticParams|"use cache"|unstable_cache/
      );
      expect(source).toMatch(/export const dynamic = "force-dynamic"/);
    }
  });
});
