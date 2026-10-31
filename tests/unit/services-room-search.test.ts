import { describe, expect, it, vi } from "vitest";
import {
  PUBLIC_ROOM_CARD_SELECT,
  PUBLIC_ROOM_DETAIL_SELECT,
  cursorCondition,
  getPublicRoom,
  searchPublicRooms,
} from "@/lib/services/room-search";
import type { RoomImagesDeps } from "@/lib/services/room-images";
import type { DbClient } from "@/lib/services/result";
import {
  type RawSearchParams,
  type RoomSearchOrder,
  decodeRoomSearchCursor,
  encodeRoomSearchCursor,
} from "@/lib/validation/room-search";
import { ROOM_IMAGE_SIGNED_URL_TTL_SECONDS } from "@/lib/validation/room-images";
import { createFakeSupabase, dbError, type Call } from "./helpers/fake-supabase";

// Sin la clave de servicio en los tests: las dependencias por defecto solo
// pueden firmar con el cliente simulado que fije cada test.
const defaultAdmin = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!defaultAdmin.current) throw new Error("createAdminClient sin cliente simulado");
    return defaultAdmin.current;
  },
}));

// Fase 4.4 (sesión 71) — búsqueda pública y detalle de habitaciones. El
// servicio lee SOLO con el cliente que recibe (en las páginas, el de un
// visitante sin sesión), con columnas de la lista blanca; convierte cada fila
// campo a campo; obtiene ciudad, barrios y portadas por lotes (sin N+1); y el
// cliente admin solo firma las rutas de las fotos que el visitante acaba de
// leer (ni una lectura de tablas con service_role).

const CITY = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Barcelona",
  slug: "barcelona",
};
const HOODS = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Gràcia", slug: "gracia" },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Sants", slug: "sants" },
];
const NOW = new Date("2026-10-31T10:00:00.000Z");
const EXPIRES = "2026-10-31T10:10:00.000Z";

const roomId = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const imageId = (room: number, n: number) =>
  `${String(room).padStart(8, "0")}-${String(n).padStart(4, "0")}-4111-8111-111111111111`;
const signedUrl = (path: string) => `https://signed.test/${path}?token=t`;

/** Fila de `rooms` como la devolvería PostgREST con PUBLIC_ROOM_CARD_SELECT. */
const cardRow = (n: number) => ({
  id: roomId(n),
  title: `Habitación ${n}`,
  neighborhood_id: HOODS[n % 2].id,
  price_month: 300 + n,
  expenses_included: n % 2 === 0,
  available_from: `2026-12-${String((n % 28) + 1).padStart(2, "0")}`,
  total_rooms: 3,
  total_roommates: 2,
  published_at: `2026-10-${String(30 - (n % 28)).padStart(2, "0")}T09:00:00.${String(n).padStart(6, "0")}+00:00`,
});

const coverRow = (room: number, n = 1, position = 0) => ({
  id: imageId(room, n),
  room_id: roomId(room),
  storage_path: `${roomId(room)}/${imageId(room, n)}.webp`,
  position,
});

type Responses = {
  city?: unknown;
  cityError?: ReturnType<typeof dbError>;
  hoods?: unknown;
  rooms?: unknown[];
  roomsError?: ReturnType<typeof dbError>;
  room?: unknown;
  hood?: unknown;
  images?: unknown[];
  imagesError?: ReturnType<typeof dbError>;
};

/** Cliente del visitante (sin sesión): responde por tabla. */
function visitor(responses: Responses = {}) {
  return createFakeSupabase({
    userId: null,
    respond: (call) => {
      switch (call.table) {
        case "cities":
          return (
            responses.cityError ?? {
              data: responses.city === undefined ? CITY : responses.city,
              error: null,
            }
          );
        case "neighborhoods":
          if (call.terminal === "maybeSingle")
            return {
              data: responses.hood === undefined ? { name: "Gràcia" } : responses.hood,
              error: null,
            };
          return {
            data: responses.hoods === undefined ? HOODS : responses.hoods,
            error: null,
          };
        case "rooms":
          if (call.terminal === "maybeSingle")
            return {
              data: responses.room === undefined ? null : responses.room,
              error: null,
            };
          return responses.roomsError ?? { data: responses.rooms ?? [], error: null };
        case "room_images":
          return responses.imagesError ?? { data: responses.images ?? [], error: null };
        default:
          return { data: null, error: null };
      }
    },
  });
}

