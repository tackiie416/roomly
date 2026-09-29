import { describe, expect, it } from "vitest";
import {
  formDataToObject,
  formDataValues,
  type FormFields,
} from "@/lib/validation/form-data";
import { profileCreateSchema } from "@/lib/validation/profile";
import { housingPreferencesOnboardingSchema } from "@/lib/validation/housing-preferences";

const PROFILE: FormFields = {
  full_name: "text",
  date_of_birth: "text",
  seeking_status: "text",
};
const PREFERENCES: FormFields = {
  city_id: "text",
  university_id: "text",
  field_of_study: "text",
  budget_min: "number",
  budget_max: "number",
  move_in_date: "text",
  move_out_date: "text",
  preferred_neighborhood_ids: "list",
  roommates_wanted_min: "number",
  roommates_wanted_max: "number",
};

const CITY = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const N1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const N2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

function form(entries: Array<[string, string | Blob]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("formDataToObject — conversión", () => {
  it("texto tal cual (la validación decide), sin tipos del navegador", () => {
    expect(
      formDataToObject(
        form([
          ["full_name", "  Ana  "],
          ["date_of_birth", "2000-05-10"],
          ["seeking_status", "flexible"],
        ]),
        PROFILE,
        { emptyAs: "omit" }
      )
    ).toEqual({
      full_name: "  Ana  ",
      date_of_birth: "2000-05-10",
      seeking_status: "flexible",
    });
  });

  it("números: solo se convierten si el texto es numérico", () => {
    const result = formDataToObject(
      form([
        ["budget_min", "300"],
        ["budget_max", "15000"],
        ["roommates_wanted_min", "abc"],
        ["roommates_wanted_max", "2.5"],
      ]),
      PREFERENCES,
      { emptyAs: "omit" }
    );
    expect(result.budget_min).toBe(300);
    expect(result.budget_max).toBe(15000);
    expect(result.roommates_wanted_min).toBe("abc"); // la validación lo rechazará
    expect(result.roommates_wanted_max).toBe(2.5); // decimal: la validación lo rechazará
  });

  it("vacío → se omite ('omit') o null ('null')", () => {
    const data = form([
      ["city_id", ""],
      ["budget_min", "   "],
    ]);
    expect(formDataToObject(data, PREFERENCES, { emptyAs: "omit" })).toEqual({});
    const asNull = formDataToObject(data, PREFERENCES, { emptyAs: "null" });
    expect(asNull.city_id).toBeNull();
    expect(asNull.budget_min).toBeNull();
  });

  it("listas: todos los valores, sin vacíos; ausente → [] con 'null' y omitida con 'omit'", () => {
    const data = form([
      ["preferred_neighborhood_ids", N1],
      ["preferred_neighborhood_ids", ""],
      ["preferred_neighborhood_ids", N2],
    ]);
    expect(
      formDataToObject(data, PREFERENCES, { emptyAs: "null" }).preferred_neighborhood_ids
    ).toEqual([N1, N2]);
    expect(
      formDataToObject(form([]), PREFERENCES, { emptyAs: "null" })
        .preferred_neighborhood_ids
    ).toEqual([]);
    expect(
      formDataToObject(form([]), PREFERENCES, { emptyAs: "omit" })
    ).not.toHaveProperty("preferred_neighborhood_ids");
  });

  it("un campo escalar repetido no se reduce a uno de sus valores", () => {
    const result = formDataToObject(
      form([
        ["seeking_status", "flexible"],
        ["seeking_status", "looking_for_room"],
      ]),
      PROFILE,
      { emptyAs: "omit" }
    );
    expect(result.seeking_status).toEqual(["flexible", "looking_for_room"]);
    expect(
      profileCreateSchema.safeParse({
        ...result,
        full_name: "A",
        date_of_birth: "2000-01-01",
      }).success
    ).toBe(false);
  });

  it("claves inyectadas se conservan para que el esquema strict las rechace", () => {
    const result = formDataToObject(
      form([
        ["full_name", "Ana"],
        ["date_of_birth", "2000-05-10"],
        ["seeking_status", "flexible"],
        ["role", "admin"],
        ["profile_id", "otro"],
        ["onboarding_completed_at", "2026-01-01"],
        ["deleted_at", ""],
      ]),
      PROFILE,
      { emptyAs: "omit" }
    );
    expect(result).toMatchObject({
      role: "admin",
      profile_id: "otro",
      onboarding_completed_at: "2026-01-01",
    });
    expect(profileCreateSchema.safeParse(result).success).toBe(false);
  });

  it("descarta solo las claves internas de Next.js ($ACTION_...)", () => {
    const result = formDataToObject(
      form([
        ["$ACTION_ID_abc", ""],
        ["$ACTION_REF_1", ""],
        ["$ACTION_KEY", "k"],
        ["full_name", "Ana"],
      ]),
      PROFILE,
      { emptyAs: "omit" }
    );
    expect(Object.keys(result)).toEqual(["full_name"]);
  });

  it("un archivo en un campo de texto se pasa tal cual y la validación lo rechaza", () => {
    const result = formDataToObject(form([["full_name", new Blob(["x"])]]), PROFILE, {
      emptyAs: "omit",
    });
    expect(result.full_name).toBeInstanceOf(Blob);
  });
});

describe("formDataToObject + housingPreferencesOnboardingSchema", () => {
  const parse = (entries: Array<[string, string]>) =>
    housingPreferencesOnboardingSchema.safeParse(
      formDataToObject(form(entries), PREFERENCES, { emptyAs: "null" })
    );

  it("solo con ciudad es válido (el resto opcional, vacío → null)", () => {
    const result = parse([
      ["city_id", CITY],
      ["university_id", ""],
      ["field_of_study", ""],
      ["budget_min", ""],
      ["budget_max", ""],
      ["move_in_date", ""],
      ["move_out_date", ""],
      ["roommates_wanted_min", ""],
      ["roommates_wanted_max", ""],
    ]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      city_id: CITY,
      university_id: null,
      field_of_study: null,
      budget_min: null,
      budget_max: null,
      move_in_date: null,
      move_out_date: null,
      preferred_neighborhood_ids: [],
      roommates_wanted_min: null,
      roommates_wanted_max: null,
    });
  });

  it("ciudad ausente o vacía → error en city_id", () => {
    for (const entries of [[], [["city_id", ""]]] as Array<Array<[string, string]>>) {
      const result = parse(entries);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
        "city_id"
      );
    }
  });

  it("valores opcionales válidos y grandes (sin techos)", () => {
    const result = parse([
      ["city_id", CITY],
      ["budget_min", "5000"],
      ["budget_max", "25000"],
      ["roommates_wanted_min", "12"],
      ["roommates_wanted_max", "20"],
      ["move_in_date", "2026-10-01"],
      ["move_out_date", "2027-06-30"],
      ["preferred_neighborhood_ids", N1],
      ["preferred_neighborhood_ids", N1],
    ]);
    expect(result.success).toBe(true);
    expect(result.data?.budget_max).toBe(25000);
    expect(result.data?.preferred_neighborhood_ids).toEqual([N1]);
  });

  it("texto no numérico o negativo en un número → error de campo", () => {
    expect(
      parse([
        ["city_id", CITY],
        ["budget_min", "mucho"],
      ]).success
    ).toBe(false);
    expect(
      parse([
        ["city_id", CITY],
        ["budget_min", "-1"],
      ]).success
    ).toBe(false);
    expect(
      parse([
        ["city_id", CITY],
        ["roommates_wanted_min", "1.5"],
      ]).success
    ).toBe(false);
  });

  it("rechaza profile_id y onboarding_completed_at inyectados", () => {
    expect(
      parse([
        ["city_id", CITY],
        ["profile_id", CITY],
      ]).success
    ).toBe(false);
    expect(
      parse([
        ["city_id", CITY],
        ["onboarding_completed_at", "2026-01-01"],
      ]).success
    ).toBe(false);
  });
});

describe("formDataValues", () => {
  it("devuelve solo los campos conocidos, como texto", () => {
    const values = formDataValues(
      form([
        ["full_name", "Ana"],
        ["role", "admin"],
        ["preferred_neighborhood_ids", N1],
      ]),
      { ...PROFILE, preferred_neighborhood_ids: "list" }
    );
    expect(values).toEqual({ full_name: "Ana", preferred_neighborhood_ids: [N1] });
  });
});
