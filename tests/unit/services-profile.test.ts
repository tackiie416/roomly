import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeOnboarding,
  createProfile,
  getProfileState,
  updateProfile,
  type OwnProfile,
} from "@/lib/services/profile";
import {
  createFakeSupabase,
  dbError,
  writePayloads,
  type Call,
} from "./helpers/fake-supabase";

const USER = "11111111-2222-4333-8444-555555555555";
const PROTECTED = [
  "role",
  "deleted_at",
  "created_at",
  "updated_at",
  "onboarding_completed_at",
];

const input = {
  full_name: "  Ana   García ",
  date_of_birth: "2000-05-10",
  seeking_status: "looking_for_room",
  bio: "Hola",
};

function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    id: USER,
    full_name: "Ana García",
    date_of_birth: "2000-05-10",
    bio: "Hola",
    seeking_status: "looking_for_room",
    email_notifications_enabled: true,
    onboarding_completed_at: null,
    deleted_at: null,
    ...overrides,
  };
}

const isRead = (call: Call, table: string) =>
  call.table === table && call.operation === "select";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getProfileState", () => {
  it("sin sesión → unauthenticated, sin tocar la base de datos", async () => {
    const { client, calls } = createFakeSupabase({ userId: null });
    expect(await getProfileState(client)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(calls).toHaveLength(0);
  });

  it("sin fila propia → no_profile", async () => {
    const { client, calls } = createFakeSupabase({ userId: USER });
    expect(await getProfileState(client)).toEqual({
      ok: true,
      data: { status: "no_profile" },
    });
    expect(calls[0]).toMatchObject({
      table: "profiles",
      filters: [{ kind: "eq", column: "id", value: USER }],
    });
  });

  it("proyecta columnas explícitas, sin role ni *", async () => {
    const { client, calls } = createFakeSupabase({ userId: USER });
    await getProfileState(client);
    expect(calls[0].columns).not.toContain("*");
    expect(calls[0].columns).not.toContain("role");
    expect(calls[0].columns).toContain("deleted_at");
  });

  it("deleted_at con valor → deleted, sin consultar preferencias (tiene prioridad)", async () => {
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: () => ({
        data: profile({
          deleted_at: "2026-09-01T00:00:00Z",
          onboarding_completed_at: "2026-08-01",
        }),
        error: null,
      }),
    });
    expect(await getProfileState(client)).toEqual({
      ok: true,
      data: { status: "deleted" },
    });
    expect(calls.some((call) => call.table === "housing_preferences")).toBe(false);
  });

  it("onboarding sin completar → incomplete, con hasPreferences", async () => {
    for (const hasRow of [true, false]) {
      const { client } = createFakeSupabase({
        userId: USER,
        respond: (call) =>
          call.table === "profiles"
            ? { data: profile(), error: null }
            : { data: hasRow ? { profile_id: USER } : null, error: null },
      });
      expect(await getProfileState(client)).toEqual({
        ok: true,
        data: { status: "incomplete", profile: profile(), hasPreferences: hasRow },
      });
    }
  });

  it("onboarding completado → complete, sin consultar preferencias", async () => {
    const done = profile({ onboarding_completed_at: "2026-09-20T10:00:00Z" });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: () => ({ data: done, error: null }),
    });
    expect(await getProfileState(client)).toEqual({
      ok: true,
      data: { status: "complete", profile: done },
    });
    expect(calls).toHaveLength(1);
  });

  it("error de lectura → unknown, sin mensaje crudo", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: () => dbError("08006", "connection failure: detalles internos"),
    });
    expect(await getProfileState(client)).toEqual({ ok: false, error: "unknown" });
  });
});

