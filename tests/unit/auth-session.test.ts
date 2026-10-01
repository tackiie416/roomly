import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { TEST_USER, respondAs, type ProfileFixture } from "./helpers/profile-rows";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import {
  requireAdmin,
  requireCompleteProfile,
  requireDeletedAccount,
  requireOnboardingStep,
  requireOwnProfile,
} from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/services/profile";

function as(fixture: ProfileFixture | "anonymous", role = "user") {
  const fake = createFakeSupabase({
    userId: fixture === "anonymous" ? null : TEST_USER,
    respond: respondAs(fixture === "anonymous" ? "no_profile" : fixture, role),
  });
  serverMock.createClient.mockResolvedValue(fake.client);
  return fake;
}

const redirectsTo = (url: string) => expect.objectContaining({ url });

beforeEach(() => {
  serverMock.createClient.mockReset();
});

describe("requireCompleteProfile", () => {
  it("sin sesión → /login?next=<ruta>", async () => {
    as("anonymous");
    await expect(requireCompleteProfile("/perfil")).rejects.toEqual(
      redirectsTo("/login?next=%2Fperfil")
    );
  });

  it.each([
    ["no_profile", "/bienvenida/perfil"],
    ["incomplete", "/bienvenida/preferencias"],
    ["deleted", "/cuenta-desactivada"],
  ] as const)("%s → %s", async (fixture, expected) => {
    as(fixture);
    await expect(requireCompleteProfile("/perfil")).rejects.toEqual(
      redirectsTo(expected)
    );
  });

  it("complete → devuelve el perfil propio", async () => {
    as("complete");
    await expect(requireCompleteProfile("/perfil")).resolves.toMatchObject({
      id: TEST_USER,
    });
  });

  it("error de base de datos → error genérico, sin redirigir ni exponer el mensaje", async () => {
    const fake = createFakeSupabase({
      userId: TEST_USER,
      respond: () => ({
        data: null,
        error: { code: "XX000", message: "detalle interno" },
      }),
    });
    serverMock.createClient.mockResolvedValue(fake.client);
    const error = await requireCompleteProfile("/perfil").catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("detalle interno");
    expect(error).not.toHaveProperty("url");
  });
});

describe("requireOwnProfile (/perfil, Fase 2.4)", () => {
  it("sin sesión → /login?next=/perfil", async () => {
    as("anonymous");
    await expect(requireOwnProfile()).rejects.toEqual(
      redirectsTo("/login?next=%2Fperfil")
    );
  });

  it.each([
    ["no_profile", "/bienvenida/perfil"],
    ["deleted", "/cuenta-desactivada"],
  ] as const)("%s → %s", async (fixture, expected) => {
    as(fixture);
    await expect(requireOwnProfile()).rejects.toEqual(redirectsTo(expected));
  });

  it.each(["incomplete", "complete"] as const)(
    "%s → devuelve el perfil propio (editable)",
    async (fixture) => {
      as(fixture);
      await expect(requireOwnProfile()).resolves.toMatchObject({
        status: fixture,
        profile: { id: TEST_USER },
      });
    }
  );
});

describe("requireOwnProfile: siempre el perfil de la sesión", () => {
  const OTHER_USER = "99999999-8888-4777-8666-555555555555";

  it("lee profiles solo por el id de auth.getUser()", async () => {
    const { calls } = as("complete");
    await requireOwnProfile();
    const profileReads = calls.filter((call) => call.table === "profiles");
    expect(profileReads.length).toBeGreaterThan(0);
    for (const call of profileReads) {
      expect(call.filters).toEqual([{ kind: "eq", column: "id", value: TEST_USER }]);
    }
  });

  it("/perfil ignora cualquier profile_id o id de la URL y carga el perfil propio", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: OwnProfilePage } = await import("@/app/(app)/perfil/page");
    const { calls } = as("complete");
    // La página no declara props: aunque Next.js le pasara searchParams o
    // params con otro id, no los usa.
    const page = OwnProfilePage as unknown as (
      props: unknown
    ) => Promise<React.ReactElement>;
    const html = renderToStaticMarkup(
      await page({
        params: Promise.resolve({ id: OTHER_USER }),
        searchParams: Promise.resolve({ profile_id: OTHER_USER, id: OTHER_USER }),
      })
    );
    expect(html).toContain('value="Ana García"');
    expect(calls.every((call) => call.filters.every((f) => f.value !== OTHER_USER))).toBe(
      true
    );
  });
});

