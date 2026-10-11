import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createTestUser,
  type TestUserAdmin,
  type TestUserSignIn,
} from "@/tests/integration/test-users";

// Regresión de la api-suite (PR #17): el id de cada usuario de prueba queda
// apuntado para el teardown en cuanto Auth lo crea, antes de iniciar sesión.
// Antes se apuntaba después de `signInWithPassword`, y un login fallido (p. ej.
// por un límite de Auth) dejaba el usuario sin borrar hasta el run siguiente.
// Sin red ni Supabase: `auth.admin.createUser` y el login son dobles locales.
// No prueba la limpieza real en el proyecto remoto.

const ID = "11111111-2222-4333-8444-555555555555";
const EMAIL = "roomly-val-0123abcd-s@example.com";
const PASSWORD = "contraseña-de-prueba-que-no-debe-salir";

function admin(result: Awaited<ReturnType<TestUserAdmin["createUser"]>>) {
  return { createUser: vi.fn<TestUserAdmin["createUser"]>(async () => result) };
}
const created = () => admin({ data: { user: { id: ID } }, error: null });

function options(
  overrides: Partial<Parameters<typeof createTestUser>[0]> & { registry: Set<string> }
) {
  return { key: "s", email: EMAIL, password: PASSWORD, admin: created(), ...overrides };
}

describe("createTestUser", () => {
  it("si signInWithPassword devuelve un error después de crear el usuario, el id sigue apuntado para el teardown", async () => {
    const registry = new Set<string>();
    const signIn = vi.fn<TestUserSignIn>(async () => ({
      error: { message: "Request rate limit reached" },
    }));
    await expect(createTestUser(options({ registry, signIn }))).rejects.toThrow(
      "signInWithPassword(s): Request rate limit reached"
    );
    expect(signIn).toHaveBeenCalledTimes(1);
    expect([...registry]).toEqual([ID]);
  });

  it("si el login lanza una excepción (p. ej. de red), el id también sigue apuntado", async () => {
    const registry = new Set<string>();
    const signIn = vi.fn<TestUserSignIn>(async () => {
      throw new Error("fetch failed");
    });
    await expect(createTestUser(options({ registry, signIn }))).rejects.toThrow(
      "fetch failed"
    );
    expect([...registry]).toEqual([ID]);
  });

  it("el id se apunta antes de llamar al login", async () => {
    const registry = new Set<string>();
    let registeredAtSignIn: boolean | null = null;
    const signIn = vi.fn<TestUserSignIn>(async () => {
      registeredAtSignIn = registry.has(ID);
      return { error: null };
    });
    expect(await createTestUser(options({ registry, signIn }))).toBe(ID);
    expect(registeredAtSignIn).toBe(true);
  });

  it("con login correcto: un usuario confirmado sin email, apuntado una vez y con su sesión iniciada", async () => {
    const registry = new Set<string>();
    const auth = created();
    const signIn = vi.fn<TestUserSignIn>(async () => ({ error: null }));
    expect(await createTestUser(options({ registry, admin: auth, signIn }))).toBe(ID);
    expect(auth.createUser).toHaveBeenCalledExactlyOnceWith({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(signIn).toHaveBeenCalledExactlyOnceWith({ email: EMAIL, password: PASSWORD });
    expect([...registry]).toEqual([ID]);
  });

  it("sin login (candidatos de GC): el id también queda apuntado", async () => {
    const registry = new Set<string>();
    expect(await createTestUser(options({ registry }))).toBe(ID);
    expect([...registry]).toEqual([ID]);
  });

  it.each([
    ["Auth devuelve un error", { data: { user: null }, error: { message: "boom" } }],
    ["Auth no devuelve usuario", { data: { user: null }, error: null }],
  ])(
    "si %s al crear, no se apunta nada ni se intenta el login",
    async (_label, result) => {
      const registry = new Set<string>();
      const signIn = vi.fn<TestUserSignIn>(async () => ({ error: null }));
      await expect(
        createTestUser(options({ registry, admin: admin(result), signIn }))
      ).rejects.toThrow(/^createUser\(s\):/);
      expect(registry.size).toBe(0);
      expect(signIn).not.toHaveBeenCalled();
    }
  );

  it("un mismo id no se apunta dos veces: el teardown no intenta borrarlo dos veces", async () => {
    const registry = new Set<string>([ID]);
    await createTestUser(options({ registry }));
    expect([...registry]).toEqual([ID]);
  });

  it("los errores no llevan la contraseña", async () => {
    for (const run of [
      () =>
        createTestUser(
          options({
            registry: new Set(),
            signIn: async () => ({ error: { message: "Invalid login credentials" } }),
          })
        ),
      () =>
        createTestUser(
          options({
            registry: new Set(),
            admin: admin({ data: { user: null }, error: { message: "boom" } }),
          })
        ),
    ]) {
      const error = await run().then(
        () => null,
        (reason: unknown) => reason
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(PASSWORD);
    }
  });
});

describe("la api-suite usa createTestUser para todas sus altas", () => {
  // Sin esto, la regresión de arriba podría pasar aunque la suite volviera a
  // crear usuarios por su cuenta.
  const suite = readFileSync("tests/integration/supabase-validation.test.ts", "utf8");

  it("ninguna alta directa con auth.admin.createUser ni login fuera de createTestUser", () => {
    expect(suite).not.toMatch(/auth\.admin\.createUser\(/);
    const logins = suite.match(/signInWithPassword\(/g) ?? [];
    expect(logins).toHaveLength(1);
    expect(suite).toContain(
      "signIn: (credentials) => client.auth.signInWithPassword(credentials)"
    );
  });

  it("los actores y los candidatos se crean con createTestUser sobre el mismo registro", () => {
    expect(suite.match(/await createTestUser\(\{/g) ?? []).toHaveLength(2);
    expect(suite.match(/registry: testUserIds,/g) ?? []).toHaveLength(2);
  });

  it("el teardown borra exactamente ese registro", () => {
    expect(suite).toContain(
      "await teardownUsers([...testUserIds], [...createdConversationIds]);"
    );
  });
});
