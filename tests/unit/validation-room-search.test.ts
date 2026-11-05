import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_SEARCH_ORDER,
  EMPTY_ROOM_SEARCH_FILTERS,
  ROOM_SEARCH_MAX_LIST_VALUES,
  ROOM_SEARCH_ORDERS,
  type RawSearchParams,
  type RoomSearchFilters,
  decodeRoomSearchCursor,
  encodeRoomSearchCursor,
  hasRoomSearchFilters,
  parseRoomSearchParams,
  publicRoomPath,
  roomSearchHref,
  roomSearchPath,
} from "@/lib/validation/room-search";

// Fase 4.4 (sesión 71) — parámetros de la búsqueda pública: esquema estricto
// (un parámetro desconocido, repetido o mal formado, o un barrio de otra
// ciudad, invalidan la búsqueda), los cuatro órdenes y el cursor opaco.

const SLUGS = new Set(["gracia", "sants", "el-raval"]);
const ID = "0f6b1e1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";

const parse = (raw: RawSearchParams) => parseRoomSearchParams(raw, SLUGS);
const ok = (raw: RawSearchParams): RoomSearchFilters => {
  const result = parse(raw);
  if (!result.success) throw new Error(JSON.stringify(result.fieldErrors));
  return result.data;
};
const errors = (raw: RawSearchParams) => {
  const result = parse(raw);
  if (result.success) throw new Error("se esperaba un error");
  return result.fieldErrors;
};

/** Lo que envía el formulario GET sin tocar nada: todos los campos, vacíos. */
const EMPTY_FORM: RawSearchParams = {
  precio_max: "",
  entrada: "",
  meses: "",
  mascotas: "",
  fumar: "",
  dormitorios_max: "",
  convivientes_max: "",
  orden: "recientes",
};

describe("parseRoomSearchParams: valores por defecto y vacíos", () => {
  it("sin parámetros: sin filtros, «Más recientes» y sin cursor", () => {
    expect(ok({})).toEqual(EMPTY_ROOM_SEARCH_FILTERS);
    expect(DEFAULT_ROOM_SEARCH_ORDER).toBe("recientes");
  });

  it("el formulario enviado vacío equivale a no filtrar", () => {
    expect(ok(EMPTY_FORM)).toEqual(EMPTY_ROOM_SEARCH_FILTERS);
    expect(hasRoomSearchFilters(ok(EMPTY_FORM))).toBe(false);
  });

  it("los `undefined` de Next.js no cuentan como parámetro", () => {
    expect(ok({ barrio: undefined, orden: undefined })).toEqual(
      EMPTY_ROOM_SEARCH_FILTERS
    );
  });
});