describe("/perfil: la página aplica el guard antes de renderizar", () => {
  it.each([
    ["anonymous", "/login?next=%2Fperfil"],
    ["no_profile", "/bienvenida/perfil"],
    ["deleted", "/cuenta-desactivada"],
  ] as const)("%s → %s, sin renderizar el formulario", async (fixture, expected) => {
    const { default: OwnProfilePage } = await import("@/app/(app)/perfil/page");
    as(fixture);
    await expect(OwnProfilePage()).rejects.toEqual(redirectsTo(expected));
  });

  it("incompleto: formulario con sus datos y aviso para completar las preferencias", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: OwnProfilePage } = await import("@/app/(app)/perfil/page");
    as("incomplete");
    const html = renderToStaticMarkup(await OwnProfilePage());
    expect(html).toContain('value="Ana García"');
    expect(html).toContain('href="/bienvenida/preferencias"');
  });

  it("completo: formulario sin aviso y sin mostrar el rol", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: OwnProfilePage } = await import("@/app/(app)/perfil/page");
    as("complete", "admin");
    const html = renderToStaticMarkup(await OwnProfilePage());
    expect(html).toContain('value="Ana García"');
    expect(html).not.toContain("/bienvenida/preferencias");
    expect(html).not.toMatch(/admin|name="role"/i);
  });
});

describe("requireOnboardingStep", () => {
  it("sin perfil: entra en perfil; preferencias → /bienvenida/perfil", async () => {
    as("no_profile");
    await expect(requireOnboardingStep("perfil")).resolves.toEqual({
      status: "no_profile",
    });
    as("no_profile");
    await expect(requireOnboardingStep("preferencias")).rejects.toEqual(
      redirectsTo("/bienvenida/perfil")
    );
  });

  it("incompleto: entra en preferencias; perfil → /bienvenida/preferencias", async () => {
    as("incomplete");
    await expect(requireOnboardingStep("preferencias")).resolves.toMatchObject({
      status: "incomplete",
    });
    as("incomplete");
    await expect(requireOnboardingStep("perfil")).rejects.toEqual(
      redirectsTo("/bienvenida/preferencias")
    );
  });

  it("completo: cualquier paso → /", async () => {
    for (const step of ["perfil", "preferencias"] as const) {
      as("complete");
      await expect(requireOnboardingStep(step)).rejects.toEqual(redirectsTo("/"));
    }
  });

  it("eliminado: cualquier paso → /cuenta-desactivada", async () => {
    for (const step of ["perfil", "preferencias"] as const) {
      as("deleted");
      await expect(requireOnboardingStep(step)).rejects.toEqual(
        redirectsTo("/cuenta-desactivada")
      );
    }
  });

  it("sin sesión → /login (sin next: las rutas de onboarding están excluidas)", async () => {
    as("anonymous");
    await expect(requireOnboardingStep("perfil")).rejects.toEqual(redirectsTo("/login"));
  });
});

describe("requireDeletedAccount", () => {
  it("eliminado → entra", async () => {
    as("deleted");
    await expect(requireDeletedAccount()).resolves.toBeUndefined();
  });

  it.each([
    ["no_profile", "/bienvenida/perfil"],
    ["incomplete", "/bienvenida/preferencias"],
    ["complete", "/"],
  ] as const)(
    "%s → %s (no hay reactivación ni pantalla para cuentas activas)",
    async (fixture, expected) => {
      as(fixture);
      await expect(requireDeletedAccount()).rejects.toEqual(redirectsTo(expected));
    }
  );

  it("sin sesión → /login", async () => {
    as("anonymous");
    await expect(requireDeletedAccount()).rejects.toEqual(redirectsTo("/login"));
  });
});