type SignCall = { bucket: string; paths: string[]; expiresIn: number };

/** Cliente admin: registra cualquier lectura de tablas y cada petición de firma. */
function admin(
  options: { signError?: boolean; signThrows?: boolean; failPaths?: string[] } = {}
) {
  const tableCalls: Call[] = [];
  const signCalls: SignCall[] = [];
  const fake = createFakeSupabase({
    userId: null,
    respond: (call) => {
      tableCalls.push(call);
      return { data: null, error: null };
    },
  });
  const client = {
    ...(fake.client as unknown as object),
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], expiresIn: number) => {
          signCalls.push({ bucket, paths: [...paths], expiresIn });
          if (options.signThrows) throw new TypeError("respuesta inesperada");
          if (options.signError) return { data: null, error: { message: "caído" } };
          return {
            data: paths.map((path) =>
              options.failPaths?.includes(path)
                ? { path, signedUrl: null, error: "Object not found" }
                : { path, signedUrl: signedUrl(path), error: null }
            ),
            error: null,
          };
        },
      }),
    },
  } as unknown as DbClient;
  let created = 0;
  const deps: RoomImagesDeps = {
    adminClient: () => {
      created += 1;
      return client;
    },
    sanitize: async () => {
      throw new Error("la búsqueda no sube fotos");
    },
    newId: () => {
      throw new Error("la búsqueda no crea ids");
    },
    now: () => NOW,
    signedUrlTtlSeconds: 600,
    reportRecovery: () => {
      throw new Error("la búsqueda no recupera nada");
    },
  };
  return { deps, tableCalls, signCalls, created: () => created };
}

async function search(raw: RawSearchParams, responses: Responses = {}, signer = admin()) {
  const fake = visitor(responses);
  const result = await searchPublicRooms(fake.client, "barcelona", raw, signer.deps);
  return { result, calls: fake.calls, signer };
}

const roomsCall = (calls: Call[]) => {
  const call = calls.find((c) => c.table === "rooms");
  if (!call) throw new Error("sin consulta de rooms");
  return call;
};

const results = (result: Awaited<ReturnType<typeof searchPublicRooms>>) => {
  if (!result.ok || result.data.outcome.kind !== "results")
    throw new Error(`se esperaban resultados: ${JSON.stringify(result)}`);
  return result.data.outcome;
};

describe("searchPublicRooms: ciudad de la ruta", () => {
  it("un slug mal formado: not_found sin consultar nada", async () => {
    for (const slug of ["Barcelona", "barcelona/x", "", "a".repeat(101), 42, null]) {
      const fake = visitor();
      const signer = admin();
      const result = await searchPublicRooms(fake.client, slug, {}, signer.deps);
      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(fake.calls).toHaveLength(0);
      expect(signer.created()).toBe(0);
    }
  });

  it("ciudad inexistente o inactiva: not_found, sin barrios ni habitaciones", async () => {
    const { result, calls } = await search({}, { city: null });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(calls.map((c) => c.table)).toEqual(["cities"]);
    expect(calls[0]).toMatchObject({
      columns: "id, name, slug",
      filters: [
        { kind: "eq", column: "slug", value: "barcelona" },
        { kind: "eq", column: "is_active", value: true },
      ],
      terminal: "maybeSingle",
    });
  });

  it("un error de la base de datos: error genérico, sin seguir", async () => {
    const { result, calls } = await search({}, { cityError: dbError("XX000") });
    expect(result).toEqual({ ok: false, error: "unknown" });
    expect(calls).toHaveLength(1);
  });

  it("los barrios se leen una vez, de esa ciudad", async () => {
    const { calls } = await search({});
    expect(calls[1]).toMatchObject({
      table: "neighborhoods",
      columns: "id, name, slug",
      filters: [{ kind: "eq", column: "city_id", value: CITY.id }],
      order: ["name"],
    });
  });
});