describe("parseRoomSearchParams: todos los filtros", () => {
  it("cada filtro con un valor válido", () => {
    const filters = ok({
      barrio: ["gracia", "sants"],
      precio_max: "550",
      entrada: "2026-12-01",
      meses: "6",
      caracteristica: ["wifi", "desk"],
      mascotas: "si",
      fumar: "no",
      estudiantes: "1",
      dormitorios_max: "4",
      convivientes_max: "0",
      orden: "precio_asc",
    });
    expect(filters).toEqual({
      neighborhoods: ["gracia", "sants"],
      maxPrice: 550,
      moveIn: "2026-12-01",
      stayMonths: 6,
      features: ["wifi", "desk"],
      pets: "si",
      smoking: "no",
      studentsOnly: true,
      maxBedrooms: 4,
      maxRoommates: 0,
      order: "precio_asc",
      cursor: null,
    });
    expect(hasRoomSearchFilters(filters)).toBe(true);
  });

  it("un solo barrio llega como texto, no como lista", () => {
    expect(ok({ barrio: "el-raval" }).neighborhoods).toEqual(["el-raval"]);
  });

  it("barrios y características repetidos se quitan, en el orden recibido; los vacíos se ignoran", () => {
    const filters = ok({
      barrio: ["sants", "gracia", "sants", ""],
      caracteristica: ["desk", "wifi", "desk"],
    });
    expect(filters.neighborhoods).toEqual(["sants", "gracia"]);
    expect(filters.features).toEqual(["desk", "wifi"]);
  });

  it("mascotas y fumar distinguen sí, no e indiferente", () => {
    expect(ok({ mascotas: "si" }).pets).toBe("si");
    expect(ok({ mascotas: "no" }).pets).toBe("no");
    expect(ok({ mascotas: "" }).pets).toBeNull();
    expect(ok({ fumar: "si" }).smoking).toBe("si");
    expect(ok({ fumar: "no" }).smoking).toBe("no");
    expect(ok({}).smoking).toBeNull();
    for (const value of ["true", "false", "SI", "sí", "0", "1"]) {
      expect(errors({ mascotas: value })).toHaveProperty("mascotas");
      expect(errors({ fumar: value })).toHaveProperty("fumar");
    }
  });

  it("solo estudiantes: activado con «1»; sin él, sin condición", () => {
    expect(ok({ estudiantes: "1" }).studentsOnly).toBe(true);
    expect(ok({}).studentsOnly).toBe(false);
    expect(ok({ estudiantes: "" }).studentsOnly).toBe(false);
    for (const value of ["0", "true", "on", "si"])
      expect(errors({ estudiantes: value })).toHaveProperty("estudiantes");
  });

  it("dormitorios (≥ 1) y convivientes (≥ 0) son filtros distintos", () => {
    expect(ok({ dormitorios_max: "1" }).maxBedrooms).toBe(1);
    expect(errors({ dormitorios_max: "0" })).toHaveProperty("dormitorios_max");
    expect(ok({ convivientes_max: "0" }).maxRoommates).toBe(0);
    expect(ok({ convivientes_max: "3" })).toMatchObject({
      maxRoommates: 3,
      maxBedrooms: null,
    });
  });
});

describe("parseRoomSearchParams: rechaza parámetros manipulados", () => {
  it("un parámetro desconocido invalida la búsqueda", () => {
    expect(errors({ owner_id: ID })).toHaveProperty("_form");
    expect(errors({ status: "draft" })).toHaveProperty("_form");
    expect(errors({ select: "*" })).toHaveProperty("_form");
    expect(errors({ utm_source: "x" })).toHaveProperty("_form");
  });

  it("un parámetro de un valor no se puede repetir", () => {
    for (const key of [
      "precio_max",
      "entrada",
      "meses",
      "mascotas",
      "fumar",
      "estudiantes",
      "dormitorios_max",
      "convivientes_max",
      "orden",
      "cursor",
    ])
      expect(errors({ [key]: ["1", "2"] })).toHaveProperty(key);
  });

  it(`más de ${ROOM_SEARCH_MAX_LIST_VALUES} valores en una lista`, () => {
    const many = Array.from({ length: ROOM_SEARCH_MAX_LIST_VALUES + 1 }, () => "gracia");
    expect(errors({ barrio: many })).toHaveProperty("barrio");
    expect(ok({ barrio: many.slice(1) }).neighborhoods).toEqual(["gracia"]);
  });

  it("un valor demasiado largo", () => {
    expect(errors({ barrio: "a".repeat(513) })).toHaveProperty("barrio");
  });

  it("un barrio que no es de la ciudad de la ruta, o mal formado", () => {
    expect(errors({ barrio: ["gracia", "eixample"] })).toHaveProperty("barrio");
    expect(errors({ barrio: "Gracia" })).toHaveProperty("barrio");
    expect(errors({ barrio: "gracia," })).toHaveProperty("barrio");
    expect(errors({ barrio: ID })).toHaveProperty("barrio");
  });

  it("una característica fuera del catálogo", () => {
    expect(errors({ caracteristica: ["wifi", "piscina"] })).toHaveProperty(
      "caracteristica"
    );
    expect(errors({ caracteristica: "WIFI" })).toHaveProperty("caracteristica");
  });

  it("números: solo dígitos, enteros, en rango de `integer`", () => {
    for (const value of ["1e3", " 12", "12 ", "+5", "-1", "12.5", "0x10", "abc", "0"])
      expect(errors({ precio_max: value })).toHaveProperty("precio_max");
    expect(errors({ precio_max: "2147483648" })).toHaveProperty("precio_max");
    expect(ok({ precio_max: "2147483647" }).maxPrice).toBe(2147483647);
    expect(errors({ meses: "0" })).toHaveProperty("meses");
    expect(ok({ meses: "1" }).stayMonths).toBe(1);
    expect(errors({ convivientes_max: "-1" })).toHaveProperty("convivientes_max");
  });

  it("la fecha de entrada: AAAA-MM-DD real", () => {
    for (const value of ["2026-02-30", "2026-13-01", "01/12/2026", "2026-12-1", "mañana"])
      expect(errors({ entrada: value })).toHaveProperty("entrada");
    expect(ok({ entrada: "2028-02-29" }).moveIn).toBe("2028-02-29");
  });

  it("un orden desconocido", () => {
    expect(errors({ orden: "relevancia" })).toHaveProperty("orden");
    expect(errors({ orden: "compatibilidad" })).toHaveProperty("orden");
    expect(errors({ orden: "distancia" })).toHaveProperty("orden");
  });

  it("los cuatro órdenes aprobados", () => {
    expect([...ROOM_SEARCH_ORDERS]).toEqual([
      "recientes",
      "precio_asc",
      "precio_desc",
      "disponibilidad",
    ]);
    for (const order of ROOM_SEARCH_ORDERS)
      expect(ok({ orden: order }).order).toBe(order);
  });
});

