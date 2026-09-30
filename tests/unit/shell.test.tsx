import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Fase 2.7 — shell autenticado (N3), cabecera estática y tratamiento de errores.

const navMock = vi.hoisted(() => ({ pathname: "/perfil" }));
const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navMock.pathname,
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));

import { Nav } from "@/components/nav";
import { AppNav, APP_NAV_LINKS } from "@/components/app-nav";
import { AppNavLinks } from "@/components/app-nav-links";
import AppLayout from "@/app/(app)/layout";
import HomePage from "@/app/page";
import RouteError, { GENERIC_ERROR_MESSAGE, GENERIC_ERROR_TITLE } from "@/app/error";
import GlobalError from "@/app/global-error";
import { SignOutButton } from "@/components/auth/sign-out-button";

/** Todos los elementos del árbol (sin renderizar). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

/** Código sin comentarios, para comprobaciones sobre el fuente. */
function sourceWithoutComments(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Error con texto técnico deliberado en todos sus campos. */
function technicalError(): Error & { digest: string } {
  const error = new Error(
    'relation "profiles" SECRET_INTERNAL_DETAIL select * from profiles where id = 42'
  ) as Error & { digest: string };
  error.stack =
    "Error: SECRET_STACK_FRAME\n    at readOwnProfile (lib/services/profile.ts:108)";
  error.digest = "DIGEST_4201218297";
  error.cause = "SECRET_CAUSE";
  return error;
}
const TECHNICAL = /SECRET_|select \*|relation|profiles\.ts|DIGEST_|XX000|Error:/;

beforeEach(() => {
  serverMock.createClient.mockReset();
  navMock.pathname = "/perfil";
});

describe("Nav raíz (estático)", () => {
  it("solo el logotipo: ni «Entrar» ni enlaces de cuenta", () => {
    const html = renderToStaticMarkup(<Nav />);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/"]);
    expect(html).not.toMatch(/Entrar|Cerrar sesión|\/perfil|\/preferencias|\/ajustes/);
  });

  it("no lee la sesión: síncrono y sin imports de Supabase ni de sesión", () => {
    expect(Nav()).not.toBeInstanceOf(Promise);
    const source = sourceWithoutComments("components/nav.tsx");
    expect(source).not.toMatch(/supabase|lib\/auth|cookies|headers|getUser/);
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });
});

describe("Página de inicio pública", () => {
  it("conserva su contenido y ofrece «Entrar» → /login", () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain("Encuentra piso. Encuentra compañeros. Encaja de verdad.");
    expect(html).toContain("Foundation — Fase 1 en construcción.");
    expect(html).toMatch(/<a[^>]*href="\/login"[^>]*>Entrar<\/a>/);
  });
});

describe("Shell autenticado (app)", () => {
  it("enlaza exactamente a /perfil, /preferencias y /ajustes (ninguna ruta futura)", () => {
    expect(APP_NAV_LINKS.map((link) => link.href)).toEqual([
      "/perfil",
      "/preferencias",
      "/ajustes",
    ]);
    const html = renderToStaticMarkup(<AppNav />);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/perfil", "/preferencias", "/ajustes"]);
    expect(html).not.toMatch(/explorar|matches|mensajes|habitaciones|admin/);
  });

  it("el logout es el SignOutButton existente", () => {
    expect(elements(AppNav()).some((element) => element.type === SignOutButton)).toBe(
      true
    );
    expect(renderToStaticMarkup(<AppNav />)).toContain("Cerrar sesión");
  });

  it.each(["/perfil", "/preferencias", "/ajustes"])(
    "marca %s como página actual (aria-current) y solo esa",
    (pathname) => {
      navMock.pathname = pathname;
      const html = renderToStaticMarkup(<AppNavLinks links={APP_NAV_LINKS} />);
      const current = [
        ...html.matchAll(
          /<a[^>]*aria-current="page"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*aria-current="page"/g
        ),
      ];
      expect(current).toHaveLength(1);
      expect(current[0][1] ?? current[0][2]).toBe(pathname);
    }
  );

  it("el layout renderiza el nav y la página, sin consultas ni guard propio", () => {
    const tree = AppLayout({ children: <p>contenido de la página</p> });
    expect(tree).not.toBeInstanceOf(Promise);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="Tu cuenta"');
    expect(html).toContain("contenido de la página");
    expect(serverMock.createClient).not.toHaveBeenCalled();
  });

  it("sin loading.tsx en (app) (L1 revertido: rompía las páginas sin JavaScript)", () => {
    expect(() => readFileSync("app/(app)/loading.tsx")).toThrow();
  });
});

describe.each([
  ["app/error.tsx", RouteError, "app/error.tsx"],
  ["app/global-error.tsx", GlobalError, "app/global-error.tsx"],
] as const)("%s", (_label, Component, path) => {
  it("no muestra message, stack, digest ni causa de un error técnico", () => {
    const html = renderToStaticMarkup(
      <Component error={technicalError()} reset={() => {}} />
    );
    expect(html).not.toMatch(TECHNICAL);
    expect(html).toContain("Algo ha fallado");
    expect(html).toMatch(/No hemos podido cargar/);
  });

  it("ofrece «Reintentar» conectado a reset()", () => {
    const reset = vi.fn();
    const tree = Component({ error: technicalError(), reset });
    const button = elements(tree).find((element) => element.type === "button");
    expect(button).toBeDefined();
    expect(renderToStaticMarkup(button as ReactElement)).toContain("Reintentar");
    (button?.props as { onClick: () => void }).onClick();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("el código no interpola el error (message/stack/digest/cause ni el objeto)", () => {
    const source = sourceWithoutComments(path);
    expect(source).not.toMatch(/error\s*[.?]+\s*(message|stack|digest|cause)/);
    expect(source).not.toMatch(
      /\{\s*error\s*\}|String\(\s*error|JSON\.stringify\(\s*error|`[^`]*\$\{\s*error/
    );
  });
});

describe("app/error.tsx — mensaje", () => {
  it("usa los textos genéricos exportados", () => {
    const html = renderToStaticMarkup(
      <RouteError error={technicalError()} reset={() => {}} />
    );
    expect(html).toContain(GENERIC_ERROR_TITLE);
    expect(html).toContain(GENERIC_ERROR_MESSAGE);
  });
});
