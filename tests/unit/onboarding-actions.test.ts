import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";
import { TEST_USER } from "./helpers/profile-rows";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import {
  submitOnboardingPreferences,
  submitOnboardingProfile,
} from "@/app/actions/onboarding";

const CITY = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const N1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const RAW = "duplicate key value violates unique constraint <detalle interno>";

type Row = Record<string, unknown>;

/**
 * Base de datos en memoria para un solo usuario: perfil y preferencias, con
 * `23505` en INSERT duplicado y la condición `is(onboarding_completed_at, null)`.
 * `failOn` inyecta un error en una operación concreta.
 */
function fakeDb(options: {
  userId?: string | null;
  profile?: Row | null;
  preferences?: Row | null;
  failOn?: (call: Call) => FakeResponse["error"] | undefined;
}) {
  const db = {
    profile: options.profile ?? null,
    preferences: options.preferences ?? null,
  };
  const respond = (call: Call): FakeResponse => {
    const injected = options.failOn?.(call);
    if (injected) return { data: null, error: injected };
    if (call.table === "profiles") {
      if (call.operation === "insert") {
        if (db.profile) return { data: null, error: { code: "23505", message: RAW } };
        db.profile = {
          bio: null,
          email_notifications_enabled: true,
          onboarding_completed_at: null,
          deleted_at: null,
          role: "user",
          ...call.payload,
        };
        return { data: db.profile, error: null };
      }
      if (call.operation === "update") {
        if (!db.profile) return { data: null, error: null };
        const onlyIfNull = call.filters.some(
          (f) => f.kind === "is" && f.column === "onboarding_completed_at"
        );
        if (onlyIfNull && db.profile.onboarding_completed_at !== null)
          return { data: null, error: null };
        db.profile = { ...db.profile, ...call.payload };
        return { data: db.profile, error: null };
      }
      return { data: db.profile, error: null };
    }
    if (call.table === "housing_preferences") {
      if (call.operation === "insert") {
        if (db.preferences) return { data: null, error: { code: "23505", message: RAW } };
        db.preferences = { ...call.payload };
        return { data: db.preferences, error: null };
      }
      if (call.operation === "update") {
        db.preferences = { ...db.preferences, ...call.payload };
        return { data: db.preferences, error: null };
      }
      return { data: db.preferences, error: null };
    }
    return { data: null, error: null };
  };
  const fake = createFakeSupabase({
    userId: options.userId === undefined ? TEST_USER : options.userId,
    respond,
  });
  serverMock.createClient.mockResolvedValue(fake.client);
  return { ...fake, db };
}

const profileRow = (overrides: Row = {}): Row => ({
  id: TEST_USER,
  full_name: "Ana García",
  date_of_birth: "2000-05-10",
  bio: null,
  seeking_status: "looking_for_room",
  email_notifications_enabled: true,
  onboarding_completed_at: null,
  deleted_at: null,
  ...overrides,
});

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  data.append("$ACTION_ID_fake", ""); // clave interna de Next.js: se ignora
  return data;
}

const validProfile: Array<[string, string]> = [
  ["full_name", "  Ana   García "],
  ["date_of_birth", "2000-05-10"],
  ["seeking_status", "flexible"],
];

const writes = (calls: Call[]) => calls.filter((call) => call.operation !== "select");
const redirectsTo = (url: string) => expect.objectContaining({ url });

beforeEach(() => {
  serverMock.createClient.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});