describe("cursor: opaco, validado y ligado a su orden", () => {
  const cursors = {
    recientes: { order: "recientes", value: "2026-10-31T09:12:44.123456+00:00", id: ID },
    precio_asc: { order: "precio_asc", value: 450, id: ID },
    precio_desc: { order: "precio_desc", value: 900, id: ID },
    disponibilidad: { order: "disponibilidad", value: "2026-12-01", id: ID },
  } as const;

  it("se codifica y se lee igual en los cuatro órdenes", () => {
    for (const order of ROOM_SEARCH_ORDERS) {
      const encoded = encodeRoomSearchCursor(cursors[order]);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeRoomSearchCursor(encoded, order)).toEqual(cursors[order]);
      expect(ok({ orden: order, cursor: encoded }).cursor).toEqual(cursors[order]);
    }
  });

  it("acepta las marcas de tiempo de PostgREST con 0 a 6 decimales y con Z", () => {
    for (const value of [
      "2026-10-31T09:12:44+00:00",
      "2026-10-31T09:12:44.1+00:00",
      "2026-10-31T09:12:44.123Z",
      "2026-10-31T11:12:44.123456+02:00",
    ]) {
      const encoded = encodeRoomSearchCursor({ order: "recientes", value, id: ID });
      expect(decodeRoomSearchCursor(encoded, "recientes")?.value).toBe(value);
    }
  });

  it("un cursor de otro orden no vale", () => {
    const encoded = encodeRoomSearchCursor(cursors.precio_asc);
    expect(decodeRoomSearchCursor(encoded, "precio_desc")).toBeNull();
    expect(errors({ orden: "precio_desc", cursor: encoded })).toHaveProperty("cursor");
    // Sin `orden`, la búsqueda es «Más recientes».
    expect(errors({ cursor: encoded })).toHaveProperty("cursor");
  });

  it("rechaza cursores manipulados, cada uno con su propio orden", () => {
    const raw = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const bad: Array<[string, (typeof ROOM_SEARCH_ORDERS)[number]]> = [
      ["no es base64!", "recientes"],
      ["", "recientes"],
      ["A".repeat(600), "recientes"],
      [Buffer.from("{no-json", "utf8").toString("base64url"), "recientes"],
      [raw([1, 2]), "recientes"],
      [raw("texto"), "recientes"],
      [raw(null), "recientes"],
      [raw({ o: "recientes", v: "2026-10-31T09:12:44Z" }), "recientes"],
      [raw({ o: "recientes", v: "2026-10-31T09:12:44Z", i: ID, extra: 1 }), "recientes"],
      [
        raw({ o: "recientes", v: "2026-10-31T09:12:44Z", i: ID.toUpperCase() }),
        "recientes",
      ],
      [raw({ o: "recientes", v: "2026-10-31", i: ID }), "recientes"],
      [raw({ o: "recientes", v: "2026-02-30T09:12:44Z", i: ID }), "recientes"],
      [raw({ o: "recientes", v: "2026-10-31T09:12:44.1234567Z", i: ID }), "recientes"],
      // Intento de inyectar otra condición en el filtro de PostgREST.
      [raw({ o: "recientes", v: '2026-10-31T09:12:44Z",id.gt."0', i: ID }), "recientes"],
      [raw({ o: "precio_asc", v: "450", i: ID }), "precio_asc"],
      [raw({ o: "precio_asc", v: 0, i: ID }), "precio_asc"],
      [raw({ o: "precio_asc", v: 12.5, i: ID }), "precio_asc"],
      [raw({ o: "precio_desc", v: 2147483648, i: ID }), "precio_desc"],
      [raw({ o: "disponibilidad", v: "2026-12-01T00:00:00Z", i: ID }), "disponibilidad"],
      [raw({ o: "disponibilidad", v: "2026-12-01", i: "x" }), "disponibilidad"],
      [
        raw({ o: "disponibilidad", v: "2026-12-01", i: `${ID},id.gt.0` }),
        "disponibilidad",
      ],
    ];
    for (const [cursor, order] of bad) {
      expect(decodeRoomSearchCursor(cursor, order)).toBeNull();
      if (cursor !== "")
        expect(errors({ orden: order, cursor })).toHaveProperty("cursor");
    }
  });

  it("con un orden no válido, el error es del orden (el cursor no se lee)", () => {
    const fieldErrors = errors({
      orden: "x",
      cursor: encodeRoomSearchCursor(cursors.recientes),
    });
    expect(fieldErrors).toHaveProperty("orden");
    expect(fieldErrors).not.toHaveProperty("cursor");
  });
});

