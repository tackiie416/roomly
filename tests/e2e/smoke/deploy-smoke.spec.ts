import { expect, test } from "@playwright/test";

// Sesión 87 — smoke tests de un despliegue (playwright.smoke.config.ts). Solo
// peticiones anónimas de lectura: cabeceras de seguridad, páginas públicas,
// rutas protegidas, redirects sin open redirect, 404 indistinguible y que la
// clave service_role no llegue al navegador. Nada de sesión ni escrituras.

const BASE = new URL(process.env.SMOKE_BASE_URL as string);
const HTTPS = BASE.protocol === "https:";
const PROTECTED = [
  "/perfil",
  "/preferencias",
  "/ajustes",
  "/ajustes/mis-datos",
  "/ajustes/eliminar-cuenta",
  "/test",
  "/explorar",
  "/habitaciones",
  "/matches",
  "/mensajes",
  "/admin",
  "/admin/usuarios",
];

test("la home responde con las cabeceras de seguridad", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBeTruthy();
  expect(headers["permissions-policy"]).toBeTruthy();
  expect(headers["x-powered-by"]).toBeUndefined();
  if (HTTPS) expect(headers["strict-transport-security"]).toContain("max-age=");
});

test("páginas públicas: home, login, registro y búsqueda de Barcelona", async ({
  page,
}) => {
  for (const path of ["/", "/login", "/registro", "/barcelona/habitaciones"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
  }
});

test("sin sesión, cada ruta protegida lleva al login (sin contenido privado)", async ({
  request,
}) => {
  for (const path of PROTECTED) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([303, 307, 308], path).toContain(response.status());
    const location = new URL(response.headers().location ?? "", BASE);
    expect(location.origin, path).toBe(BASE.origin);
    expect(location.pathname, path).toBe("/login");
  }
});

test("sin open redirect: next externo no sale del dominio", async ({ request }) => {
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
    const response = await request.get(`/callback?next=${encodeURIComponent(next)}`, {
      maxRedirects: 0,
    });
    const location = response.headers().location;
    if (location) expect(new URL(location, BASE).origin, next).toBe(BASE.origin);
  }
});

test("un anuncio inexistente es 404", async ({ request }) => {
  const response = await request.get(
    "/barcelona/habitaciones/00000000-0000-4000-8000-000000000000"
  );
  expect(response.status()).toBe(404);
});

test("la clave service_role no llega al navegador", async ({ page }) => {
  const scripts = new Set<string>();
  page.on("response", (response) => {
    if (response.url().includes("/_next/static/") && response.url().endsWith(".js"))
      scripts.add(response.url());
  });
  for (const path of ["/", "/login", "/barcelona/habitaciones"]) await page.goto(path);
  expect(scripts.size).toBeGreaterThan(0);
  for (const url of scripts) {
    const body = await (await page.request.get(url)).text();
    expect(body, url).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(body, url).not.toMatch(/sb_secret_[A-Za-z0-9_-]{10,}/);
  }
});