describe("searchPublicRooms: parámetros no válidos", () => {
  it("no consulta habitaciones ni firma nada; devuelve los errores y la ciudad", async () => {
    const { result, calls, signer } = await search({
      barrio: "eixample",
      mascotas: "quizá",
    });
    expect(result.ok && result.data.outcome).toEqual({
      kind: "invalid",
      fieldErrors: {
        barrio: ["Algún barrio no es de esta ciudad"],
        mascotas: ["Elige sí, no o indiferente"],
      },
    });
    expect(result.ok && result.data.city).toEqual({
      name: "Barcelona",
      slug: "barcelona",
    });
    expect(calls.map((c) => c.table)).toEqual(["cities", "neighborhoods"]);
    expect(signer.created()).toBe(0);
  });

  it("un barrio de otra ciudad (no está entre los de la ruta) invalida la búsqueda", async () => {
    const { result } = await search({ barrio: ["gracia", "poblenou"] });
    expect(result.ok && result.data.outcome.kind).toBe("invalid");
  });
});

describe("searchPublicRooms: consulta de habitaciones", () => {
  it("sin filtros: columnas de la lista blanca, la ciudad, «Más recientes» y 21 filas", async () => {
    const { calls } = await search({});
    expect(roomsCall(calls)).toEqual({
      table: "rooms",
      operation: "select",
      columns: PUBLIC_ROOM_CARD_SELECT,
      filters: [{ kind: "eq", column: "city_id", value: CITY.id }],
      order: ["published_at.desc", "id.desc"],
      limit: 21,
      terminal: "await",
    });
  });

  it("nunca pide estado, propietaria, coordenadas ni fechas internas: lo decide la RLS y el GRANT", async () => {
    const { calls } = await search({ estudiantes: "1", mascotas: "si" });
    const call = roomsCall(calls);
    const touched = [
      ...String(call.columns)
        .split(",")
        .map((c) => c.trim()),
      ...call.filters.map((f) => f.column),
      ...(call.order ?? []).map((o) => o.replace(/\.desc$/, "")),
    ];
    for (const column of [
      "owner_id",
      "status",
      "deleted_at",
      "created_at",
      "updated_at",
      "approx_lat",
      "approx_lng",
    ])
      expect(touched).not.toContain(column);
    expect(calls.some((c) => c.table === "room_addresses")).toBe(false);
    expect(calls.some((c) => c.table === "profiles")).toBe(false);
  });

  it("cada filtro, con su operador", async () => {
    const { calls } = await search({
      barrio: ["sants", "gracia"],
      precio_max: "600",
      entrada: "2026-12-15",
      caracteristica: ["wifi", "desk"],
      mascotas: "si",
      fumar: "no",
      estudiantes: "1",
      dormitorios_max: "4",
      convivientes_max: "2",
    });
    expect(roomsCall(calls).filters).toEqual([
      { kind: "eq", column: "city_id", value: CITY.id },
      { kind: "in", column: "neighborhood_id", value: [HOODS[1].id, HOODS[0].id] },
      { kind: "lte", column: "price_month", value: 600 },
      { kind: "lte", column: "available_from", value: "2026-12-15" },
      // `features @> {wifi,desk}`: TODAS las elegidas.
      { kind: "contains", column: "features", value: ["wifi", "desk"] },
      { kind: "eq", column: "pets_allowed", value: true },
      { kind: "eq", column: "smoking_allowed", value: false },
      { kind: "eq", column: "students_only", value: true },
      { kind: "lte", column: "total_rooms", value: 4 },
      { kind: "lte", column: "total_roommates", value: 2 },
    ]);
  });

  it("mascotas y fumar: «no» filtra por false; indiferente no filtra", async () => {
    const no = roomsCall((await search({ mascotas: "no", fumar: "si" })).calls).filters;
    expect(no).toContainEqual({ kind: "eq", column: "pets_allowed", value: false });
    expect(no).toContainEqual({ kind: "eq", column: "smoking_allowed", value: true });
    const any = roomsCall((await search({ mascotas: "", fumar: "" })).calls).filters;
    expect(any.map((f) => f.column)).toEqual(["city_id"]);
  });

  it("solo estudiantes desactivado no impone ninguna condición sobre students_only", async () => {
    const filters = roomsCall((await search({})).calls).filters;
    expect(filters.map((f) => f.column)).not.toContain("students_only");
  });

  it("la estancia: un mínimo o un máximo sin valor es «sin límite»", async () => {
    const { calls } = await search({ meses: "6" });
    expect(roomsCall(calls).filters).toContainEqual({
      kind: "or",
      column: "",
      value:
        "and(or(min_stay_months.is.null,min_stay_months.lte.6),or(max_stay_months.is.null,max_stay_months.gte.6))",
    });
  });

  it("la estancia y el cursor van en un único `or`", async () => {
    const cursor = encodeRoomSearchCursor({
      order: "precio_asc",
      value: 450,
      id: roomId(7),
    });
    const { calls } = await search({ meses: "3", orden: "precio_asc", cursor });
    const logic = roomsCall(calls).filters.filter((f) => f.kind === "or");
    expect(logic).toEqual([
      {
        kind: "or",
        column: "",
        value: `and(or(min_stay_months.is.null,min_stay_months.lte.3),or(max_stay_months.is.null,max_stay_months.gte.3),or(price_month.gt."450",and(price_month.eq."450",id.gt."${roomId(7)}")))`,
      },
    ]);
  });
});

