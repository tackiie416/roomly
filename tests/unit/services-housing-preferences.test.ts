import { describe, expect, it } from "vitest";
import {
  createHousingPreferences,
  getHousingPreferences,
  updateHousingPreferences,
  type HousingPreferences,
} from "@/lib/services/housing-preferences";
import {
  createFakeSupabase,
  dbError,
  writePayloads,
  type Call,
} from "./helpers/fake-supabase";

const USER = "11111111-2222-4333-8444-555555555555";
const CITY = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const N1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function row(overrides: Partial<HousingPreferences> = {}): HousingPreferences {
  return {
    profile_id: USER,
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
    updated_at: "2026-09-29T12:00:00Z",
    ...overrides,
  };
}

const activeProfile = { id: USER, deleted_at: null };

/** Responde a la comprobación de perfil y delega el resto en `rest`. */
function withProfile(
  rest: (call: Call) => {
    data: unknown;
    error: { code?: string; message?: string } | null;
  },
  profile: { id: string; deleted_at: string | null } | null = activeProfile
) {
  return (call: Call) => {
    if (call.table === "profiles") return { data: profile, error: null };
    // Lectura previa de checkUniversityCity: sin preferencias guardadas.
    if (isUniversityCityRead(call)) return { data: null, error: null };
    return rest(call);
  };
}

function isUniversityCityRead(call: Call): boolean {
  return (
    call.table === "housing_preferences" &&
    call.operation === "select" &&
    call.columns === "city_id, university_id"
  );
}

describe("getHousingPreferences", () => {
  it("sin sesión → unauthenticated", async () => {
    const { client, calls } = createFakeSupabase({ userId: null });
    expect(await getHousingPreferences(client)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(calls).toHaveLength(0);
  });

  it("sin perfil → no_profile; perfil eliminado → deleted", async () => {
    const none = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: null, error: null }), null),
    });
    expect(await getHousingPreferences(none.client)).toEqual({
      ok: false,
      error: "no_profile",
    });

    const gone = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: row(), error: null }), {
        id: USER,
        deleted_at: "2026-09-01",
      }),
    });
    expect(await getHousingPreferences(gone.client)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(gone.calls.some((call) => call.table === "housing_preferences")).toBe(false);
  });

  it("devuelve la fila propia (o null si no existe) con columnas explícitas", async () => {
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: row(), error: null })),
    });
    expect(await getHousingPreferences(client)).toEqual({ ok: true, data: row() });
    const read = calls.find((call) => call.table === "housing_preferences");
    expect(read?.columns).not.toContain("*");
    expect(read?.filters).toEqual([{ kind: "eq", column: "profile_id", value: USER }]);

    const empty = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: null, error: null })),
    });
    expect(await getHousingPreferences(empty.client)).toEqual({ ok: true, data: null });
  });
});