describe("createProfile", () => {
  it("sin sesión → unauthenticated", async () => {
    const { client, calls } = createFakeSupabase({ userId: null });
    expect(await createProfile(client, input)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(calls).toHaveLength(0);
  });

  it("entrada inválida → validation con fieldErrors, sin escribir", async () => {
    const { client, calls } = createFakeSupabase({ userId: USER });
    const result = await createProfile(client, {
      ...input,
      full_name: "",
      role: "admin",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("validation");
    expect(result.fieldErrors?.full_name).toBeDefined();
    expect(result.fieldErrors?._form?.[0]).toContain("role");
    expect(calls).toHaveLength(0);
  });

  it("INSERT con id de la sesión, datos normalizados y sin campos protegidos", async () => {
    const created = profile();
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: () => ({ data: created, error: null }),
    });
    expect(await createProfile(client, input)).toEqual({ ok: true, data: created });

    expect(calls).toHaveLength(1);
    expect(calls[0].operation).toBe("insert");
    expect(calls[0].payload).toEqual({
      id: USER,
      full_name: "Ana García",
      date_of_birth: "2000-05-10",
      seeking_status: "looking_for_room",
      bio: "Hola",
    });
    for (const key of PROTECTED) expect(calls[0].payload).not.toHaveProperty(key);
  });

  it("nunca acepta un id del input (se rechaza como clave desconocida)", async () => {
    const { client, calls } = createFakeSupabase({ userId: USER });
    const result = await createProfile(client, { ...input, id: "otro-usuario" });
    expect(result).toMatchObject({ ok: false, error: "validation" });
    expect(calls).toHaveLength(0);
  });

  it("23505 → relee y hace UPDATE solo de los campos permitidos (sin id)", async () => {
    const updated = profile({ full_name: "Ana García" });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: (call) => {
        if (call.operation === "insert") return dbError("23505", "duplicate key value");
        if (call.operation === "select")
          return { data: profile({ full_name: "Viejo" }), error: null };
        return { data: updated, error: null };
      },
    });
    expect(await createProfile(client, input)).toEqual({ ok: true, data: updated });

    expect(calls.map((call) => call.operation)).toEqual(["insert", "select", "update"]);
    const update = calls[2];
    expect(update.filters).toEqual([{ kind: "eq", column: "id", value: USER }]);
    expect(update.payload).not.toHaveProperty("id");
    for (const key of PROTECTED) expect(update.payload).not.toHaveProperty(key);
  });

  it("23505 con perfil eliminado → deleted, sin UPDATE (no se reactiva)", async () => {
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: (call) =>
        call.operation === "insert"
          ? dbError("23505")
          : { data: profile({ deleted_at: "2026-09-01T00:00:00Z" }), error: null },
    });
    expect(await createProfile(client, input)).toEqual({ ok: false, error: "deleted" });
    expect(calls.some((call) => call.operation === "update")).toBe(false);
  });

  it("23514 → validation (con el campo si se reconoce la constraint)", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: () =>
        dbError(
          "23514",
          'new row for relation "profiles" violates check constraint "chk_min_age"'
        ),
    });
    expect(await createProfile(client, input)).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { date_of_birth: ["Tienes que tener al menos 18 años"] },
    });
  });

  it("23514 de una constraint no reconocida → validation sin exponer el mensaje", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: () => dbError("23514", "constraint interna"),
    });
    expect(await createProfile(client, input)).toEqual({
      ok: false,
      error: "validation",
    });
  });

  it("42501 → forbidden", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: () => dbError("42501", "new row violates row-level security policy"),
    });
    expect(await createProfile(client, input)).toEqual({ ok: false, error: "forbidden" });
  });

  it("error desconocido → unknown", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: () => dbError("XX000", "internal error"),
    });
    expect(await createProfile(client, input)).toEqual({ ok: false, error: "unknown" });
  });
});

describe("updateProfile", () => {
  it("sin sesión → unauthenticated", async () => {
    const { client } = createFakeSupabase({ userId: null });
    expect(await updateProfile(client, { bio: "x" })).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it("sin perfil → no_profile, sin UPDATE", async () => {
    const { client, calls } = createFakeSupabase({ userId: USER });
    expect(await updateProfile(client, { bio: "x" })).toEqual({
      ok: false,
      error: "no_profile",
    });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("perfil eliminado → deleted, sin UPDATE (aunque RLS lo permitiría)", async () => {
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: () => ({
        data: profile({ deleted_at: "2026-09-01T00:00:00Z" }),
        error: null,
      }),
    });
    expect(await updateProfile(client, { bio: "x" })).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it.each([
    ["incomplete", null],
    ["complete", "2026-09-20T10:00:00Z"],
  ])("perfil %s → UPDATE solo con los campos enviados", async (_label, completedAt) => {
    const updated = profile({ bio: "nueva", onboarding_completed_at: completedAt });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: (call) =>
        call.operation === "select"
          ? { data: profile({ onboarding_completed_at: completedAt }), error: null }
          : { data: updated, error: null },
    });
    expect(await updateProfile(client, { bio: "  nueva " })).toEqual({
      ok: true,
      data: updated,
    });
    const update = writePayloads(calls)[0];
    expect(update.payload).toEqual({ bio: "nueva" });
    expect(update.filters).toEqual([{ kind: "eq", column: "id", value: USER }]);
  });

  it("rechaza campos protegidos en la entrada, sin UPDATE", async () => {
    for (const key of ["id", ...PROTECTED]) {
      const { client, calls } = createFakeSupabase({
        userId: USER,
        respond: () => ({ data: profile(), error: null }),
      });
      const result = await updateProfile(client, { bio: "x", [key]: "admin" });
      expect(result).toMatchObject({ ok: false, error: "validation" });
      expect(writePayloads(calls)).toHaveLength(0);
    }
  });

  it("23514 de la base de datos → validation con el campo", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: (call) =>
        call.operation === "select"
          ? { data: profile(), error: null }
          : dbError("23514", 'violates check constraint "chk_profiles_bio_length"'),
    });
    expect(await updateProfile(client, { bio: "x" })).toMatchObject({
      ok: false,
      error: "validation",
      fieldErrors: { bio: expect.any(Array) },
    });
  });
});

