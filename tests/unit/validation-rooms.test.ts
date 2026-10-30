import { describe, expect, it } from "vitest";
import { formDataToObject } from "@/lib/validation/form-data";
import {
  OWNER_ROOM_STATUSES,
  ROOM_FEATURE_KEYS,
  ROOM_FEATURES,
  ROOM_FORM_FIELDS,
  ROOM_PUBLICATION_REQUIRED_FIELDS,
  ROOM_TEXT_LIMITS,
  ROOM_WRITABLE_COLUMNS,
  missingPublicationFields,
  roomCreateSchema,
  roomFeatureLabel,
  roomFeaturesSchema,
  roomStatusChangeSchema,
  roomUpdateSchema,
  totalRoommatesSchema,
  totalRoomsSchema,
} from "@/lib/validation/rooms";

describe("ROOM_FEATURES — catálogo cerrado (R6)", () => {
  it("es exactamente la lista aprobada, con sus claves y etiquetas, en ese orden", () => {
    expect(ROOM_FEATURES).toEqual([
      { key: "wifi", label: "Wi-Fi" },
      { key: "heating", label: "Calefacción" },
      { key: "air_conditioning", label: "Aire acondicionado" },
      { key: "elevator", label: "Ascensor" },
      { key: "washing_machine", label: "Lavadora" },
      { key: "dishwasher", label: "Lavavajillas" },
      { key: "balcony", label: "Terraza o balcón" },
      { key: "furnished", label: "Amueblada" },
      { key: "private_bathroom", label: "Baño privado" },
      { key: "double_bed", label: "Cama doble" },
      { key: "desk", label: "Escritorio" },
      { key: "exterior", label: "Exterior" },
    ]);
  });

  it("no repite claves ni incluye los campos booleanos propios", () => {
    expect(new Set(ROOM_FEATURE_KEYS).size).toBe(ROOM_FEATURE_KEYS.length);
    for (const key of ["pets_allowed", "smoking_allowed", "students_only"]) {
      expect(ROOM_FEATURE_KEYS).not.toContain(key);
    }
  });

  it("da la etiqueta de cada clave", () => {
    for (const { key, label } of ROOM_FEATURES) expect(roomFeatureLabel(key)).toBe(label);
  });
});