describe("los cuatro órdenes, con desempate por id", () => {
  const cases: Array<[RoomSearchOrder, string[], string | number, string]> = [
    [
      "recientes",
      ["published_at.desc", "id.desc"],
      "2026-10-30T09:00:00.000001+00:00",
      "lt",
    ],
    ["precio_asc", ["price_month", "id"], 450, "gt"],
    ["precio_desc", ["price_month.desc", "id.desc"], 450, "lt"],
    ["disponibilidad", ["available_from", "id"], "2026-12-01", "gt"],
  ];

  for (const [order, expectedOrder, value, op] of cases) {
    it(`${order}: orden y condición del cursor`, async () => {
      const { calls } = await search({ orden: order });
      expect(roomsCall(calls).order).toEqual(expectedOrder);

      const cursor = { order, value, id: roomId(3) };
      const column = expectedOrder[0].replace(/\.desc$/, "");
      expect(cursorCondition(cursor)).toBe(
        `or(${column}.${op}."${value}",and(${column}.eq."${value}",id.${op}."${roomId(3)}"))`
      );
      const withCursor = await search({
        orden: order,
        cursor: encodeRoomSearchCursor(cursor),
      });
      expect(roomsCall(withCursor.calls).filters).toContainEqual({
        kind: "or",
        column: "",
        value: `and(${cursorCondition(cursor)})`,
      });
      expect(roomsCall(withCursor.calls).order).toEqual(expectedOrder);
    });
  }
});

describe("paginación por cursor", () => {
  it("21 filas: 20 tarjetas y el cursor de la fila 20 (valor de orden e id)", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cardRow(i + 1));
    const outcome = results(
      (await search({ orden: "precio_desc" }, { rooms: rows })).result
    );
    expect(outcome.rooms).toHaveLength(20);
    expect(outcome.rooms.map((r) => r.id)).toEqual(rows.slice(0, 20).map((r) => r.id));
    expect(decodeRoomSearchCursor(outcome.nextCursor as string, "precio_desc")).toEqual({
      order: "precio_desc",
      value: rows[19].price_month,
      id: rows[19].id,
    });
  });

  it("«Más recientes»: el cursor guarda published_at tal cual (microsegundos incluidos)", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cardRow(i + 1));
    const outcome = results((await search({}, { rooms: rows })).result);
    expect(decodeRoomSearchCursor(outcome.nextCursor as string, "recientes")?.value).toBe(
      rows[19].published_at
    );
  });

  it("«Disponibilidad más próxima»: el cursor guarda available_from", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cardRow(i + 1));
    const outcome = results(
      (await search({ orden: "disponibilidad" }, { rooms: rows })).result
    );
    expect(
      decodeRoomSearchCursor(outcome.nextCursor as string, "disponibilidad")?.value
    ).toBe(rows[19].available_from);
  });

  it("20 filas o menos: sin página siguiente", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => cardRow(i + 1));
    expect(results((await search({}, { rooms: twenty })).result).nextCursor).toBeNull();
    expect(results((await search({}, { rooms: [] })).result)).toMatchObject({
      rooms: [],
      nextCursor: null,
    });
  });

  it("una activa sin published_at (lo impide chk_rooms_published_at): error, no un cursor roto", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cardRow(i + 1));
    rows[19] = { ...rows[19], published_at: null as unknown as string };
    expect((await search({}, { rooms: rows })).result).toEqual({
      ok: false,
      error: "unknown",
    });
  });

  it("un error al leer habitaciones: el de la base de datos, sin firmar nada", async () => {
    const { result, signer } = await search({}, { roomsError: dbError("42501") });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(signer.created()).toBe(0);
  });
});