describe("createHousingPreferences", () => {
  it("sin sesión → unauthenticated", async () => {
    const { client } = createFakeSupabase({ userId: null });
    expect(await createHousingPreferences(client, { city_id: CITY })).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it("rechaza profile_id en la entrada, sin escribir", async () => {
    const { client, calls } = createFakeSupabase({ userId: USER });
    const result = await createHousingPreferences(client, {
      city_id: CITY,
      profile_id: "otro",
    });
    expect(result).toMatchObject({ ok: false, error: "validation" });
    expect(calls).toHaveLength(0);
  });

  it("sin perfil → no_profile; perfil eliminado → deleted; sin INSERT", async () => {
    for (const [profile, error] of [
      [null, "no_profile"],
      [{ id: USER, deleted_at: "2026-09-01" }, "deleted"],
    ] as const) {
      const { client, calls } = createFakeSupabase({
        userId: USER,
        respond: withProfile(() => ({ data: row(), error: null }), profile),
      });
      expect(await createHousingPreferences(client, { city_id: CITY })).toEqual({
        ok: false,
        error,
      });
      expect(writePayloads(calls)).toHaveLength(0);
    }
  });

  it("INSERT con profile_id de la sesión y datos normalizados", async () => {
    const created = row({ preferred_neighborhood_ids: [N1], budget_max: 15000 });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: created, error: null })),
    });
    const result = await createHousingPreferences(client, {
      city_id: CITY,
      budget_max: 15000,
      preferred_neighborhood_ids: [N1, N1.toUpperCase()],
      field_of_study: "  ",
    });
    expect(result).toEqual({ ok: true, data: created });

    const [insert] = writePayloads(calls);
    expect(insert.operation).toBe("insert");
    expect(insert.payload).toEqual({
      profile_id: USER,
      city_id: CITY,
      budget_max: 15000,
      preferred_neighborhood_ids: [N1],
      field_of_study: null,
    });
    expect(insert.payload).not.toHaveProperty("updated_at");
  });

  it("23505 → UPDATE de los campos enviados, sin profile_id", async () => {
    const updated = row({ budget_max: 700 });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: withProfile((call) =>
        call.operation === "insert" ? dbError("23505") : { data: updated, error: null }
      ),
    });
    expect(
      await createHousingPreferences(client, { city_id: CITY, budget_max: 700 })
    ).toEqual({
      ok: true,
      data: updated,
    });
    const update = writePayloads(calls).find((call) => call.operation === "update");
    expect(update?.payload).toEqual({ city_id: CITY, budget_max: 700 });
    expect(update?.payload).not.toHaveProperty("profile_id");
    expect(update?.filters).toEqual([{ kind: "eq", column: "profile_id", value: USER }]);
  });

  it("23503 del trigger de barrios → error de campo en los barrios", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() =>
        dbError("23503", "housing_neighborhoods: algún barrio no existe")
      ),
    });
    expect(
      await createHousingPreferences(client, {
        city_id: CITY,
        preferred_neighborhood_ids: [N1],
      })
    ).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { preferred_neighborhood_ids: ["Algún barrio no existe"] },
    });
  });

  it("23514 del trigger (barrio de otra ciudad) → error de campo en los barrios", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() =>
        dbError(
          "23514",
          "housing_neighborhoods: algún barrio no pertenece a la ciudad elegida"
        )
      ),
    });
    expect(
      await createHousingPreferences(client, {
        city_id: CITY,
        preferred_neighborhood_ids: [N1],
      })
    ).toMatchObject({
      ok: false,
      error: "validation",
      fieldErrors: {
        preferred_neighborhood_ids: ["Algún barrio no pertenece a la ciudad elegida"],
      },
    });
  });

  it("23503 de la FK de ciudad → error de campo en city_id", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() =>
        dbError(
          "23503",
          'insert or update on table "housing_preferences" violates foreign key constraint "housing_preferences_city_id_fkey"'
        )
      ),
    });
    expect(await createHousingPreferences(client, { city_id: CITY })).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { city_id: ["La ciudad no existe"] },
    });
  });

  it("23503 de la FK de profile_id → no_profile", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() =>
        dbError(
          "23503",
          'violates foreign key constraint "housing_preferences_profile_id_fkey"'
        )
      ),
    });
    expect(await createHousingPreferences(client, { city_id: CITY })).toEqual({
      ok: false,
      error: "no_profile",
    });
  });

  it("42501 → forbidden; error desconocido → unknown", async () => {
    for (const [code, error] of [
      ["42501", "forbidden"],
      ["XX000", "unknown"],
    ] as const) {
      const { client } = createFakeSupabase({
        userId: USER,
        respond: withProfile(() => dbError(code, "detalle interno")),
      });
      expect(await createHousingPreferences(client, { city_id: CITY })).toEqual({
        ok: false,
        error,
      });
    }
  });
});