describe("roomFeaturesSchema", () => {
  it("acepta cada clave del catálogo, todas a la vez y la lista vacía", () => {
    for (const key of ROOM_FEATURE_KEYS) {
      expect(roomFeaturesSchema.parse([key])).toEqual([key]);
    }
    expect(roomFeaturesSchema.parse([...ROOM_FEATURE_KEYS])).toEqual(ROOM_FEATURE_KEYS);
    expect(roomFeaturesSchema.parse([])).toEqual([]);
  });

  it("rechaza claves desconocidas, con otras mayúsculas o que no son texto", () => {
    for (const value of [["pool"], ["WiFi"], ["wifi", "pets_allowed"], [null], [1]]) {
      expect(roomFeaturesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rechaza lo que no es una lista", () => {
    for (const value of ["wifi", null, undefined, { wifi: true }]) {
      expect(roomFeaturesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("quita las repetidas y conserva el orden de llegada", () => {
    expect(roomFeaturesSchema.parse(["desk", "wifi", "desk", "wifi"])).toEqual([
      "desk",
      "wifi",
    ]);
  });
});

describe("ocupación (R9)", () => {
  it("total_roommates: entero ≥ 0", () => {
    expect(totalRoommatesSchema.parse(0)).toBe(0);
    expect(totalRoommatesSchema.parse(3)).toBe(3);
    for (const value of [-1, 1.5, "2", 2 ** 31, null]) {
      expect(totalRoommatesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("total_rooms: entero ≥ 1", () => {
    expect(totalRoomsSchema.parse(1)).toBe(1);
    expect(totalRoomsSchema.parse(4)).toBe(4);
    for (const value of [0, -2, 2.5, "3", 2 ** 31, null]) {
      expect(totalRoomsSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("requisitos de publicación (R7)", () => {
  it("son el barrio y la ocupación", () => {
    expect(ROOM_PUBLICATION_REQUIRED_FIELDS).toEqual([
      "neighborhood_id",
      "total_roommates",
      "total_rooms",
    ]);
  });
});

// ---------------------------------------------------------------- CRUD (sesión 68)

const CITY = "11111111-1111-4111-8111-111111111111";
const HOOD = "55555555-5555-4555-8555-555555555555";
const ROOM = "22222222-3333-4444-8555-666666666666";

/** Lo mínimo para crear un borrador. */
const minimal = {
  title: "  Habitación en Gràcia  ",
  city_id: CITY,
  price_month: 450,
  available_from: "2026-11-01",
  students_only: false,
};

const errorsOf = (schema: typeof roomCreateSchema, input: unknown) => {
  const parsed = schema.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0] ?? "_"), i.message])
      );
};

describe("roomCreateSchema y roomUpdateSchema", () => {
  for (const [name, schema] of [
    ["crear", roomCreateSchema],
    ["editar", roomUpdateSchema],
  ] as const) {
    it(`${name}: acepta lo mínimo de un borrador, recorta el título y no añade campos`, () => {
      const parsed = schema.parse(minimal);
      expect(parsed).toEqual({ ...minimal, title: "Habitación en Gràcia" });
    });

    it(`${name}: obligatorios título, ciudad, precio, fecha y students_only explícito`, () => {
      const errors = errorsOf(schema, {});
      expect(errors.title).toBe("Escribe un título");
      expect(errors.city_id).toBe("Elige una ciudad");
      expect(errors.price_month).toBe("Indica el precio al mes");
      expect(errors.available_from).toBe("Indica desde cuándo está disponible");
      expect(errors.students_only).toBe(
        "Indica si la habitación es solo para estudiantes"
      );
      expect(errorsOf(schema, { ...minimal, title: "   " }).title).toBe(
        "Escribe un título"
      );
    });

    it(`${name}: rechaza id, owner_id, status, deleted_at, approx_*, fechas y room_addresses`, () => {
      for (const key of [
        "id",
        "owner_id",
        "status",
        "deleted_at",
        "approx_lat",
        "approx_lng",
        "created_at",
        "updated_at",
        "address_exact",
        "room_addresses",
      ]) {
        const parsed = schema.safeParse({ ...minimal, [key]: "x" });
        expect(parsed.success, key).toBe(false);
        expect(parsed.error?.issues[0].message).toBe(`Campo no permitido: ${key}`);
      }
    });

    it(`${name}: precio entero > 0, depósito ≥ 0 y enteros de 32 bits`, () => {
      expect(errorsOf(schema, { ...minimal, price_month: 0 }).price_month).toBe(
        "El precio tiene que ser mayor que 0"
      );
      expect(errorsOf(schema, { ...minimal, price_month: 450.5 }).price_month).toBe(
        "Introduce un número entero válido"
      );
      expect(
        errorsOf(schema, { ...minimal, price_month: 2 ** 31 }).price_month
      ).toBeDefined();
      expect(errorsOf(schema, { ...minimal, deposit_amount: -1 }).deposit_amount).toBe(
        "No puede ser negativo"
      );
      expect(schema.parse({ ...minimal, deposit_amount: 0 }).deposit_amount).toBe(0);
    });

    it(`${name}: estancia mínima ≤ máxima, en meses ≥ 1`, () => {
      expect(
        errorsOf(schema, { ...minimal, min_stay_months: 6, max_stay_months: 3 })
          .max_stay_months
      ).toBe("La estancia máxima no puede ser menor que la mínima");
      expect(errorsOf(schema, { ...minimal, min_stay_months: 0 }).min_stay_months).toBe(
        "La estancia es de al menos 1 mes"
      );
      const ok = schema.parse({ ...minimal, min_stay_months: 3, max_stay_months: 3 });
      expect([ok.min_stay_months, ok.max_stay_months]).toEqual([3, 3]);
    });

    it(`${name}: fecha real AAAA-MM-DD, catálogo de características y ocupación`, () => {
      expect(
        errorsOf(schema, { ...minimal, available_from: "2026-02-30" }).available_from
      ).toBe("La fecha no es válida (formato AAAA-MM-DD)");
      expect(
        errorsOf(schema, { ...minimal, features: ["sauna"] }).features
      ).toBeDefined();
      expect(schema.parse({ ...minimal, features: ["wifi", "wifi"] }).features).toEqual([
        "wifi",
      ]);
      expect(errorsOf(schema, { ...minimal, total_rooms: 0 }).total_rooms).toBe(
        "La vivienda tiene que tener al menos un dormitorio"
      );
      expect(errorsOf(schema, { ...minimal, total_roommates: -1 }).total_roommates).toBe(
        "No puede ser negativo"
      );
    });

    it(`${name}: límites de longitud de los textos, en caracteres`, () => {
      for (const [field, limit] of Object.entries(ROOM_TEXT_LIMITS)) {
        const ok = { ...minimal, [field]: "é".repeat(limit) };
        expect(schema.safeParse(ok).success, field).toBe(true);
        const tooLong = { ...minimal, [field]: "é".repeat(limit + 1) };
        expect(errorsOf(schema, tooLong)[field], field).toMatch(/máximo/);
      }
    });

    it(`${name}: students_only acepta los radios ("true"/"false") o un booleano`, () => {
      expect(schema.parse({ ...minimal, students_only: "true" }).students_only).toBe(
        true
      );
      expect(schema.parse({ ...minimal, students_only: "false" }).students_only).toBe(
        false
      );
      expect(
        errorsOf(schema, { ...minimal, students_only: "on" }).students_only
      ).toBeDefined();
    });
  }

  it("ROOM_FORM_FIELDS son exactamente las columnas que escribe el CRUD", () => {
    expect(Object.keys(ROOM_FORM_FIELDS).sort()).toEqual(
      [...ROOM_WRITABLE_COLUMNS].sort()
    );
  });

  it("del formulario: vacío → null, casillas sin marcar → false, y lo inyectado se rechaza", () => {
    const form = new FormData();
    form.set("title", "Habitación");
    form.set("city_id", CITY);
    form.set("neighborhood_id", "");
    form.set("price_month", "500");
    form.set("available_from", "2026-11-01");
    form.set("students_only", "false");
    form.append("features", "wifi");
    form.set("deposit_amount", "");
    const input = formDataToObject(form, ROOM_FORM_FIELDS, { emptyAs: "null" });
    const parsed = roomCreateSchema.parse(input);
    expect(parsed).toMatchObject({
      neighborhood_id: null,
      deposit_amount: null,
      pets_allowed: false,
      smoking_allowed: false,
      expenses_included: false,
      features: ["wifi"],
      price_month: 500,
    });
    form.set("owner_id", "99999999-8888-4777-8666-555555555555");
    const injected = roomCreateSchema.safeParse(
      formDataToObject(form, ROOM_FORM_FIELDS, { emptyAs: "null" })
    );
    expect(injected.error?.issues[0].message).toBe("Campo no permitido: owner_id");
  });
});

describe("roomStatusChangeSchema (R7, opción A)", () => {
  it("acepta los cuatro estados de la propietaria", () => {
    expect(OWNER_ROOM_STATUSES).toEqual(["draft", "active", "paused", "rented"]);
    for (const status of OWNER_ROOM_STATUSES)
      expect(roomStatusChangeSchema.parse({ roomId: ROOM, status }).status).toBe(status);
  });

  it("rechaza removed (H5), estados inventados, ids no válidos y claves de más", () => {
    for (const status of ["removed", "deleted", "", null])
      expect(roomStatusChangeSchema.safeParse({ roomId: ROOM, status }).success).toBe(
        false
      );
    expect(
      roomStatusChangeSchema.safeParse({ roomId: "../x", status: "draft" }).success
    ).toBe(false);
    const extra = roomStatusChangeSchema.safeParse({
      roomId: ROOM,
      status: "draft",
      owner_id: ROOM,
    });
    expect(extra.error?.issues[0].message).toBe("Campo no permitido: owner_id");
  });
});

describe("missingPublicationFields (chk_rooms_publishable)", () => {
  it("devuelve lo que falta, en el orden de ROOM_PUBLICATION_REQUIRED_FIELDS", () => {
    expect(
      missingPublicationFields({
        neighborhood_id: null,
        total_roommates: null,
        total_rooms: null,
      })
    ).toEqual([...ROOM_PUBLICATION_REQUIRED_FIELDS]);
    expect(
      missingPublicationFields({
        neighborhood_id: HOOD,
        total_roommates: 0,
        total_rooms: 1,
      })
    ).toEqual([]);
    expect(missingPublicationFields({ neighborhood_id: HOOD, total_rooms: 2 })).toEqual([
      "total_roommates",
    ]);
  });
});
