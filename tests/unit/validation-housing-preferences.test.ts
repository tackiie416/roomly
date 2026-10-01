import { describe, expect, it } from "vitest";
import {
  housingPreferencesCreateSchema,
  housingPreferencesUpdateSchema,
} from "@/lib/validation/housing-preferences";

const CITY = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const UNIVERSITY = "7d2e1f0a-3b4c-4d5e-8f6a-9b0c1d2e3f40";
const N1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const N2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

function paths(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

describe("housingPreferencesCreateSchema — identificadores", () => {
  it("acepta UUIDs válidos (y los normaliza a minúsculas)", () => {
    const parsed = housingPreferencesCreateSchema.parse({
      city_id: CITY.toUpperCase(),
      university_id: UNIVERSITY,
    });
    expect(parsed.city_id).toBe(CITY);
    expect(parsed.university_id).toBe(UNIVERSITY);
  });

  it("acepta city_id y university_id nulos", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({ city_id: null, university_id: null })
        .success
    ).toBe(true);
  });

  it("rechaza un UUID inválido", () => {
    const result = housingPreferencesCreateSchema.safeParse({ city_id: "barcelona" });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("city_id");
  });

  it("un objeto vacío es válido: city_id solo es obligatorio para completar el onboarding", () => {
    expect(housingPreferencesCreateSchema.safeParse({}).success).toBe(true);
  });
});

describe("housingPreferencesCreateSchema — presupuesto", () => {
  it("acepta 0 y valores positivos", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({ budget_min: 0, budget_max: 600 }).success
    ).toBe(true);
  });

  it("acepta valores por encima de 10 000 (no hay techo)", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({ budget_min: 12000, budget_max: 25000 })
        .success
    ).toBe(true);
  });

  it("rechaza valores negativos", () => {
    expect(housingPreferencesCreateSchema.safeParse({ budget_min: -1 }).success).toBe(
      false
    );
    expect(housingPreferencesCreateSchema.safeParse({ budget_max: -1 }).success).toBe(
      false
    );
  });

  it("rechaza decimales y valores que no caben en integer", () => {
    expect(housingPreferencesCreateSchema.safeParse({ budget_max: 450.5 }).success).toBe(
      false
    );
    expect(
      housingPreferencesCreateSchema.safeParse({ budget_max: 2 ** 31 }).success
    ).toBe(false);
  });

  it("rechaza mínimo > máximo", () => {
    const result = housingPreferencesCreateSchema.safeParse({
      budget_min: 800,
      budget_max: 700,
    });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("budget_max");
  });
});

describe("housingPreferencesCreateSchema — compañeros", () => {
  it("acepta 0 y valores positivos", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({
        roommates_wanted_min: 0,
        roommates_wanted_max: 3,
      }).success
    ).toBe(true);
  });

  it("acepta valores por encima de 10 (no hay techo)", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({
        roommates_wanted_min: 11,
        roommates_wanted_max: 15,
      }).success
    ).toBe(true);
  });

  it("rechaza negativos", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({ roommates_wanted_min: -1 }).success
    ).toBe(false);
  });

  it("rechaza mínimo > máximo", () => {
    const result = housingPreferencesCreateSchema.safeParse({
      roommates_wanted_min: 4,
      roommates_wanted_max: 2,
    });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("roommates_wanted_max");
  });
});

describe("housingPreferencesCreateSchema — fechas", () => {
  it("acepta fechas válidas, iguales o en orden", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({
        move_in_date: "2026-10-01",
        move_out_date: "2027-06-30",
      }).success
    ).toBe(true);
    expect(
      housingPreferencesCreateSchema.safeParse({
        move_in_date: "2026-10-01",
        move_out_date: "2026-10-01",
      }).success
    ).toBe(true);
  });

  it("rechaza entrada posterior a salida", () => {
    const result = housingPreferencesCreateSchema.safeParse({
      move_in_date: "2027-01-01",
      move_out_date: "2026-12-31",
    });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("move_out_date");
  });

  it("rechaza fechas inexistentes", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({ move_in_date: "2026-02-30" }).success
    ).toBe(false);
  });
});

describe("housingPreferencesCreateSchema — field_of_study", () => {
  it("acepta 120 caracteres y rechaza 121", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({ field_of_study: "e".repeat(120) })
        .success
    ).toBe(true);
    const tooLong = housingPreferencesCreateSchema.safeParse({
      field_of_study: "e".repeat(121),
    });
    expect(tooLong.success).toBe(false);
    expect(paths(tooLong)).toContain("field_of_study");
  });

  it("recorta y convierte la cadena vacía en null", () => {
    expect(
      housingPreferencesCreateSchema.parse({ field_of_study: "  Medicina " })
        .field_of_study
    ).toBe("Medicina");
    expect(
      housingPreferencesCreateSchema.parse({ field_of_study: "  " }).field_of_study
    ).toBeNull();
  });
});

describe("housingPreferencesCreateSchema — barrios", () => {
  it("elimina duplicados (también si difieren en mayúsculas)", () => {
    const parsed = housingPreferencesCreateSchema.parse({
      city_id: CITY,
      preferred_neighborhood_ids: [N1, N2, N1.toUpperCase(), N2],
    });
    expect(parsed.preferred_neighborhood_ids).toEqual([N1, N2]);
  });

  it("acepta el array vacío, con o sin ciudad", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({ preferred_neighborhood_ids: [] }).success
    ).toBe(true);
  });

  it("acepta muchos barrios (no hay límite de cantidad)", () => {
    const many = Array.from({ length: 40 }, () => crypto.randomUUID());
    expect(
      housingPreferencesCreateSchema.safeParse({
        city_id: CITY,
        preferred_neighborhood_ids: many,
      }).success
    ).toBe(true);
  });

  it("rechaza barrios sin city_id", () => {
    for (const city_id of [undefined, null]) {
      const result = housingPreferencesCreateSchema.safeParse({
        city_id,
        preferred_neighborhood_ids: [N1],
      });
      expect(result.success).toBe(false);
      expect(paths(result)).toContain("city_id");
    }
  });

  it("rechaza un UUID de barrio inválido", () => {
    expect(
      housingPreferencesCreateSchema.safeParse({
        city_id: CITY,
        preferred_neighborhood_ids: ["x"],
      }).success
    ).toBe(false);
  });
});

describe("housingPreferencesCreateSchema — claves no permitidas", () => {
  it.each(["profile_id", "updated_at", "user_id"])("rechaza %s", (key) => {
    expect(
      housingPreferencesCreateSchema.safeParse({ city_id: CITY, [key]: "x" }).success
    ).toBe(false);
  });
});

describe("housingPreferencesUpdateSchema", () => {
  it("exige al menos un campo", () => {
    expect(housingPreferencesUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("acepta barrios sin city_id en la petición (la ciudad guardada la comprueba la base de datos)", () => {
    expect(
      housingPreferencesUpdateSchema.safeParse({ preferred_neighborhood_ids: [N1] })
        .success
    ).toBe(true);
  });

  it("rechaza barrios junto con city_id: null", () => {
    expect(
      housingPreferencesUpdateSchema.safeParse({
        city_id: null,
        preferred_neighborhood_ids: [N1],
      }).success
    ).toBe(false);
  });

  it("rechaza profile_id", () => {
    expect(
      housingPreferencesUpdateSchema.safeParse({ budget_max: 500, profile_id: CITY })
        .success
    ).toBe(false);
  });

  it("aplica las mismas reglas de rango", () => {
    expect(
      housingPreferencesUpdateSchema.safeParse({ budget_min: 900, budget_max: 100 })
        .success
    ).toBe(false);
  });
});