describe("tarjeta pública: lista blanca", () => {
  it("solo los campos aprobados, aunque la fila traiga más", async () => {
    const leaky = {
      ...cardRow(1),
      owner_id: "ffffffff-0000-4000-8000-000000000000",
      status: "draft",
      deleted_at: "2026-10-01T00:00:00Z",
      approx_lat: 41.4,
      approx_lng: 2.15,
      created_at: "2026-01-01T00:00:00Z",
      address_exact: "Carrer Fals 1",
      full_name: "Ana",
    };
    const outcome = results(
      (await search({}, { rooms: [leaky], images: [coverRow(1)] })).result
    );
    expect(outcome.rooms).toEqual([
      {
        id: roomId(1),
        title: "Habitación 1",
        neighborhood: "Sants",
        city: "Barcelona",
        priceMonth: 301,
        expensesIncluded: false,
        availableFrom: "2026-12-02",
        totalRooms: 3,
        totalRoommates: 2,
        cover: { url: signedUrl(coverRow(1).storage_path), expiresAt: EXPIRES },
      },
    ]);
    expect(JSON.stringify(outcome)).not.toMatch(
      /owner_id|ffffffff|draft|deleted_at|approx|41\.4|address|Carrer|full_name|Ana|published_at|created_at/
    );
  });

  it("un barrio que no está en el catálogo de la ciudad: sin nombre", async () => {
    const row = {
      ...cardRow(1),
      neighborhood_id: "b0000000-0000-4000-8000-000000000009",
    };
    expect(
      results((await search({}, { rooms: [row] })).result).rooms[0].neighborhood
    ).toBeNull();
  });
});