describe("submitOnboardingProfile", () => {
  it("sin sesión → /login, sin escribir", async () => {
    const { calls } = fakeDb({ userId: null });
    await expect(submitOnboardingProfile({}, form(validProfile))).rejects.toEqual(
      redirectsTo("/login")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it.each([
    ["incompleto", profileRow(), "/bienvenida/preferencias"],
    ["completo", profileRow({ onboarding_completed_at: "2026-09-20T10:00:00Z" }), "/"],
    [
      "eliminado",
      profileRow({ deleted_at: "2026-09-25T10:00:00Z" }),
      "/cuenta-desactivada",
    ],
  ])(
    "paso incorrecto (%s) → redirige, sin escribir",
    async (_label, profile, expected) => {
      const { calls } = fakeDb({ profile });
      await expect(submitOnboardingProfile({}, form(validProfile))).rejects.toEqual(
        redirectsTo(expected)
      );
      expect(writes(calls)).toHaveLength(0);
    }
  );

  it("perfil válido → INSERT con el id de la sesión y datos normalizados → preferencias", async () => {
    const { calls, db } = fakeDb({});
    await expect(submitOnboardingProfile({}, form(validProfile))).rejects.toEqual(
      redirectsTo("/bienvenida/preferencias")
    );
    const [insert] = writes(calls);
    expect(insert).toMatchObject({ table: "profiles", operation: "insert" });
    expect(insert.payload).toEqual({
      id: TEST_USER,
      full_name: "Ana García",
      date_of_birth: "2000-05-10",
      seeking_status: "flexible",
    });
    expect(db.profile?.onboarding_completed_at).toBeNull();
  });

  it("seeking_status ausente → error de campo, sin escribir (el default no cuenta)", async () => {
    const { calls } = fakeDb({});
    const state = await submitOnboardingProfile(
      {},
      form([
        ["full_name", "Ana"],
        ["date_of_birth", "2000-05-10"],
      ])
    );
    expect(state.fieldErrors?.seeking_status).toBeDefined();
    expect(writes(calls)).toHaveLength(0);
  });

  it("seeking_status inválido, nombre vacío y menor de edad → errores por campo", async () => {
    fakeDb({});
    const state = await submitOnboardingProfile(
      {},
      form([
        ["full_name", "   "],
        ["date_of_birth", "2008-10-01"],
        ["seeking_status", "otro"],
      ])
    );
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual([
      "date_of_birth",
      "full_name",
      "seeking_status",
    ]);
    expect(state.values).toEqual({
      full_name: "   ",
      date_of_birth: "2008-10-01",
      seeking_status: "otro",
    });
  });

  it.each([
    "profile_id",
    "id",
    "role",
    "deleted_at",
    "onboarding_completed_at",
    "avatar_url",
  ])("clave inyectada %s → rechazada, sin escribir y sin devolverla", async (key) => {
    const { calls } = fakeDb({});
    const state = await submitOnboardingProfile({}, form([...validProfile, [key, "x"]]));
    expect(state.formError).toContain(key);
    expect(writes(calls)).toHaveLength(0);
    expect(state.values).not.toHaveProperty(key);
  });

  it("error de base de datos → mensaje genérico, sin texto de Supabase", async () => {
    fakeDb({
      failOn: (call) =>
        call.operation === "insert" ? { code: "XX000", message: RAW } : undefined,
    });
    const state = await submitOnboardingProfile({}, form(validProfile));
    expect(state.formError).toBe(
      "No hemos podido guardar los datos. Vuelve a intentarlo en un momento."
    );
    expect(JSON.stringify(state)).not.toContain("detalle interno");
  });

  it("CHECK de edad en la base de datos → error en date_of_birth", async () => {
    fakeDb({
      failOn: (call) =>
        call.operation === "insert"
          ? { code: "23514", message: 'violates check constraint "chk_min_age"' }
          : undefined,
    });
    const state = await submitOnboardingProfile({}, form(validProfile));
    expect(state.fieldErrors?.date_of_birth).toEqual([
      "Tienes que tener al menos 18 años",
    ]);
  });
});

describe("submitOnboardingPreferences", () => {
  const withCity: Array<[string, string]> = [
    ["city_id", CITY],
    ["university_id", ""],
    ["field_of_study", "Medicina"],
    ["budget_min", ""],
    ["budget_max", "15000"],
    ["move_in_date", ""],
    ["move_out_date", ""],
    ["roommates_wanted_min", ""],
    ["roommates_wanted_max", ""],
  ];

  it("sin sesión → /login", async () => {
    fakeDb({ userId: null });
    await expect(submitOnboardingPreferences({}, form(withCity))).rejects.toEqual(
      redirectsTo("/login")
    );
  });

  it.each([
    ["sin perfil", null, "/bienvenida/perfil"],
    ["completo", profileRow({ onboarding_completed_at: "2026-09-20T10:00:00Z" }), "/"],
    [
      "eliminado",
      profileRow({ deleted_at: "2026-09-25T10:00:00Z" }),
      "/cuenta-desactivada",
    ],
  ])(
    "paso incorrecto (%s) → redirige, sin escribir",
    async (_label, profile, expected) => {
      const { calls } = fakeDb({ profile });
      await expect(submitOnboardingPreferences({}, form(withCity))).rejects.toEqual(
        redirectsTo(expected)
      );
      expect(writes(calls)).toHaveLength(0);
    }
  );

  it("flujo completo: guarda preferencias, completa el onboarding y va al test (/test, D5)", async () => {
    const { calls, db } = fakeDb({ profile: profileRow() });
    await expect(submitOnboardingPreferences({}, form(withCity))).rejects.toEqual(
      redirectsTo("/test")
    );

    const [insert, complete] = writes(calls);
    expect(insert).toMatchObject({ table: "housing_preferences", operation: "insert" });
    expect(insert.payload).toEqual({
      profile_id: TEST_USER,
      city_id: CITY,
      university_id: null,
      field_of_study: "Medicina",
      budget_min: null,
      budget_max: 15000,
      move_in_date: null,
      move_out_date: null,
      preferred_neighborhood_ids: [],
      roommates_wanted_min: null,
      roommates_wanted_max: null,
    });
    expect(complete).toMatchObject({
      table: "profiles",
      operation: "update",
      payload: { onboarding_completed_at: "2026-09-30T12:00:00.000Z" },
    });
    expect(db.profile?.onboarding_completed_at).toBe("2026-09-30T12:00:00.000Z");
  });

  it("preferencias ya existentes (otra pestaña, recarga) → UPDATE, sin duplicar", async () => {
    const { calls } = fakeDb({
      profile: profileRow(),
      preferences: { profile_id: TEST_USER, city_id: null, budget_max: 900 },
    });
    await expect(submitOnboardingPreferences({}, form(withCity))).rejects.toEqual(
      redirectsTo("/test")
    );
    const ops = writes(calls).map((call) => `${call.table}:${call.operation}`);
    expect(ops).toEqual([
      "housing_preferences:insert",
      "housing_preferences:update",
      "profiles:update",
    ]);
    const update = writes(calls)[1];
    expect(update.payload).not.toHaveProperty("profile_id");
    expect(update.payload).toMatchObject({ budget_min: null, budget_max: 15000 });
  });

  it("sin ciudad → error en city_id, sin escribir nada ni completar", async () => {
    const { calls, db } = fakeDb({ profile: profileRow() });
    const state = await submitOnboardingPreferences(
      {},
      form([
        ["city_id", ""],
        ["budget_max", "500"],
      ])
    );
    expect(state.fieldErrors?.city_id).toEqual(["Elige una ciudad"]);
    expect(writes(calls)).toHaveLength(0);
    expect(db.profile?.onboarding_completed_at).toBeNull();
  });

  it.each(["profile_id", "onboarding_completed_at", "role", "deleted_at"])(
    "clave inyectada %s → rechazada, sin escribir",
    async (key) => {
      const { calls } = fakeDb({ profile: profileRow() });
      const state = await submitOnboardingPreferences(
        {},
        form([...withCity, [key, TEST_USER]])
      );
      expect(state.formError).toContain(key);
      expect(writes(calls)).toHaveLength(0);
    }
  );

  it("mínimo > máximo → error de campo, sin escribir", async () => {
    const { calls } = fakeDb({ profile: profileRow() });
    const state = await submitOnboardingPreferences(
      {},
      form([
        ["city_id", CITY],
        ["budget_min", "900"],
        ["budget_max", "100"],
      ])
    );
    expect(state.fieldErrors?.budget_max).toBeDefined();
    expect(writes(calls)).toHaveLength(0);
  });

  it("barrio de otra ciudad (trigger) → error en barrios, sin completar", async () => {
    const { db } = fakeDb({
      profile: profileRow(),
      failOn: (call) =>
        call.table === "housing_preferences" && call.operation === "insert"
          ? {
              code: "23514",
              message:
                "housing_neighborhoods: algún barrio no pertenece a la ciudad elegida",
            }
          : undefined,
    });
    const state = await submitOnboardingPreferences(
      {},
      form([
        ["city_id", CITY],
        ["preferred_neighborhood_ids", N1],
      ])
    );
    expect(state.fieldErrors?.preferred_neighborhood_ids).toEqual([
      "Algún barrio no pertenece a la ciudad elegida",
    ]);
    expect(db.profile?.onboarding_completed_at).toBeNull();
  });

  it("error de base de datos al guardar → mensaje genérico, sin completar", async () => {
    const { calls } = fakeDb({
      profile: profileRow(),
      failOn: (call) =>
        call.table === "housing_preferences" && call.operation === "insert"
          ? { code: "XX000", message: RAW }
          : undefined,
    });
    const state = await submitOnboardingPreferences({}, form(withCity));
    expect(state.formError).toBe(
      "No hemos podido guardar los datos. Vuelve a intentarlo en un momento."
    );
    expect(writes(calls).some((call) => call.table === "profiles")).toBe(false);
    expect(JSON.stringify(state)).not.toContain("detalle interno");
  });

  it("completeOnboarding falla (trigger de completitud) → se queda en el paso, con error", async () => {
    const { db } = fakeDb({
      profile: profileRow(),
      failOn: (call) =>
        call.table === "profiles" && call.operation === "update"
          ? {
              code: "23514",
              message:
                "onboarding_incomplete: faltan las preferencias de vivienda con ciudad",
            }
          : undefined,
    });
    const state = await submitOnboardingPreferences({}, form(withCity));
    expect(state.fieldErrors?.city_id).toEqual(["Elige una ciudad para terminar"]);
    expect(db.profile?.onboarding_completed_at).toBeNull();
    expect(state.values?.city_id).toBe(CITY);
  });

  it("completeOnboarding con el perfil inválido → error general (no de un campo del paso)", async () => {
    fakeDb({ profile: profileRow({ seeking_status: "otro" }) });
    const state = await submitOnboardingPreferences({}, form(withCity));
    expect(state.formError).toBe("Elige qué estás buscando");
  });
});
