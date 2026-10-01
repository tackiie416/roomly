import { describe, expect, it } from "vitest";
import {
  CLEAR_NEXT_COOKIE,
  NEXT_COOKIE_MAX_AGE_SECONDS,
  NEXT_COOKIE_NAME,
  readNextCookie,
  serializeNextCookie,
} from "@/lib/auth/next-cookie";

describe("serializeNextCookie (escribir)", () => {
  it("guarda solo la ruta saneada, de corta duración, Lax y Path=/", () => {
    const cookie = serializeNextCookie("/perfil?tab=1", { secure: false });
    expect(cookie).toBe(
      `${NEXT_COOKIE_NAME}=%2Fperfil%3Ftab%3D1; Max-Age=${NEXT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
    );
    expect(NEXT_COOKIE_MAX_AGE_SECONDS).toBe(3600);
  });

  it("añade Secure en https", () => {
    expect(serializeNextCookie("/perfil", { secure: true })).toContain("; Secure");
  });

  it("valor malicioso o excluido → cadena que borra la cookie", () => {
    for (const next of [
      "https://evil.com",
      "//evil.com",
      "/login",
      "/bienvenida/perfil",
    ]) {
      const cookie = serializeNextCookie(next, { secure: false });
      expect(cookie.startsWith(`${NEXT_COOKIE_NAME}=;`)).toBe(true);
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).not.toContain("evil");
    }
  });

  it("valor vacío o ausente → borra la cookie (no reutiliza un destino anterior)", () => {
    for (const next of ["", null, undefined]) {
      expect(serializeNextCookie(next, { secure: false })).toContain("Max-Age=0");
    }
  });
});

describe("readNextCookie (leer y sanear)", () => {
  it("lee una ruta válida", () => {
    expect(readNextCookie(encodeURIComponent("/perfil?tab=1"))).toBe("/perfil?tab=1");
  });

  it("vuelve a sanear: nunca confía en el contenido", () => {
    for (const raw of [
      encodeURIComponent("https://evil.com"),
      encodeURIComponent("//evil.com"),
      "%2F%5Cevil.com",
      encodeURIComponent("/login"),
      encodeURIComponent("/cuenta-desactivada"),
      "%E0%A4%A",
    ]) {
      expect(readNextCookie(raw)).toBeNull();
    }
  });

  it("vacía o ausente → null", () => {
    expect(readNextCookie("")).toBeNull();
    expect(readNextCookie(undefined)).toBeNull();
    expect(readNextCookie(null)).toBeNull();
  });

  it("ida y vuelta: lo que se escribe se lee igual", () => {
    const value = serializeNextCookie("/ajustes", { secure: false })
      .split(";")[0]
      .split("=")[1];
    expect(readNextCookie(value)).toBe("/ajustes");
  });
});

describe("CLEAR_NEXT_COOKIE (borrar desde el servidor)", () => {
  it("borra la misma cookie en la misma ruta", () => {
    expect(CLEAR_NEXT_COOKIE).toMatchObject({
      name: NEXT_COOKIE_NAME,
      value: "",
      path: "/",
      maxAge: 0,
    });
  });
});
