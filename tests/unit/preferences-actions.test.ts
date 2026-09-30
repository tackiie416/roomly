import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";
import { TEST_USER } from "./helpers/profile-rows";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: cacheMock.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { submitOwnPreferences } from "@/app/actions/housing-preferences";

const BCN = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const MAD = "4a2d7b5f-9c3e-4d2b-8f8a-3b7c6d5e4f32";
const UPC = "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f";
const UCM = "d4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f80";
const N_BCN = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const N_MAD = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const OTHER_USER = "99999999-8888-4777-8666-555555555555";
const RAW = "internal error <detalle interno>";

type Row = Record<string, unknown>;

const profileRow = (overrides: Row = {}): Row => ({
  id: TEST_USER,
  full_name: "Ana García",
  date_of_birth: "2000-05-10",
  bio: null,
  seeking_status: "looking_for_room",
  email_notifications_enabled: true,
  onboarding_completed_at: "2026-09-20T10:00:00Z",
  deleted_at: null,
  ...overrides,
});

const prefsRow = (overrides: Row = {}): Row => ({
  profile_id: TEST_USER,
  city_id: BCN,
  university_id: null,
  field_of_study: null,
  budget_min: null,
  budget_max: 700,
  move_in_date: null,
  move_out_date: null,
  preferred_neighborhood_ids: [],
  roommates_wanted_min: null,
  roommates_wanted_max: null,
  updated_at: "2026-09-29T10:00:00Z",
  ...overrides,
});

const CITIES: Record<string, { id: string; is_active: boolean }> = {
  [BCN]: { id: BCN, is_active: true },
  [MAD]: { id: MAD, is_active: false },
};
const UNIVERSITIES: Record<string, { id: string; city_id: string | null }> = {
  [UPC]: { id: UPC, city_id: BCN },
  [UCM]: { id: UCM, city_id: MAD },
};
const NEIGHBORHOOD_CITY: Record<string, string> = { [N_BCN]: BCN, [N_MAD]: MAD };

const eqValue = (call: Call, column: string) =>
  call.filters.find((f) => f.kind === "eq" && f.column === column)?.value as
    string | undefined;

/**
 * Perfil, preferencias y datos de referencia en memoria. Emula el trigger de
 * barrios (2.0) y el de universidad (2.5) para comprobar que sus errores se
 * traducen, aunque el servicio compruebe antes lo que puede.
 */
