import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

import * as settingsActions from "@/app/actions/settings";
import { submitNotificationSettings } from "@/app/actions/settings";
import { signOut } from "@/app/actions/auth";
import SettingsPage from "@/app/(app)/ajustes/page";
import { SignOutButton } from "@/components/auth/sign-out-button";

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

/** Perfil en memoria; el UPDATE de una cuenta eliminada no afecta a filas (RLS). */
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
    if (call.table === "profiles")
      return {
        data: reads.length > 0 ? (reads.shift() ?? null) : db.profile,
        error: null,
      };
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

const writes = (calls: Call[]) => calls.filter((call) => call.operation !== "select");
const redirectsTo = (url: string) => expect.objectContaining({ url });

/** Todos los elementos React del árbol devuelto por la página (sin renderizar). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

beforeEach(() => {
  serverMock.createClient.mockReset();
  cacheMock.revalidatePath.mockReset();
});

describe("submitNotificationSettings — estados", () => {
  it("sin sesión → /login?next=/ajustes, sin escribir", async () => {
    const { calls } = fakeDb({ userId: null });
    await expect(submitNotificationSettings({}, form([]))).rejects.toEqual(
      redirectsTo("/login?next=%2Fajustes")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("sin perfil → paso 1 del onboarding, sin escribir", async () => {
    const { calls } = fakeDb({ profile: null });
    await expect(submitNotificationSettings({}, form([]))).rejects.toEqual(
      redirectsTo("/bienvenida/perfil")
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("cuenta eliminada → /cuenta-desactivada, sin escribir ni cambiar nada", async () => {
    const deleted = profileRow({ deleted_at: "2026-09-25T10:00:00Z" });
    const { calls, db } = fakeDb({ profile: deleted });
    await expect(submitNotificationSettings({}, form([]))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(calls)).toHaveLength(0);
    expect(db.profile).toEqual(deleted);
  });

  it("eliminada entre el guard y la escritura → /cuenta-desactivada, sin escribir", async () => {
    const { calls } = fakeDb({
      reads: [profileRow(), profileRow({ deleted_at: "2026-09-30T11:59:00Z" })],
    });
    await expect(submitNotificationSettings({}, form([]))).rejects.toEqual(
      redirectsTo("/cuenta-desactivada")
    );
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("submitNotificationSettings — escritura", () => {
  it("desmarcar → guarda false y lo devuelve; solo esa columna, fila de la sesión", async () => {
    const { calls, db } = fakeDb({});
    const state = await submitNotificationSettings({}, form([]));
    expect(state).toEqual({ success: "Ajustes guardados.", emailNotifications: "" });
    expect(db.profile?.email_notifications_enabled).toBe(false);
    const [update, ...rest] = writes(calls);
    expect(rest).toHaveLength(0);
    expect(update.payload).toEqual({ email_notifications_enabled: false });
    expect(update.filters).toEqual([{ kind: "eq", column: "id", value: TEST_USER }]);
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/ajustes");
  });

  it("marcar → guarda true", async () => {
    const { db } = fakeDb({
      profile: profileRow({ email_notifications_enabled: false }),
    });
    const state = await submitNotificationSettings(
      {},
      form([["email_notifications_enabled", "on"]])
    );
    expect(state.emailNotifications).toBe("on");
    expect(db.profile?.email_notifications_enabled).toBe(true);
  });

  it("no toca ningún otro campo del perfil ni onboarding_completed_at", async () => {
    const before = profileRow({ onboarding_completed_at: null });
    const { db } = fakeDb({ profile: before });
    await submitNotificationSettings({}, form([]));
    expect(db.profile).toEqual({ ...before, email_notifications_enabled: false });
  });
});

describe("submitNotificationSettings — entradas no permitidas", () => {
  it.each([
    ["profile_id", OTHER_USER],
    ["id", OTHER_USER],
    ["full_name", "Otro nombre"],
    ["bio", "x"],
    ["role", "admin"],
    ["deleted_at", ""],
    ["onboarding_completed_at", "2026-01-01T00:00:00Z"],
  ])("%s → rechazado, sin escribir", async (key, value) => {
    const { calls, db } = fakeDb({});
    const before = { ...db.profile };
    const state = await submitNotificationSettings(
      { emailNotifications: "on" },
      form([
        ["email_notifications_enabled", "on"],
        [key, value],
      ])
    );
    expect(writes(calls)).toHaveLength(0);
    expect(db.profile).toEqual(before);
    expect(state.formError).toContain("Campo no permitido");
    expect(state.success).toBeUndefined();
    expect(state.emailNotifications).toBe("on");
  });

  it("un profile_id ajeno nunca llega a ninguna consulta", async () => {
    const { calls } = fakeDb({});
    await submitNotificationSettings({}, form([["profile_id", OTHER_USER]]));
    expect(calls.every((call) => call.filters.every((f) => f.value !== OTHER_USER))).toBe(
      true
    );
  });

  it("valor de la casilla distinto de 'on' → rechazado", async () => {
    const { calls } = fakeDb({});
    const state = await submitNotificationSettings(
      {},
      form([["email_notifications_enabled", "false"]])
    );
    expect(writes(calls)).toHaveLength(0);
    expect(state.formError).toBeDefined();
    expect(state.success).toBeUndefined();
  });
});

describe("submitNotificationSettings — errores seguros", () => {
  it.each([
    ["error desconocido", { code: "42501", message: RAW }],
    ["RLS sin filas (PGRST116)", { code: "PGRST116", message: RAW }],
  ])("%s → mensaje genérico, sin detalle interno", async (_label, error) => {
    fakeDb({ failOn: (call) => (call.operation === "update" ? error : undefined) });
    const state = await submitNotificationSettings(
      { emailNotifications: "on" },
      form([])
    );
    expect(state.formError).toBe(
      "No hemos podido guardar tus ajustes. Vuelve a intentarlo en un momento."
    );
    expect(state.emailNotifications).toBe("on");
    expect(JSON.stringify(state)).not.toContain("detalle interno");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("app/actions/settings — sin acciones de sesión ni de borrado", () => {
  it("solo exporta submitNotificationSettings", () => {
    expect(Object.keys(settingsActions).sort()).toEqual(["submitNotificationSettings"]);
  });
});

describe("/ajustes — página", () => {
  it.each([
    ["anonymous", "/login?next=%2Fajustes"],
    ["no_profile", "/bienvenida/perfil"],
    ["deleted", "/cuenta-desactivada"],
  ] as const)("%s → %s, sin renderizar", async (fixture, expected) => {
    fakeDb(
      fixture === "anonymous"
        ? { userId: null }
        : fixture === "no_profile"
          ? { profile: null }
          : { profile: profileRow({ deleted_at: "2026-09-25T10:00:00Z" }) }
    );
    await expect(SettingsPage()).rejects.toEqual(redirectsTo(expected));
  });

  it.each([
    ["completo, avisos activados", profileRow(), true],
    [
      "incompleto, avisos desactivados",
      profileRow({ onboarding_completed_at: null, email_notifications_enabled: false }),
      false,
    ],
  ])("%s → la casilla refleja el valor guardado", async (_label, profile, enabled) => {
    fakeDb({ profile });
    const html = renderToStaticMarkup(await SettingsPage());
    const checkbox = html.match(
      /<input[^>]*name="email_notifications_enabled"[^>]*>/
    )?.[0];
    expect(checkbox).toBeDefined();
    expect(/\schecked(=""|\s|\/|>)/.test(checkbox ?? "")).toBe(enabled);
  });

  it("el logout es el SignOutButton existente (signOut de 2.2)", async () => {
    fakeDb({});
    const tree = await SettingsPage();
    expect(elements(tree).some((element) => element.type === SignOutButton)).toBe(true);
    const html = renderToStaticMarkup(<SignOutButton />);
    expect(html).toContain("Cerrar sesión");
    expect(typeof signOut).toBe("function");
  });

  it("sin borrado de cuenta ni campos protegidos", async () => {
    fakeDb({});
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).not.toMatch(/borrar|eliminar|delete/i);
    const names = [...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names)).toEqual(new Set(["email_notifications_enabled"]));
  });

  it("solo lee el perfil de la sesión, aunque lleguen ids en la URL", async () => {
    const { calls } = fakeDb({});
    const page = SettingsPage as unknown as (props: unknown) => Promise<ReactElement>;
    renderToStaticMarkup(
      await page({
        params: Promise.resolve({ id: OTHER_USER }),
        searchParams: Promise.resolve({ profile_id: OTHER_USER }),
      })
    );
    for (const call of calls.filter((c) => c.table === "profiles")) {
      expect(call.filters).toEqual([{ kind: "eq", column: "id", value: TEST_USER }]);
    }
  });
});
