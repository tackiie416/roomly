import { describe, expect, it } from "vitest";
import {
  DEACTIVATED_PATH,
  HOME_PATH,
  ONBOARDING_PREFERENCES_PATH,
  ONBOARDING_PROFILE_PATH,
  loginPath,
  resolveDestination,
  sanitizeNext,
  type ProfileStatus,
} from "@/lib/auth/destination";
import { isProtectedPath } from "@/lib/auth/protected-routes";

const STATUSES: ProfileStatus[] = ["no_profile", "incomplete", "complete", "deleted"];

const MALICIOUS = [
  "https://evil.com",
  "http://evil.com/perfil",
  "//evil.com",
  "/\\evil.com",
  "@evil.com",
  ".evil.com",
  "javascript:alert(1)",
  "/\t/evil.com",
  "/\n/evil.com",
];

const EXCLUDED = [
  "/login",
  "/login?error=link_expired",
  "/login/",
  "/LOGIN",
  "/%6cogin",
  "/callback",
  "/callback?code=x",
  "/registro",
  "/bienvenida",
  "/bienvenida/perfil",
  "/bienvenida/preferencias",
  "/bienvenida/otra",
  "/cuenta-desactivada",
];

describe("resolveDestination — por estado", () => {
  it("no_profile → /bienvenida/perfil", () => {
    expect(resolveDestination({ status: "no_profile" })).toBe(ONBOARDING_PROFILE_PATH);
  });

  it("incomplete → /bienvenida/preferencias", () => {
    expect(resolveDestination({ status: "incomplete" })).toBe(
      ONBOARDING_PREFERENCES_PATH
    );
  });

  it("complete sin next → /", () => {
    expect(resolveDestination({ status: "complete" })).toBe(HOME_PATH);
  });

  it("deleted → /cuenta-desactivada", () => {
    expect(resolveDestination({ status: "deleted" })).toBe(DEACTIVATED_PATH);
  });
});

describe("resolveDestination — estado + next", () => {
  it("complete respeta un next interno válido (con query)", () => {
    expect(resolveDestination({ status: "complete" }, "/perfil")).toBe("/perfil");
    expect(resolveDestination({ status: "complete" }, "/ajustes?tab=cuenta")).toBe(
      "/ajustes?tab=cuenta"
    );
    expect(resolveDestination({ status: "complete" }, "/admin")).toBe("/admin");
  });

  it("next vacío o ausente → /", () => {
    for (const next of ["", null, undefined]) {
      expect(resolveDestination({ status: "complete" }, next)).toBe(HOME_PATH);
    }
  });

  it.each(MALICIOUS)("next malicioso %s → /", (next) => {
    expect(resolveDestination({ status: "complete" }, next)).toBe(HOME_PATH);
  });

  it("cualquier destino resuelve siempre al propio origen", () => {
    const origin = "https://roomly.es";
    for (const next of [...MALICIOUS, "/%0a/evil.com", "/%2F%2Fevil.com", "/perfil"]) {
      const destination = resolveDestination({ status: "complete" }, next);
      expect(new URL(destination, origin).origin).toBe(origin);
    }
  });

  it.each(EXCLUDED)("next excluido %s → /", (next) => {
    expect(resolveDestination({ status: "complete" }, next)).toBe(HOME_PATH);
  });

  it("en los demás estados manda el estado, nunca next", () => {
    for (const status of ["no_profile", "incomplete", "deleted"] as const) {
      expect(resolveDestination({ status }, "/perfil")).toBe(
        resolveDestination({ status })
      );
      expect(resolveDestination({ status }, "/admin")).toBe(
        resolveDestination({ status })
      );
    }
  });

  it("deleted tiene prioridad: nunca se reactiva ni se sale por next", () => {
    expect(resolveDestination({ status: "deleted" }, "/perfil")).toBe(DEACTIVATED_PATH);
  });
});

describe("resolveDestination — sin bucles", () => {
  it("ningún destino es una ruta de autenticación", () => {
    for (const status of STATUSES) {
      for (const next of [null, "/perfil", ...EXCLUDED, ...MALICIOUS]) {
        const destination = resolveDestination({ status }, next);
        expect(destination.startsWith("/login")).toBe(false);
        expect(destination.startsWith("/callback")).toBe(false);
        expect(destination.startsWith("/registro")).toBe(false);
      }
    }
  });

  it("el destino es estable: volver a resolver desde él da lo mismo", () => {
    for (const status of STATUSES) {
      for (const next of [null, "/perfil", "/login", "https://evil.com"]) {
        const first = resolveDestination({ status }, next);
        expect(resolveDestination({ status }, first)).toBe(first);
      }
    }
  });

  it("un perfil completo nunca va al onboarding ni a cuenta desactivada", () => {
    for (const next of [...EXCLUDED, "/perfil"]) {
      const destination = resolveDestination({ status: "complete" }, next);
      expect(destination.startsWith("/bienvenida")).toBe(false);
      expect(destination).not.toBe(DEACTIVATED_PATH);
    }
  });
});

describe("sanitizeNext", () => {
  it("devuelve la ruta normalizada o null", () => {
    expect(sanitizeNext("/perfil")).toBe("/perfil");
    expect(sanitizeNext("/perfil/../ajustes")).toBe("/ajustes");
    expect(sanitizeNext("perfil")).toBeNull();
    expect(sanitizeNext("")).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
  });

  it("rechaza codificaciones inválidas", () => {
    expect(sanitizeNext("/%E0%A4%A")).toBeNull();
  });
});

describe("loginPath", () => {
  it("sin opciones → /login", () => {
    expect(loginPath()).toBe("/login");
  });

  it("incluye next solo si es válido", () => {
    expect(loginPath({ next: "/perfil" })).toBe("/login?next=%2Fperfil");
    expect(loginPath({ next: "//evil.com" })).toBe("/login");
    expect(loginPath({ next: "/bienvenida/perfil" })).toBe("/login");
  });

  it("incluye el código de error", () => {
    expect(loginPath({ error: "link_expired", next: "/perfil" })).toBe(
      "/login?error=link_expired&next=%2Fperfil"
    );
  });
});

describe("isProtectedPath (proxy)", () => {
  it.each([
    "/admin",
    "/admin/usuarios",
    "/perfil",
    "/perfil/editar",
    "/ajustes",
    "/bienvenida",
    "/bienvenida/perfil",
    "/bienvenida/preferencias",
    "/cuenta-desactivada",
  ])("%s exige sesión", (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each(["/", "/login", "/callback", "/registro", "/administracion", "/perfiles"])(
    "%s es pública",
    (path) => {
      expect(isProtectedPath(path)).toBe(false);
    }
  );
});