describe("URL de la búsqueda", () => {
  it("rutas públicas de la ciudad y del detalle", () => {
    expect(roomSearchPath("barcelona")).toBe("/barcelona/habitaciones");
    expect(publicRoomPath("barcelona", ID)).toBe(`/barcelona/habitaciones/${ID}`);
  });

  it("sin filtros: la ruta canónica, sin `?`", () => {
    expect(roomSearchHref("barcelona", EMPTY_ROOM_SEARCH_FILTERS)).toBe(
      "/barcelona/habitaciones"
    );
  });

  it("conserva los filtros y el orden al pasar de página, sin los vacíos ni el orden por defecto", () => {
    const filters = ok({
      ...EMPTY_FORM,
      barrio: ["sants", "gracia"],
      precio_max: "600",
      caracteristica: "wifi",
      mascotas: "no",
      estudiantes: "1",
      convivientes_max: "2",
      orden: "precio_desc",
    });
    const cursor = encodeRoomSearchCursor({ order: "precio_desc", value: 500, id: ID });
    const href = roomSearchHref("barcelona", filters, cursor);
    expect(href).toBe(
      `/barcelona/habitaciones?barrio=sants&barrio=gracia&precio_max=600&caracteristica=wifi&mascotas=no&estudiantes=1&convivientes_max=2&orden=precio_desc&cursor=${cursor}`
    );

    // La URL generada se vuelve a leer igual (con el cursor).
    const params = new URL(href, "http://x").searchParams;
    const raw: RawSearchParams = {};
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      raw[key] = values.length > 1 ? values : values[0];
    }
    expect(ok(raw)).toEqual({
      ...filters,
      cursor: decodeRoomSearchCursor(cursor, "precio_desc"),
    });
  });

  it("«Más recientes» no aparece en la URL; los otros órdenes sí", () => {
    expect(roomSearchHref("barcelona", { ...EMPTY_ROOM_SEARCH_FILTERS })).not.toContain(
      "orden"
    );
    expect(
      roomSearchHref("barcelona", {
        ...EMPTY_ROOM_SEARCH_FILTERS,
        order: "disponibilidad",
      })
    ).toBe("/barcelona/habitaciones?orden=disponibilidad");
  });
});
