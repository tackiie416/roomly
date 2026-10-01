import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { TEST_USER, respondAs, type ProfileFixture } from "./helpers/profile-rows";
import { NEXT_COOKIE_NAME } from "@/lib/auth/next-cookie";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));

const ORIGIN = "http://localhost:3000";
const RAW_SUPABASE = "Email link is invalid or has expired <script>";

async function callback(query: string, cookie?: string) {
  const { GET } = await import("@/app/(auth)/callback/route");
  const headers = cookie ? { cookie: `${NEXT_COOKIE_NAME}=${cookie}` } : undefined;
  const response = await GET(new NextRequest(`${ORIGIN}/callback${query}`, { headers }));
  return {
    status: response.status,
    location: response.headers.get("location"),
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

function stubSupabase(
  fixture: ProfileFixture,
  exchangeError?: { code?: string; message?: string }
) {
  const fake = createFakeSupabase({
    userId: TEST_USER,
    respond: respondAs(fixture),
    exchangeError,
  });
  serverMock.createClient.mockResolvedValue(fake.client);
  return fake;
}

const cookieCleared = (setCookie: string) =>
  setCookie.includes(`${NEXT_COOKIE_NAME}=;`) && /Max-Age=0/i.test(setCookie);

beforeEach(() => {
  serverMock.createClient.mockReset();
});

describe("callback — canje correcto", () => {
  it.each([
    ["no_profile", `${ORIGIN}/bienvenida/perfil`],
    ["incomplete", `${ORIGIN}/bienvenida/preferencias`],
    ["complete", `${ORIGIN}/`],
    ["deleted", `${ORIGIN}/cuenta-desactivada`],
  ] as const)("%s → %s", async (fixture, expected) => {
    const fake = stubSupabase(fixture);
    const result = await callback("?code=abc");
    expect(result.status).toBe(307);
    expect(result.location).toBe(expected);
    expect(fake.authCalls).toEqual([
      { method: "exchangeCodeForSession", argument: "abc" },
    ]);
  });

  it("complete usa el next de la cookie y la elimina", async () => {
    stubSupabase("complete");
    const result = await callback("?code=abc", encodeURIComponent("/ajustes?tab=cuenta"));
    expect(result.location).toBe(`${ORIGIN}/ajustes?tab=cuenta`);
    expect(cookieCleared(result.setCookie)).toBe(true);
  });

  it("la cookie se elimina aunque el estado no permita usar next", async () => {
    stubSupabase("no_profile");
    const result = await callback("?code=abc", encodeURIComponent("/ajustes"));
    expect(result.location).toBe(`${ORIGIN}/bienvenida/perfil`);
    expect(cookieCleared(result.setCookie)).toBe(true);
  });

  it("vuelve a sanear la cookie: un next malicioso o excluido → /", async () => {
    for (const next of [
      "https://evil.com",
      "//evil.com",
      "/login",
      "/cuenta-desactivada",
    ]) {
      stubSupabase("complete");
      const result = await callback("?code=abc", encodeURIComponent(next));
      expect(result.location).toBe(`${ORIGIN}/`);
    }
  });

  it("ignora next en la query (solo se acepta por cookie)", async () => {
    stubSupabase("complete");
    const result = await callback("?code=abc&next=%2Fajustes");
    expect(result.location).toBe(`${ORIGIN}/`);
  });
});

describe("callback — errores", () => {
  it("sin code → auth_callback_failed, sin llamar a Supabase", async () => {
    const result = await callback("");
    expect(result.location).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
    expect(serverMock.createClient).not.toHaveBeenCalled();
    expect(cookieCleared(result.setCookie)).toBe(true);
  });

  it("canje fallido (code inválido) → auth_callback_failed", async () => {
    stubSupabase("complete", { code: "bad_code_verifier", message: RAW_SUPABASE });
    const result = await callback("?code=invalido");
    expect(result.location).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
  });

  it("canje fallido por enlace caducado → link_expired", async () => {
    stubSupabase("complete", { code: "otp_expired", message: RAW_SUPABASE });
    expect((await callback("?code=viejo")).location).toBe(
      `${ORIGIN}/login?error=link_expired`
    );
  });

  it("?error= de Supabase → auth_callback_failed, sin canjear", async () => {
    const result = await callback(
      `?error=access_denied&error_description=${encodeURIComponent(RAW_SUPABASE)}`
    );
    expect(result.location).toBe(`${ORIGIN}/login?error=auth_callback_failed`);
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("?error_code=otp_expired → link_expired", async () => {
    const result = await callback(
      `?error=access_denied&error_code=otp_expired&error_description=${encodeURIComponent(RAW_SUPABASE)}`
    );
    expect(result.location).toBe(`${ORIGIN}/login?error=link_expired`);
  });

  it("nunca reenvía error_description ni texto de Supabase", async () => {
    stubSupabase("complete", { code: "otp_expired", message: RAW_SUPABASE });
    for (const query of [
      `?error=x&error_description=${encodeURIComponent(RAW_SUPABASE)}`,
      "?code=viejo",
    ]) {
      const { location } = await callback(query);
      expect(location).not.toMatch(/description|expired%20|script|invalid/i);
    }
  });

  it("al volver a /login conserva el next de la cookie para el siguiente intento", async () => {
    stubSupabase("complete", { code: "otp_expired" });
    const result = await callback("?code=viejo", encodeURIComponent("/ajustes"));
    expect(result.location).toBe(`${ORIGIN}/login?error=link_expired&next=%2Fajustes`);
    expect(cookieCleared(result.setCookie)).toBe(true);
  });

  it("si el estado del perfil no se puede leer → auth_callback_failed", async () => {
    const fake = createFakeSupabase({
      userId: TEST_USER,
      respond: () => ({ data: null, error: { code: "XX000", message: RAW_SUPABASE } }),
    });
    serverMock.createClient.mockResolvedValue(fake.client);
    expect((await callback("?code=abc")).location).toBe(
      `${ORIGIN}/login?error=auth_callback_failed`
    );
  });
});