function fakeDb(options: {
  userId?: string | null;
  profile?: Row | null;
  preferences?: Row | null;
  /** Lecturas sucesivas de profiles (p. ej. la cuenta se elimina a mitad). */
  profileReads?: Array<Row | null>;
  failOn?: (call: Call) => FakeResponse["error"] | undefined;
}) {
  const profileReads = [...(options.profileReads ?? [])];
  const db = {
    profile: options.profile === undefined ? profileRow() : options.profile,
    preferences: options.preferences === undefined ? prefsRow() : options.preferences,
  };
  const triggers = (next: Row): FakeResponse["error"] | undefined => {
    const ids = (next.preferred_neighborhood_ids as string[] | undefined) ?? [];
    if (ids.some((id) => NEIGHBORHOOD_CITY[id] !== next.city_id))
      return {
        code: "23514",
        message: "housing_neighborhoods: algún barrio no pertenece a la ciudad elegida",
      };
    const university = next.university_id
      ? UNIVERSITIES[next.university_id as string]
      : undefined;
    if (university?.city_id && university.city_id !== next.city_id)
      return {
        code: "23514",
        message: "housing_university: la universidad no pertenece",
      };
    return undefined;
  };
  const respond = (call: Call): FakeResponse => {
    const injected = options.failOn?.(call);
    if (injected) return { data: null, error: injected };
    if (call.table === "profiles")
      return {
        data: profileReads.length > 0 ? (profileReads.shift() ?? null) : db.profile,
        error: null,
      };
    if (call.table === "cities")
      return { data: CITIES[eqValue(call, "id") ?? ""] ?? null, error: null };
    if (call.table === "universities")
      return { data: UNIVERSITIES[eqValue(call, "id") ?? ""] ?? null, error: null };
    if (call.table === "housing_preferences") {
      if (call.operation === "insert") {
        if (db.preferences) return { data: null, error: { code: "23505", message: RAW } };
        const next = {
          ...prefsRow({ budget_max: null, city_id: null }),
          ...call.payload,
        };
        const error = triggers(next);
        if (error) return { data: null, error };
        db.preferences = next;
        return { data: next, error: null };
      }
      if (call.operation === "update") {
        if (!db.preferences) return { data: null, error: null };
        const next = { ...db.preferences, ...call.payload };
        const error = triggers(next);
        if (error) return { data: null, error };
        db.preferences = next;
        return { data: next, error: null };
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

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  data.append("$ACTION_ID_fake", "");
  return data;
}

const fullForm: Array<[string, string]> = [
  ["city_id", BCN],
  ["university_id", UPC],
  ["field_of_study", "  Ingeniería "],
  ["budget_min", "300"],
  ["budget_max", "900"],
  ["move_in_date", "2026-10-01"],
  ["move_out_date", "2027-06-30"],
  ["preferred_neighborhood_ids", N_BCN],
  ["roommates_wanted_min", "1"],
  ["roommates_wanted_max", "3"],
];
/** Como lo envía el navegador: todos los campos de texto, vacíos si no hay valor. */
const browserForm = (entries: Array<[string, string]>) => {
  const empty = fullForm
    .filter(([name]) => name !== "preferred_neighborhood_ids")
    .map(([name]) => [name, ""] as [string, string]);
  const names = new Set(entries.map(([name]) => name));
  return form([...empty.filter(([name]) => !names.has(name)), ...entries]);
};
const withEntry = (key: string, value: string) =>
  form([...fullForm.filter(([name]) => name !== key), [key, value]]);

const writes = (calls: Call[]) => calls.filter((call) => call.operation !== "select");
const redirectsTo = (url: string) => expect.objectContaining({ url });

beforeEach(() => {
  serverMock.createClient.mockReset();
  cacheMock.revalidatePath.mockReset();
});

describe("submitOwnPreferences — estados", () => {
  it("sin sesión → /login?next=/preferencias, sin escribir", async () => {
    const { calls } = fakeDb({ userId: null });
    await expect(submitOwnPreferences({}, form(fullForm))).rejects.toEqual(
      redirectsTo("/login?next=%2Fpreferencias")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("sin perfil → paso 1 del onboarding, sin escribir", async () => {
    const { calls } = fakeDb({ profile: null });
    await expect(submitOwnPreferences({}, form(fullForm))).rejects.toEqual(
      redirectsTo("/bienvenida/perfil")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("cuenta eliminada → /cuenta-desactivada, sin escribir ni cambiar nada", async () => {
    const { calls, db } = fakeDb({
      profile: profileRow({ deleted_at: "2026-09-25T10:00:00Z" }),
    });
    const before = { ...db.preferences };
    await expect(submitOwnPreferences({}, form(fullForm))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(calls)).toHaveLength(0);
    expect(db.preferences).toEqual(before);
  });
});

describe("submitOwnPreferences — cuenta eliminada a mitad", () => {
  it("eliminada entre el guard y la escritura → /cuenta-desactivada, sin escribir", async () => {
    const { calls } = fakeDb({
      profileReads: [profileRow(), profileRow({ deleted_at: "2026-09-30T11:59:00Z" })],
    });
    await expect(submitOwnPreferences({}, form(fullForm))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("submitOwnPreferences — escritura", () => {
  it("preferencias existentes → UPDATE de la fila de la sesión, sin INSERT ni upsert", async () => {
    const { calls, db } = fakeDb({});
    const state = await submitOwnPreferences({}, form(fullForm));
    expect(state.success).toBe("Preferencias guardadas.");
    const [update, ...rest] = writes(calls);
    expect(rest).toHaveLength(0);
    expect(update).toMatchObject({ table: "housing_preferences", operation: "update" });
    expect(update.filters).toEqual([
      { kind: "eq", column: "profile_id", value: TEST_USER },
    ]);
    expect(update.payload).not.toHaveProperty("profile_id");
    expect(db.preferences).toMatchObject({
      city_id: BCN,
      university_id: UPC,
      field_of_study: "Ingeniería",
      budget_min: 300,
      budget_max: 900,
      preferred_neighborhood_ids: [N_BCN],
      roommates_wanted_max: 3,
    });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/preferencias");
  });

  it("sin preferencias → INSERT con el profile_id de la sesión", async () => {
    const { calls, db } = fakeDb({ preferences: null });
    const state = await submitOwnPreferences({}, form(fullForm));
    expect(state.success).toBe("Preferencias guardadas.");
    const insert = writes(calls).find((call) => call.operation === "insert");
    expect(insert?.payload?.profile_id).toBe(TEST_USER);
    expect(db.preferences).toMatchObject({ profile_id: TEST_USER, city_id: BCN });
  });

  it("edición parcial: vaciar opcionales los borra; sin barrios marcados → lista vacía", async () => {
    const { db } = fakeDb({
      preferences: prefsRow({
        field_of_study: "Derecho",
        preferred_neighborhood_ids: [N_BCN],
      }),
    });
    const state = await submitOwnPreferences({}, browserForm([["city_id", BCN]]));
    expect(state.success).toBeDefined();
    expect(db.preferences).toMatchObject({
      city_id: BCN,
      field_of_study: null,
      budget_max: null,
      preferred_neighborhood_ids: [],
    });
  });

  it("sin techos: presupuesto, compañeros y barrios grandes se aceptan", async () => {
    const { db } = fakeDb({});
    await submitOwnPreferences(
      {},
      form([
        ["city_id", BCN],
        ["budget_max", "250000"],
        ["roommates_wanted_max", "40"],
        ["preferred_neighborhood_ids", N_BCN],
      ])
    );
    expect(db.preferences).toMatchObject({
      budget_max: 250000,
      roommates_wanted_max: 40,
    });
  });

  it("nunca escribe en profiles (ni onboarding_completed_at ni role)", async () => {
    const { calls } = fakeDb({ profile: profileRow({ onboarding_completed_at: null }) });
    await submitOwnPreferences({}, form(fullForm));
    expect(writes(calls).every((call) => call.table === "housing_preferences")).toBe(
      true
    );
  });
});

describe("submitOwnPreferences — ciudad y onboarding (riesgo C)", () => {
  it("onboarding completado: sin ciudad → error de campo, nada guardado, lo escrito se conserva", async () => {
    const { calls, db } = fakeDb({});
    const state = await submitOwnPreferences(
      {},
      browserForm([
        ["city_id", ""],
        ["budget_max", "900"],
      ])
    );
    expect(writes(calls)).toHaveLength(0);
    expect(state.fieldErrors?.city_id?.[0]).toContain("La ciudad es obligatoria");
    expect(state.values?.budget_max).toBe("900");
    expect(db.preferences?.city_id).toBe(BCN);
  });

  it("sin ciudad pero con barrios marcados → error en la ciudad, sin escribir", async () => {
    const { calls } = fakeDb({});
    const state = await submitOwnPreferences({}, withEntry("city_id", ""));
    expect(writes(calls)).toHaveLength(0);
    expect(state.fieldErrors?.city_id).toBeDefined();
  });

  it("un campo ausente (no enviado) no se toca: la ciudad se conserva", async () => {
    const { db } = fakeDb({});
    const state = await submitOwnPreferences({}, form([["budget_max", "650"]]));
    expect(state.success).toBeDefined();
    expect(db.preferences).toMatchObject({ city_id: BCN, budget_max: 650 });
  });

  it("onboarding sin completar: sin ciudad se guarda (todo opcional)", async () => {
    const { db } = fakeDb({ profile: profileRow({ onboarding_completed_at: null }) });
    const state = await submitOwnPreferences(
      {},
      browserForm([["field_of_study", "Derecho"]])
    );
    expect(state.success).toBeDefined();
    expect(db.preferences).toMatchObject({ city_id: null, field_of_study: "Derecho" });
  });

  it("una ciudad nueva inactiva → error de campo", async () => {
    const { calls } = fakeDb({});
    const state = await submitOwnPreferences(
      {},
      form([
        ["city_id", MAD],
        ["university_id", ""],
      ])
    );
    expect(writes(calls)).toHaveLength(0);
    expect(state.fieldErrors?.city_id).toEqual([
      "Esta ciudad todavía no está disponible",
    ]);
  });
});

describe("submitOwnPreferences — referencias de otra ciudad", () => {
  it("universidad de otra ciudad → error de campo, sin escribir", async () => {
    const { calls } = fakeDb({});
    const state = await submitOwnPreferences({}, withEntry("university_id", UCM));
    expect(writes(calls)).toHaveLength(0);
    expect(state.fieldErrors?.university_id).toEqual([
      "La universidad no pertenece a la ciudad elegida",
    ]);
  });

  it("barrio de otra ciudad → error de campo (trigger de la base de datos), nada guardado", async () => {
    const { db } = fakeDb({});
    const before = { ...db.preferences };
    const state = await submitOwnPreferences(
      {},
      withEntry("preferred_neighborhood_ids", N_MAD)
    );
    expect(state.fieldErrors?.preferred_neighborhood_ids).toEqual([
      "Algún barrio no pertenece a la ciudad elegida",
    ]);
    expect(db.preferences).toEqual(before);
    expect(JSON.stringify(state)).not.toContain("housing_");
  });

  it("UUID de ciudad mal formado → error de campo, sin escribir", async () => {
    const { calls } = fakeDb({});
    const state = await submitOwnPreferences({}, withEntry("city_id", "barcelona"));
    expect(writes(calls)).toHaveLength(0);
    expect(state.fieldErrors?.city_id).toBeDefined();
  });
});

describe("submitOwnPreferences — campos protegidos y perfil ajeno", () => {
  it.each([
    ["profile_id", OTHER_USER],
    ["role", "admin"],
    ["deleted_at", ""],
    ["onboarding_completed_at", "2026-01-01T00:00:00Z"],
    ["updated_at", "2020-01-01"],
    ["id", OTHER_USER],
  ])("%s en el formulario → rechazado, sin escribir", async (key, value) => {
    const { calls, db } = fakeDb({});
    const before = { ...db.preferences };
    const state = await submitOwnPreferences({}, withEntry(key, value));
    expect(writes(calls)).toHaveLength(0);
    expect(db.preferences).toEqual(before);
    expect(state.formError).toContain("Campo no permitido");
    expect(state.values).not.toHaveProperty(key);
  });

  it("un profile_id ajeno nunca llega a ninguna consulta", async () => {
    const { calls } = fakeDb({ preferences: null });
    await submitOwnPreferences({}, withEntry("profile_id", OTHER_USER));
    expect(
      calls.every(
        (call) =>
          call.filters.every((f) => f.value !== OTHER_USER) &&
          call.payload?.profile_id !== OTHER_USER
      )
    ).toBe(true);
  });
});

describe("submitOwnPreferences — errores de servicio", () => {
  it("error desconocido de la base de datos → mensaje genérico, sin detalle interno", async () => {
    fakeDb({
      failOn: (call) =>
        call.table === "housing_preferences" && call.operation === "update"
          ? { code: "XX000", message: RAW }
          : undefined,
    });
    const state = await submitOwnPreferences({}, form(fullForm));
    expect(state.formError).toBe(
      "No hemos podido guardar tus preferencias. Vuelve a intentarlo en un momento."
    );
    expect(JSON.stringify(state)).not.toContain("detalle interno");
    expect(state.values?.budget_max).toBe("900");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("mínimo > máximo → error de campo", async () => {
    const { calls } = fakeDb({});
    const state = await submitOwnPreferences({}, withEntry("budget_min", "5000"));
    expect(writes(calls)).toHaveLength(0);
    expect(state.fieldErrors?.budget_max).toBeDefined();
  });

  it("negativo o decimal → error de campo", async () => {
    for (const [key, value] of [
      ["budget_max", "-1"],
      ["roommates_wanted_min", "1.5"],
    ] as const) {
      const { calls } = fakeDb({});
      const state = await submitOwnPreferences({}, withEntry(key, value));
      expect(writes(calls)).toHaveLength(0);
      expect(state.fieldErrors?.[key]).toBeDefined();
    }
  });
});
