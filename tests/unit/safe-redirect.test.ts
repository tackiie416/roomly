import { describe, it, expect } from "vitest";
import { getSafeRedirectPath } from "@/lib/auth/safe-redirect";

describe("getSafeRedirectPath", () => {
  it.each([
    ["/", "/"],
    ["/perfil", "/perfil"],
    ["/admin", "/admin"],
    ["/matches?tab=nuevos", "/matches?tab=nuevos"],
    ["/habitaciones/123#fotos", "/habitaciones/123#fotos"],
    ["/barcelona/companeros-de-piso", "/barcelona/companeros-de-piso"],
    ["/a/../perfil", "/perfil"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"], // codificado: sigue siendo una ruta del propio sitio
  ])("acepta la ruta interna %j", (input, expected) => {
    expect(getSafeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.com",
    "http://evil.com",
    "//evil.com",
    "///evil.com",
    "@evil.com",
    ".evil.com",
    "evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "\\/evil.com",
    "/\\/evil.com",
    "/perfil\\..\\..\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/ /evil.com",
    " /perfil",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https:evil.com",
    "",
  ])("rechaza %j y usa el fallback", (input) => {
    expect(getSafeRedirectPath(input)).toBe("/");
  });

  it("rechaza valores ausentes", () => {
    expect(getSafeRedirectPath(null)).toBe("/");
    expect(getSafeRedirectPath(undefined)).toBe("/");
  });

  it("rechaza rutas absurdamente largas", () => {
    expect(getSafeRedirectPath(`/${"a".repeat(3000)}`)).toBe("/");
  });

  it("respeta un fallback personalizado", () => {
    expect(getSafeRedirectPath("//evil.com", "/login")).toBe("/login");
  });

  it("el resultado siempre resuelve al mismo origen", () => {
    const origin = "https://roomly.es";
    for (const input of [
      "/perfil",
      "@evil.com",
      "//evil.com",
      "/\\evil.com",
      ".evil.com",
    ]) {
      expect(new URL(getSafeRedirectPath(input), origin).origin).toBe(origin);
    }
  });
});