describe("portadas: un lote de fotos y una sola firma", () => {
  it("lee las fotos de las 20 habitaciones de la página (no la 21) con el cliente del visitante", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cardRow(i + 1));
    const { calls } = await search({}, { rooms: rows });
    const images = calls.filter((c) => c.table === "room_images");
    expect(images).toEqual([
      {
        table: "room_images",
        operation: "select",
        columns: "id, room_id, storage_path, position",
        filters: [
          { kind: "in", column: "room_id", value: rows.slice(0, 20).map((r) => r.id) },
        ],
        order: ["position", "created_at", "id"],
        terminal: "await",
      },
    ]);
  });

  it("la primera foto de cada habitación, solo rutas canónicas; las demás no se firman", async () => {
    const tampered = {
      ...coverRow(2, 1),
      storage_path: `${roomId(1)}/${imageId(2, 1)}.webp`,
    };
    const { result, signer } = await search(
      {},
      {
        rooms: [cardRow(1), cardRow(2), cardRow(3)],
        images: [
          coverRow(1, 1, 0),
          coverRow(1, 2, 1),
          tampered,
          coverRow(2, 2, 3),
          // Una foto de una habitación que no se ha pedido: se ignora.
          coverRow(9, 1, 0),
        ],
      }
    );
    expect(signer.signCalls).toEqual([
      {
        bucket: "room-images",
        paths: [coverRow(1, 1).storage_path, coverRow(2, 2).storage_path],
        expiresIn: 600,
      },
    ]);
    const cards = results(result).rooms;
    expect(cards.map((c) => c.cover?.url ?? null)).toEqual([
      signedUrl(coverRow(1, 1).storage_path),
      signedUrl(coverRow(2, 2).storage_path),
      null,
    ]);
  });

  it("sin fotos: tarjetas sin portada y ninguna petición de firma", async () => {
    const { result, signer } = await search({}, { rooms: [cardRow(1)], images: [] });
    expect(results(result).rooms[0].cover).toBeNull();
    expect(results(result).coversUnavailable).toBe(false);
    expect(signer.signCalls).toHaveLength(0);
  });

  it("sin resultados: ni fotos ni firma", async () => {
    const { calls, signer } = await search({}, { rooms: [] });
    expect(calls.map((c) => c.table)).toEqual(["cities", "neighborhoods", "rooms"]);
    expect(signer.created()).toBe(0);
  });

  it("la firma falla entera o lanza: tarjetas sin portada y aviso", async () => {
    for (const signer of [admin({ signError: true }), admin({ signThrows: true })]) {
      const { result } = await search(
        {},
        { rooms: [cardRow(1)], images: [coverRow(1)] },
        signer
      );
      expect(results(result)).toMatchObject({ coversUnavailable: true });
      expect(results(result).rooms[0].cover).toBeNull();
    }
  });

  it("falla una foto: esa tarjeta sin portada, las demás con la suya", async () => {
    const signer = admin({ failPaths: [coverRow(1).storage_path] });
    const { result } = await search(
      {},
      { rooms: [cardRow(1), cardRow(2)], images: [coverRow(1), coverRow(2)] },
      signer
    );
    expect(results(result).rooms.map((c) => c.cover?.url ?? null)).toEqual([
      null,
      signedUrl(coverRow(2).storage_path),
    ]);
    expect(results(result).coversUnavailable).toBe(false);
  });

  it("un error al leer las fotos: tarjetas sin portada y aviso, sin firmar", async () => {
    const { result, signer } = await search(
      {},
      { rooms: [cardRow(1)], imagesError: dbError("42501") }
    );
    expect(results(result)).toMatchObject({ coversUnavailable: true });
    expect(signer.created()).toBe(0);
  });

  it("caducidad: la configurada (por defecto ROOM_IMAGE_SIGNED_URL_TTL_SECONDS) y expiresAt calculado antes de firmar", async () => {
    const signer = admin();
    defaultAdmin.current = (signer.deps.adminClient as () => DbClient)();
    try {
      const fake = visitor({ rooms: [cardRow(1)], images: [coverRow(1)] });
      const before = Date.now();
      const result = await searchPublicRooms(fake.client, "barcelona", {});
      const cover = results(result).rooms[0].cover;
      expect(signer.signCalls.at(-1)?.expiresIn).toBe(ROOM_IMAGE_SIGNED_URL_TTL_SECONDS);
      expect(Date.parse(cover?.expiresAt as string)).toBeGreaterThanOrEqual(
        before + ROOM_IMAGE_SIGNED_URL_TTL_SECONDS * 1000
      );
    } finally {
      defaultAdmin.current = null;
    }
  });
});

describe("sin N+1: las mismas peticiones con 1 y con 20 resultados", () => {
  async function count(n: number) {
    const rows = Array.from({ length: n }, (_, i) => cardRow(i + 1));
    const images = rows.flatMap((_, i) => [coverRow(i + 1, 1, 0), coverRow(i + 1, 2, 1)]);
    const signer = admin();
    const { result, calls } = await search(
      { barrio: ["gracia", "sants"] },
      { rooms: rows, images },
      signer
    );
    expect(results(result).rooms).toHaveLength(n);
    expect(results(result).rooms.every((card) => card.cover !== null)).toBe(true);
    return {
      tables: calls.map((c) => c.table),
      signRequests: signer.signCalls.length,
      signedPaths: signer.signCalls.flatMap((c) => c.paths).length,
      adminTableReads: signer.tableCalls.length,
    };
  }

  it("4 consultas del visitante y 1 petición de firma, con 1 o con 20", async () => {
    const one = await count(1);
    const twenty = await count(20);
    expect(one.tables).toEqual(["cities", "neighborhoods", "rooms", "room_images"]);
    expect(twenty.tables).toEqual(one.tables);
    expect(one.signRequests).toBe(1);
    expect(twenty.signRequests).toBe(1);
    // Una ruta por habitación dentro de la misma petición, no una petición por habitación.
    expect(one.signedPaths).toBe(1);
    expect(twenty.signedPaths).toBe(20);
    // service_role no lee ninguna tabla.
    expect(one.adminTableReads).toBe(0);
    expect(twenty.adminTableReads).toBe(0);
  });
});

