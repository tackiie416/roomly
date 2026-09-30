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

import { submitOwnProfile } from "@/app/actions/profile";

const OTHER_USER = "99999999-8888-4777-8666-555555555555";
const RAW = "permission denied for table profiles <detalle interno>";

type Row = Record<string, unknown>;

const profileRow = (overrides: Row = {}): Row => ({
  id: TEST_USER,
  full_name: "Ana García",
  date_of_birth: "2000-05-10",
  bio: "Hola",
  seeking_status: "looking_for_room",
  email_notifications_enabled: true,
  onboarding_completed_at: "2026-09-20T10:00:00Z",
  deleted_at: null,
  ...overrides,
});

/**
 * Perfil en memoria de un solo usuario. `reads` permite que lecturas
 * sucesivas devuelvan filas distintas (p. ej. la cuenta se elimina entre el
 * guard y la escritura). El UPDATE de una cuenta eliminada no afecta a
 * ninguna fila, como `profiles_update_own` en RLS.
 */
function fakeDb(options: {
  userId?: string | null;
  profile?: Row | null;
  reads?: Array<Row | null>;
  failOn?: (call: Call) => FakeResponse["error"] | undefined;
}) {
  const db = { profile: options.profile === undefined ? profileRow() : options.profile };
  const reads = [...(options.reads ?? [])];
  const respond = (call: Call): FakeResponse => {
    const injected = options.failOn?.(call);
    if (injected) return { data: null, error: injected };
    if (call.table === "profiles" && call.operation === "update") {
      if (!db.profile || db.profile.deleted_at !== null)
        return { data: null, error: { code: "PGRST116", message: RAW } };
      db.profile = { ...db.profile, ...call.payload };
      return { data: db.profile, error: null };
    }
    if (call.table === "profiles") {
      if (reads.length > 0) return { data: reads.shift() ?? null, error: null };
      return { data: db.profile, error: null };
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
  data.append("$ACTION_ID_fake", ""); // clave interna de Next.js: se ignora
  return data;
}

const validForm: Array<[string, string]> = [
  ["full_name", "  Ana   López "],
  ["date_of_birth", "1999-01-02"],
  ["seeking_status", "flexible"],
  ["bio", "  Me gusta cocinar "],
  ["email_notifications_enabled", "on"],
];

const withEntry = (key: string, value: string) =>
  form([...validForm.filter(([name]) => name !== key), [key, value]]);
const without = (key: string) => form(validForm.filter(([name]) => name !== key));

const writes = (calls: Call[]) => calls.filter((call) => call.operation !== "select");
const redirectsTo = (url: string) => expect.objectContaining({ url });

beforeEach(() => {
  serverMock.createClient.mockReset();
  cacheMock.revalidatePath.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});

describe("submitOwnProfile — estados", () => {
  it("sin sesión → /login?next=/perfil, sin escribir", async () => {
    const { calls } = fakeDb({ userId: null });
    await expect(submitOwnProfile({}, form(validForm))).rejects.toEqual(
      redirectsTo("/login?next=%2Fperfil")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("no_profile → paso 1 del onboarding, sin escribir", async () => {
    const { calls } = fakeDb({ profile: null });
    await expect(submitOwnProfile({}, form(validForm))).rejects.toEqual(
      redirectsTo("/bienvenida/perfil")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("cuenta eliminada → /cuenta-desactivada, sin escribir ni cambiar nada", async () => {
    const deleted = profileRow({ deleted_at: "2026-09-25T10:00:00Z" });
    const { calls, db } = fakeDb({ profile: deleted });
    await expect(submitOwnProfile({}, form(validForm))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(calls)).toHaveLength(0);
    expect(db.profile).toEqual(deleted);
  });

  it("cuenta eliminada entre el guard y la escritura → /cuenta-desactivada", async () => {
    const { calls } = fakeDb({
      reads: [profileRow(), profileRow({ deleted_at: "2026-09-30T11:59:00Z" })],
    });
    await expect(submitOwnProfile({}, form(validForm))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it.each([
    ["incompleto", null],
    ["completo", "2026-09-20T10:00:00Z"],
  ])(
    "perfil %s → guarda y devuelve éxito con lo guardado",
    async (_label, completedAt) => {
      const { calls, db } = fakeDb({
        profile: profileRow({ onboarding_completed_at: completedAt }),
      });
      const state = await submitOwnProfile({}, form(validForm));
      expect(state).toEqual({
        success: "Cambios guardados.",
        values: {
          full_name: "Ana López",
          date_of_birth: "1999-01-02",
          seeking_status: "flexible",
          bio: "Me gusta cocinar",
          email_notifications_enabled: "on",
        },
      });
      expect(writes(calls)).toHaveLength(1);
      // onboarding_completed_at no se toca al editar.
      expect(db.profile?.onboarding_completed_at).toBe(completedAt);
      expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/perfil");
    }
  );
});

describe("submitOwnProfile — escritura", () => {
  it("UPDATE con exactamente los campos editables, solo sobre la fila de la sesión", async () => {
    const { calls } = fakeDb({});
    await submitOwnProfile({}, form(validForm));
    const [update] = writes(calls);
    expect(update).toMatchObject({ table: "profiles", operation: "update" });
    expect(update.payload).toEqual({
      full_name: "Ana López",
      date_of_birth: "1999-01-02",
      seeking_status: "flexible",
      bio: "Me gusta cocinar",
      email_notifications_enabled: true,
    });
    expect(update.filters).toEqual([{ kind: "eq", column: "id", value: TEST_USER }]);
  });

  it("casilla sin marcar → email_notifications_enabled = false", async () => {
    const { db } = fakeDb({});
    const state = await submitOwnProfile({}, without("email_notifications_enabled"));
    expect(db.profile?.email_notifications_enabled).toBe(false);
    expect(state.values?.email_notifications_enabled).toBe("");
  });

  it("descripción vacía → se borra (null)", async () => {
    const { db } = fakeDb({});
    await submitOwnProfile({}, withEntry("bio", "   "));
    expect(db.profile?.bio).toBeNull();
  });

  it("nunca usa upsert ni INSERT", async () => {
    const { calls } = fakeDb({});
    await submitOwnProfile({}, form(validForm));
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });
});

describe("submitOwnProfile — campos protegidos y perfil ajeno", () => {
  it.each([
    ["id", OTHER_USER],
    ["profile_id", OTHER_USER],
    ["role", "admin"],
    ["deleted_at", ""],
    ["onboarding_completed_at", "2026-01-01T00:00:00Z"],
    ["created_at", "2020-01-01"],
    ["updated_at", "2020-01-01"],
    ["avatar_url", "https://example.com/a.png"],
  ])("%s en el formulario → rechazado, sin escribir", async (key, value) => {
    const { calls, db } = fakeDb({});
    const before = { ...db.profile };
    const state = await submitOwnProfile({}, withEntry(key, value));
    expect(writes(calls)).toHaveLength(0);
    expect(db.profile).toEqual(before);
    expect(state.formError).toContain("Campo no permitido");
    expect(state.success).toBeUndefined();
    // Lo inyectado no se devuelve para rellenar el formulario.
    expect(state.values).not.toHaveProperty(key);
  });

  it("un profile_id ajeno no cambia a quién se escribe: se rechaza y nada toca la otra fila", async () => {
    const { calls } = fakeDb({});
    await submitOwnProfile({}, withEntry("profile_id", OTHER_USER));
    expect(calls.every((call) => call.filters.every((f) => f.value !== OTHER_USER))).toBe(
      true
    );
  });
});

describe("submitOwnProfile — validación y errores", () => {
  it.each([
    ["full_name", "   ", "full_name"],
    ["full_name", "a".repeat(101), "full_name"],
    ["date_of_birth", "2010-01-01", "date_of_birth"],
    ["date_of_birth", "no-es-fecha", "date_of_birth"],
    ["bio", "b".repeat(501), "bio"],
    ["seeking_status", "otra_cosa", "seeking_status"],
    ["email_notifications_enabled", "false", "email_notifications_enabled"],
  ])(
    "%s inválido → error de campo, sin escribir y conservando lo escrito",
    async (key, value, field) => {
      const { calls } = fakeDb({});
      const state = await submitOwnProfile({}, withEntry(key, value));
      expect(writes(calls)).toHaveLength(0);
      expect(state.fieldErrors?.[field]?.length).toBeGreaterThan(0);
      expect(state.success).toBeUndefined();
      expect(state.values?.[key]).toBe(
        key === "email_notifications_enabled" ? "on" : value
      );
    }
  );

  it("sin seeking_status (ningún radio enviado) → no se toca: se conserva el guardado", async () => {
    // El formulario siempre llega con el valor actual marcado; si alguien lo
    // quita a mano, el UPDATE parcial no incluye la columna (nunca null).
    const { calls, db } = fakeDb({});
    const state = await submitOwnProfile({}, without("seeking_status"));
    expect(writes(calls)[0].payload).not.toHaveProperty("seeking_status");
    expect(db.profile?.seeking_status).toBe("looking_for_room");
    expect(state.success).toBe("Cambios guardados.");
  });

  it("seeking_status vacío → error de campo (no se admite null)", async () => {
    const { calls } = fakeDb({});
    const state = await submitOwnProfile({}, withEntry("seeking_status", ""));
    expect(writes(calls)).toHaveLength(0);
    expect(state.fieldErrors?.seeking_status).toBeDefined();
  });

  it("23514 de la base de datos → error de campo propio, sin texto de Supabase", async () => {
    fakeDb({
      failOn: (call) =>
        call.operation === "update"
          ? {
              code: "23514",
              message: 'violates check constraint "chk_profiles_bio_length"',
            }
          : undefined,
    });
    const state = await submitOwnProfile({}, form(validForm));
    expect(state.fieldErrors?.bio).toEqual([
      "La descripción admite como máximo 500 caracteres",
    ]);
    expect(JSON.stringify(state)).not.toContain("chk_profiles");
  });

  it("error desconocido de la base de datos → mensaje genérico, sin detalle interno", async () => {
    fakeDb({
      failOn: (call) =>
        call.operation === "update" ? { code: "42501", message: RAW } : undefined,
    });
    const state = await submitOwnProfile({}, form(validForm));
    expect(state.formError).toBe(
      "No hemos podido guardar los cambios. Vuelve a intentarlo en un momento."
    );
    expect(JSON.stringify(state)).not.toContain("detalle interno");
    expect(state.values?.full_name).toBe("  Ana   López ");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("RLS no afecta a ninguna fila (PGRST116) → mensaje genérico", async () => {
    fakeDb({
      failOn: (call) =>
        call.operation === "update" ? { code: "PGRST116", message: RAW } : undefined,
    });
    const state = await submitOwnProfile({}, form(validForm));
    expect(state.formError).toContain("No hemos podido guardar");
    expect(JSON.stringify(state)).not.toContain("detalle interno");
  });
});