describe("updateHousingPreferences", () => {
  it("exige al menos un campo y rechaza profile_id", async () => {
    const { client, calls } = createFakeSupabase({ userId: USER });
    expect(await updateHousingPreferences(client, {})).toMatchObject({
      ok: false,
      error: "validation",
    });
    expect(await updateHousingPreferences(client, { profile_id: USER })).toMatchObject({
      ok: false,
      error: "validation",
    });
    expect(calls).toHaveLength(0);
  });

  it("UPDATE sin profile_id, filtrado por la sesión", async () => {
    const updated = row({ roommates_wanted_min: 11, roommates_wanted_max: 14 });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: updated, error: null })),
    });
    expect(
      await updateHousingPreferences(client, {
        roommates_wanted_min: 11,
        roommates_wanted_max: 14,
      })
    ).toEqual({ ok: true, data: updated });
    const [update] = writePayloads(calls);
    expect(update.payload).toEqual({
      roommates_wanted_min: 11,
      roommates_wanted_max: 14,
    });
    expect(update.filters).toEqual([{ kind: "eq", column: "profile_id", value: USER }]);
  });

  it("sin fila que actualizar → not_found", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: null, error: null })),
    });
    expect(await updateHousingPreferences(client, { budget_max: 500 })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("perfil eliminado → deleted, sin UPDATE", async () => {
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() => ({ data: row(), error: null }), {
        id: USER,
        deleted_at: "2026-09-01",
      }),
    });
    expect(await updateHousingPreferences(client, { budget_max: 500 })).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("cambiar de ciudad dejando barrios de la anterior (23514 del trigger) → error de campo", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() =>
        dbError(
          "23514",
          "housing_neighborhoods: algún barrio no pertenece a la ciudad elegida"
        )
      ),
    });
    expect(await updateHousingPreferences(client, { city_id: CITY })).toMatchObject({
      ok: false,
      error: "validation",
      fieldErrors: { preferred_neighborhood_ids: expect.any(Array) },
    });
  });

  it("borrar la ciudad con barrios guardados (23514 sin ciudad) → error de campo en city_id", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() =>
        dbError("23514", "housing_neighborhoods: no se pueden elegir barrios sin ciudad")
      ),
    });
    expect(await updateHousingPreferences(client, { city_id: null })).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { city_id: ["Elige una ciudad para poder elegir barrios"] },
    });
  });

  it("rango incoherente con el valor guardado (23514 del CHECK) → error de campo", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: withProfile(() =>
        dbError("23514", 'violates check constraint "chk_budget_range"')
      ),
    });
    expect(await updateHousingPreferences(client, { budget_max: 100 })).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: {
        budget_max: ["El presupuesto máximo no puede ser menor que el mínimo"],
      },
    });
  });
});

describe("universidad y ciudad (Fase 2.3)", () => {
  const UNI = "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f";
  const OTHER_CITY = "4a2d7b5f-9c3e-4d2b-8f8a-3b7c6d5e4f32";

  /** Universidad `UNI` en `universityCity`; preferencias guardadas `saved`. */
  function scenario(
    universityCity: string | null,
    saved: Partial<HousingPreferences> | null = null
  ) {
    return createFakeSupabase({
      userId: USER,
      respond: (call) => {
        if (call.table === "profiles") return { data: activeProfile, error: null };
        if (call.table === "universities")
          return { data: { id: UNI, city_id: universityCity }, error: null };
        if (isUniversityCityRead(call))
          return {
            data: saved && { city_id: null, university_id: null, ...saved },
            error: null,
          };
        return { data: row({ university_id: UNI }), error: null };
      },
    });
  }

  it("universidad de otra ciudad → error de campo y no se escribe nada", async () => {
    const { client, calls } = scenario(OTHER_CITY);
    expect(
      await createHousingPreferences(client, { city_id: CITY, university_id: UNI })
    ).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { university_id: ["La universidad no pertenece a la ciudad elegida"] },
    });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("universidad con ciudad pero sin ciudad elegida → error", async () => {
    const { client, calls } = scenario(CITY);
    expect(
      await createHousingPreferences(client, { city_id: null, university_id: UNI })
    ).toMatchObject({ ok: false, error: "validation" });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("universidad de la misma ciudad o sin ciudad → se guarda", async () => {
    for (const universityCity of [CITY, null]) {
      const { client, calls } = scenario(universityCity);
      expect(
        await createHousingPreferences(client, { city_id: CITY, university_id: UNI })
      ).toMatchObject({ ok: true });
      expect(writePayloads(calls)).toHaveLength(1);
    }
  });

  it("update: cambiar solo la ciudad con una universidad guardada de la anterior → error", async () => {
    const { client, calls } = scenario(CITY, { city_id: CITY, university_id: UNI });
    expect(await updateHousingPreferences(client, { city_id: OTHER_CITY })).toMatchObject(
      {
        ok: false,
        error: "validation",
        fieldErrors: { university_id: expect.any(Array) },
      }
    );
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("update: cambiar solo la universidad se compara con la ciudad guardada", async () => {
    const { client, calls } = scenario(OTHER_CITY, { city_id: CITY });
    expect(await updateHousingPreferences(client, { university_id: UNI })).toMatchObject({
      ok: false,
      error: "validation",
    });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("sin tocar ciudad ni universidad no hay consultas extra", async () => {
    const { client, calls } = scenario(OTHER_CITY);
    await updateHousingPreferences(client, { budget_max: 700 });
    expect(calls.some((call) => call.table === "universities")).toBe(false);
    expect(calls.some(isUniversityCityRead)).toBe(false);
  });
});