describe("completeOnboarding", () => {
  function respondWith(options: {
    profile?: OwnProfile | null;
    preferences?: { city_id: string | null } | null;
    completed?: OwnProfile | null;
  }) {
    return (call: Call) => {
      if (isRead(call, "profiles")) return { data: options.profile ?? null, error: null };
      if (isRead(call, "housing_preferences"))
        return { data: options.preferences ?? null, error: null };
      return { data: options.completed ?? null, error: null };
    };
  }

  it("sin sesión → unauthenticated", async () => {
    const { client } = createFakeSupabase({ userId: null });
    expect(await completeOnboarding(client)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it("sin perfil → no_profile; perfil eliminado → deleted", async () => {
    const none = createFakeSupabase({
      userId: USER,
      respond: respondWith({ profile: null }),
    });
    expect(await completeOnboarding(none.client)).toEqual({
      ok: false,
      error: "no_profile",
    });

    const gone = createFakeSupabase({
      userId: USER,
      respond: respondWith({ profile: profile({ deleted_at: "2026-09-01T00:00:00Z" }) }),
    });
    expect(await completeOnboarding(gone.client)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(writePayloads(gone.calls)).toHaveLength(0);
  });

  it("sin fila de preferencias → validation", async () => {
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: respondWith({ profile: profile(), preferences: null }),
    });
    expect(await completeOnboarding(client)).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { housing_preferences: ["Faltan tus preferencias de vivienda"] },
    });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("preferencias sin ciudad → validation", async () => {
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: respondWith({ profile: profile(), preferences: { city_id: null } }),
    });
    expect(await completeOnboarding(client)).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { city_id: ["Elige una ciudad"] },
    });
    expect(writePayloads(calls)).toHaveLength(0);
  });

  it("con los mínimos → fija onboarding_completed_at en el servidor, solo si seguía nulo", async () => {
    const completed = profile({ onboarding_completed_at: "2026-09-29T12:00:00.000Z" });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: respondWith({
        profile: profile(),
        preferences: { city_id: "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21" },
        completed,
      }),
    });
    expect(await completeOnboarding(client)).toEqual({ ok: true, data: completed });

    const [update] = writePayloads(calls);
    expect(update.table).toBe("profiles");
    expect(update.payload).toEqual({
      onboarding_completed_at: "2026-09-29T12:00:00.000Z",
    });
    expect(update.filters).toEqual([
      { kind: "eq", column: "id", value: USER },
      { kind: "is", column: "onboarding_completed_at", value: null },
    ]);
  });

  it("no exige universidad, presupuesto, fechas, barrios, compañeros ni estudios", async () => {
    const { client } = createFakeSupabase({
      userId: USER,
      respond: respondWith({
        profile: profile({ bio: null }),
        preferences: { city_id: "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21" },
        completed: profile({ onboarding_completed_at: "2026-09-29T12:00:00.000Z" }),
      }),
    });
    expect((await completeOnboarding(client)).ok).toBe(true);
  });

  it("ya completo → devuelve el perfil sin escribir (idempotente)", async () => {
    const done = profile({ onboarding_completed_at: "2026-09-20T10:00:00Z" });
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: respondWith({ profile: done }),
    });
    expect(await completeOnboarding(client)).toEqual({ ok: true, data: done });
    expect(writePayloads(calls)).toHaveLength(0);
    expect(calls.some((call) => call.table === "housing_preferences")).toBe(false);
  });

  it("si otra petición lo completó a la vez, devuelve ese perfil sin pisar el timestamp", async () => {
    const first = profile({ onboarding_completed_at: "2026-09-29T11:59:59Z" });
    let profileReads = 0;
    const { client, calls } = createFakeSupabase({
      userId: USER,
      respond: (call) => {
        if (isRead(call, "profiles")) {
          profileReads += 1;
          return { data: profileReads === 1 ? profile() : first, error: null };
        }
        if (isRead(call, "housing_preferences"))
          return { data: { city_id: "c" }, error: null };
        return { data: null, error: null }; // el UPDATE condicionado no afecta a ninguna fila
      },
    });
    expect(await completeOnboarding(client)).toEqual({ ok: true, data: first });
    expect(writePayloads(calls)).toHaveLength(1);
  });
});
