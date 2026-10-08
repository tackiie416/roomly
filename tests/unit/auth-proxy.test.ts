import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `proxy.ts` solo refresca la sesión y bloquea a anónimos en las rutas
 * protegidas. Nunca consulta la base de datos: el cliente simulado lanza un
 * error si alguien llama a `from()` o `rpc()`.
 */

const ssrMock = vi.hoisted(() => ({ user: null as { id: string } | null, dbCalls: 0 }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: ssrMock.user }, error: null }) },
    from: () => {
      ssrMock.dbCalls += 1;
      throw new Error("proxy.ts no debe consultar la base de datos");
    },
    rpc: () => {
      ssrMock.dbCalls += 1;
      throw new Error("proxy.ts no debe consultar la base de datos");
    },
  }),
}));

const ORIGIN = "http://localhost:3000";

async function hit(path: string) {
  const { proxy } = await import("@/proxy");
  const response = await proxy(new NextRequest(`${ORIGIN}${path}`));
  return { status: response.status, location: response.headers.get("location") };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "clave-publica-de-prueba";
  ssrMock.user = null;
  ssrMock.dbCalls = 0;
});

describe("proxy — sin sesión", () => {
  it.each([
    ["/admin", "/login?next=%2Fadmin"],
    ["/admin/usuarios", "/login?next=%2Fadmin%2Fusuarios"],
    ["/perfil", "/login?next=%2Fperfil"],
    ["/preferencias", "/login?next=%2Fpreferencias"],
    ["/ajustes?tab=cuenta", "/login?next=%2Fajustes%3Ftab%3Dcuenta"],
    ["/bienvenida/perfil", "/login"],
    ["/bienvenida/preferencias", "/login"],
    ["/cuenta-desactivada", "/login"],
    ["/test", "/login?next=%2Ftest"],
    ["/explorar?pagina=2", "/login?next=%2Fexplorar%3Fpagina%3D2"],
  ])("%s → %s", async (path, expected) => {
    const result = await hit(path);
    expect(result.status).toBe(307);
    expect(result.location).toBe(`${ORIGIN}${expected}`);
  });

  it.each([
    "/",
    "/login",
    "/callback?code=x",
    "/registro",
    "/administracion",
    "/testimonios",
  ])("%s es pública (sin redirección)", async (path) => {
    const result = await hit(path);
    expect(result.status).toBe(200);
    expect(result.location).toBeNull();
  });
});

describe("proxy — con sesión", () => {
  it("deja pasar las rutas protegidas: el estado del perfil lo deciden los guards", async () => {
    ssrMock.user = { id: "u" };
    for (const path of [
      "/admin",
      "/perfil",
      "/bienvenida/perfil",
      "/cuenta-desactivada",
      "/test",
      "/explorar",
    ]) {
      const result = await hit(path);
      expect(result.status).toBe(200);
      expect(result.location).toBeNull();
    }
  });
});

describe("proxy — nunca consulta la base de datos", () => {
  it("ni con sesión ni sin ella", async () => {
    for (const user of [null, { id: "u" }]) {
      ssrMock.user = user;
      for (const path of ["/", "/admin", "/perfil", "/bienvenida/perfil", "/login"])
        await hit(path);
    }
    expect(ssrMock.dbCalls).toBe(0);
  });
});