describe("requireAdmin", () => {
  it("admin activo → entra", async () => {
    as("complete", "admin");
    await expect(requireAdmin()).resolves.toBeUndefined();
  });

  it("admin activo con onboarding sin completar → entra (el rol no depende del onboarding)", async () => {
    as("incomplete", "admin");
    await expect(requireAdmin()).resolves.toBeUndefined();
  });

  it("ADMIN ELIMINADO → no entra al panel, va a cuenta desactivada", async () => {
    as("deleted", "admin");
    await expect(requireAdmin()).rejects.toEqual(redirectsTo("/cuenta-desactivada"));
  });

  it("usuario normal → no entra, vuelve a donde le toca", async () => {
    as("complete", "user");
    await expect(requireAdmin()).rejects.toEqual(redirectsTo("/"));
    as("incomplete", "user");
    await expect(requireAdmin()).rejects.toEqual(redirectsTo("/bienvenida/preferencias"));
  });

  it("sin perfil → onboarding, sin consultar el rol", async () => {
    const fake = as("no_profile", "admin");
    await expect(requireAdmin()).rejects.toEqual(redirectsTo("/bienvenida/perfil"));
    expect(fake.calls.filter((call) => call.columns === "role, deleted_at")).toHaveLength(
      0
    );
  });

  it("sin sesión → /login?next=%2Fadmin", async () => {
    as("anonymous");
    await expect(requireAdmin()).rejects.toEqual(redirectsTo("/login?next=%2Fadmin"));
  });
});

describe("/admin: layout Y página aplican requireAdmin", () => {
  // Next.js renderiza la página en paralelo con el layout: si solo el layout
  // redirigiera, el contenido de la página viajaría en el cuerpo del 307.
  it("admin eliminado y usuario normal: ni el layout ni la página renderizan", async () => {
    const { default: AdminLayout } = await import("@/app/admin/layout");
    const { default: AdminPage } = await import("@/app/admin/page");
    for (const [fixture, role, expected] of [
      ["deleted", "admin", "/cuenta-desactivada"],
      ["complete", "user", "/"],
    ] as const) {
      as(fixture, role);
      await expect(AdminPage()).rejects.toEqual(redirectsTo(expected));
      as(fixture, role);
      await expect(AdminLayout({ children: null })).rejects.toEqual(
        redirectsTo(expected)
      );
    }
  });

  it("admin activo: la página se renderiza", async () => {
    const { default: AdminPage } = await import("@/app/admin/page");
    as("complete", "admin");
    await expect(AdminPage()).resolves.toBeTruthy();
  });
});

describe("isActiveAdmin (servicio)", () => {
  it("exige role = admin y deleted_at nulo", async () => {
    for (const [fixture, role, expected] of [
      ["complete", "admin", true],
      ["incomplete", "admin", true],
      ["deleted", "admin", false],
      ["complete", "user", false],
      ["no_profile", "admin", false],
    ] as const) {
      const fake = createFakeSupabase({
        userId: TEST_USER,
        respond: respondAs(fixture, role),
      });
      await expect(isActiveAdmin(fake.client)).resolves.toEqual({
        ok: true,
        data: expected,
      });
      expect(fake.calls[0]).toMatchObject({
        table: "profiles",
        columns: "role, deleted_at",
        filters: [{ kind: "eq", column: "id", value: TEST_USER }],
      });
    }
  });

  it("sin sesión → unauthenticated", async () => {
    const fake = createFakeSupabase({ userId: null });
    await expect(isActiveAdmin(fake.client)).resolves.toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
});
