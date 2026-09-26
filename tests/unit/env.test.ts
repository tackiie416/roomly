import { describe, it, expect, afterEach } from "vitest";
import { getPublicEnv, getServiceRoleKey } from "@/lib/env";

describe("getPublicEnv", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("lanza un error claro si faltan variables requeridas", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("rechaza una URL con formato inválido", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "no-es-una-url";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(() => getPublicEnv()).toThrow();
  });

  it("devuelve los valores cuando son válidos, con el default de site url", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const env = getPublicEnv();

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-key");
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });
});

describe("getServiceRoleKey", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("lanza un error claro si falta la service role key", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getServiceRoleKey()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("la devuelve cuando está presente", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key-para-test";
    expect(getServiceRoleKey()).toBe("fake-service-role-key-para-test");
  });
});