describe("getPublicRoom: detalle público", () => {
  const detailRow = {
    id: roomId(5),
    title: "Habitación luminosa",
    description: "Cerca del metro.",
    neighborhood_id: HOODS[0].id,
    price_month: 480,
    expenses_included: true,
    deposit_amount: 480,
    available_from: "2026-12-01",
    min_stay_months: 3,
    max_stay_months: 12,
    total_roommates: 2,
    total_rooms: 3,
    features: ["wifi", "desk"],
    pets_allowed: false,
    smoking_allowed: false,
    students_only: true,
    house_rules: "Silencio a partir de las 23 h.",
    roommate_preferences: "Personas tranquilas.",
  };
  const photo = (n: number, position = n) => ({
    id: imageId(5, n),
    storage_path: `${roomId(5)}/${imageId(5, n)}.webp`,
    position,
  });

  async function detail(
    responses: Responses & { roomForImages?: unknown },
    id: unknown = roomId(5),
    signer = admin()
  ) {
    let roomReads = 0;
    const fake = createFakeSupabase({
      userId: null,
      respond: (call) => {
        if (call.table === "cities")
          return {
            data: responses.city === undefined ? CITY : responses.city,
            error: null,
          };
        if (call.table === "rooms") {
          roomReads += 1;
          // 1.ª lectura: el detalle; 2.ª: la de listRoomImages (vuelve a comprobar R7).
          if (roomReads === 1)
            return {
              data: responses.room === undefined ? detailRow : responses.room,
              error: null,
            };
          return {
            data:
              responses.roomForImages === undefined
                ? { id: roomId(5) }
                : responses.roomForImages,
            error: null,
          };
        }
        if (call.table === "neighborhoods")
          return {
            data: responses.hood === undefined ? { name: "Gràcia" } : responses.hood,
            error: null,
          };
        if (call.table === "room_images")
          return responses.imagesError ?? { data: responses.images ?? [], error: null };
        return { data: null, error: null };
      },
    });
    const result = await getPublicRoom(fake.client, "barcelona", id, signer.deps);
    return { result, calls: fake.calls, signer };
  }

  it("habitación pública: lista blanca, barrio y ciudad, y fotos firmadas con la caducidad configurada", async () => {
    const { result, calls, signer } = await detail({
      images: [photo(1, 0), photo(2, 1)],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        id: roomId(5),
        title: "Habitación luminosa",
        description: "Cerca del metro.",
        neighborhood: "Gràcia",
        city: { name: "Barcelona", slug: "barcelona" },
        priceMonth: 480,
        expensesIncluded: true,
        depositAmount: 480,
        availableFrom: "2026-12-01",
        minStayMonths: 3,
        maxStayMonths: 12,
        totalRooms: 3,
        totalRoommates: 2,
        features: [
          { key: "wifi", label: "Wi-Fi" },
          { key: "desk", label: "Escritorio" },
        ],
        petsAllowed: false,
        smokingAllowed: false,
        studentsOnly: true,
        houseRules: "Silencio a partir de las 23 h.",
        roommatePreferences: "Personas tranquilas.",
        photos: {
          available: true,
          images: [
            {
              id: photo(1).id,
              position: 0,
              url: signedUrl(photo(1).storage_path),
              expiresAt: EXPIRES,
            },
            {
              id: photo(2).id,
              position: 1,
              url: signedUrl(photo(2).storage_path),
              expiresAt: EXPIRES,
            },
          ],
        },
      },
    });
    // Secuencia: ciudad → habitación (visitante) → barrio → habitación otra
    // vez (R7, listRoomImages) → solo sus fotos → una firma de esas rutas.
    expect(calls.map((c) => c.table)).toEqual([
      "cities",
      "rooms",
      "neighborhoods",
      "rooms",
      "room_images",
    ]);
    expect(calls[1]).toMatchObject({
      columns: PUBLIC_ROOM_DETAIL_SELECT,
      filters: [
        { kind: "eq", column: "id", value: roomId(5) },
        { kind: "eq", column: "city_id", value: CITY.id },
      ],
      terminal: "maybeSingle",
    });
    expect(calls[2]).toMatchObject({
      columns: "name",
      filters: [
        { kind: "eq", column: "id", value: HOODS[0].id },
        { kind: "eq", column: "city_id", value: CITY.id },
      ],
    });
    expect(calls[4]).toMatchObject({
      filters: [{ kind: "eq", column: "room_id", value: roomId(5) }],
    });
    expect(signer.signCalls).toEqual([
      {
        bucket: "room-images",
        paths: [photo(1).storage_path, photo(2).storage_path],
        expiresIn: 600,
      },
    ]);
    expect(signer.tableCalls).toHaveLength(0);
    expect(
      calls.some((c) => c.table === "room_addresses" || c.table === "profiles")
    ).toBe(false);
  });

  it("la fila trae más columnas de las debidas: no pasan al DTO", async () => {
    const { result } = await detail({
      room: {
        ...detailRow,
        owner_id: "ffffffff-0000-4000-8000-000000000000",
        status: "active",
        approx_lat: 41.4,
        deleted_at: null,
        published_at: "2026-10-30T09:00:00+00:00",
      },
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /owner_id|ffffffff|status|approx|41\.4|deleted_at|published_at/
    );
  });

  it("404 indistinguible: id no válido, ciudad inexistente, habitación inexistente, de otra ciudad o no pública", async () => {
    const notFound = { ok: false, error: "not_found" };
    // Un id que no es UUID: sin consultar nada.
    const invalid = await detail({}, "../../etc");
    expect(invalid.result).toEqual(notFound);
    expect(invalid.calls).toHaveLength(0);
    // Ciudad inexistente o inactiva.
    expect((await detail({ city: null })).result).toEqual(notFound);
    // Inexistente, de otra ciudad (el filtro city_id no la devuelve) o no
    // pública (borrador, pausada, retirada, eliminada, cuenta desactivada: la
    // RLS no la devuelve): la misma respuesta vacía.
    const hidden = await detail({ room: null });
    expect(hidden.result).toEqual(notFound);
    expect(hidden.calls.map((c) => c.table)).toEqual(["cities", "rooms"]);
    expect(hidden.signer.created()).toBe(0);
  });

  it("deja de ser pública entre las dos lecturas: 404, sin firmar", async () => {
    const { result, signer } = await detail({ roomForImages: null, images: [photo(1)] });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(signer.created()).toBe(0);
  });

  it("sin fotos: lista vacía, sin petición de firma", async () => {
    const { result, signer } = await detail({ images: [] });
    expect(result.ok && result.data.photos).toEqual({ available: true, images: [] });
    expect(signer.signCalls).toHaveLength(0);
  });

  it("la firma falla: la habitación se muestra, sin fotos", async () => {
    for (const signer of [admin({ signError: true }), admin({ signThrows: true })]) {
      const { result } = await detail({ images: [photo(1)] }, roomId(5), signer);
      expect(result.ok && result.data.photos).toEqual({ available: false });
    }
  });

  it("falla una foto: esa sin URL, las demás firmadas", async () => {
    const signer = admin({ failPaths: [photo(1).storage_path] });
    const { result } = await detail(
      { images: [photo(1, 0), photo(2, 1)] },
      roomId(5),
      signer
    );
    expect(result.ok && result.data.photos).toEqual({
      available: true,
      images: [
        { id: photo(1).id, position: 0, url: null, expiresAt: null },
        {
          id: photo(2).id,
          position: 1,
          url: signedUrl(photo(2).storage_path),
          expiresAt: EXPIRES,
        },
      ],
    });
  });

  it("acceso sin sesión: el servicio nunca pregunta por el usuario", async () => {
    const fake = visitor({ room: detailRow });
    const getUser = vi.spyOn(fake.client.auth, "getUser");
    await getPublicRoom(fake.client, "barcelona", roomId(5), admin().deps);
    await searchPublicRooms(fake.client, "barcelona", {}, admin().deps);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("características fuera del catálogo (no deberían existir: CHECK) no se muestran", async () => {
    const { result } = await detail({
      room: { ...detailRow, features: ["wifi", "piscina"] },
    });
    expect(result.ok && result.data.features).toEqual([{ key: "wifi", label: "Wi-Fi" }]);
  });
});
