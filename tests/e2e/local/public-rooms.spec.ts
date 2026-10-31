import { expect, test, type Page } from "@playwright/test";
import {
  APP,
  deactivateAccount,
  loginWithMagicLink,
  makeAdmin,
  requestLog,
  resetMock,
  roomState,
  seedCandidate,
  seedRoom,
  uniqueEmail,
} from "./helpers";

// Fase 4.4 (sesión 71) — búsqueda y detalle públicos de habitaciones con la
// app real (build de producción) contra el mock: sin sesión, sin JavaScript,
// paginación por cursor, cambio de orden, fotos firmadas, 404 indistinguible
// y la misma vista pública para una persona autenticada, la propietaria y el
// admin (sin borradores). El mock emula la RLS de R7 y el GRANT por columnas
// de anon (20261031120100). No es el E2 real: ni Supabase ni Storage de
// verdad.

const SEARCH = "/barcelona/habitaciones";
const OWNER_NAME = "Ana Anunciante Pública";
const OTHER_OWNER_NAME = "Berta Desactivada";

type Catalog = {
  ownerEmail: string;
  ownerId: string;
  /** Las 23 habitaciones públicas, de la más reciente a la más antigua. */
  publicTitles: string[];
  filterable: string;
  draft: string;
  paused: string;
  removed: string;
  deactivated: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const HIDDEN_TITLES = [
  "Borrador secreto",
  "Pausada secreta",
  "Retirada secreta",
  "De una cuenta desactivada",
];

/**
 * 22 habitaciones públicas en Gràcia (publicadas en 2020, con precios y
 * fechas repetidos para probar el desempate), una filtrable en Sants y
 * cuatro ocultas: borrador, pausada, retirada y de una cuenta desactivada.
 */
async function seedCatalog(): Promise<Catalog> {
  await resetMock();
  const ownerEmail = uniqueEmail("anunciante");
  const ownerId = await seedCandidate({
    name: OWNER_NAME,
    version: 2,
    questionIds: [],
    email: ownerEmail,
  });
  const titles: string[] = [];
  for (let i = 1; i <= 22; i += 1) {
    const title = `Habitación pública ${pad(i)}`;
    titles.push(title);
    await seedRoom(ownerEmail, {
      title,
      status: "active",
      complete: true,
      photos: i === 22 ? 1 : 0,
      extra: {
        price: 300 + (i % 11) * 10,
        available_from: `2026-11-${pad((i % 9) + 1)}`,
        published_at: `2020-01-${pad(i)}T10:00:00.000Z`,
      },
    });
  }
  const filterable = "Habitación filtrable Sants";
  const filterableId = await seedRoom(ownerEmail, {
    title: filterable,
    status: "active",
    complete: true,
    photos: 2,
    extra: {
      neighborhood: "sants",
      price: 380,
      available_from: "2026-09-01",
      features: "wifi,desk",
      pets: 1,
      smoking: 0,
      students: 1,
      min_stay: 3,
      max_stay: 6,
      roommates: 1,
      bedrooms: 2,
      published_at: "2019-12-31T10:00:00.000Z",
      description: "Luminosa y tranquila.",
      house_rules: "Silencio de noche.",
      roommate_preferences: "Gente ordenada.",
    },
  });
  const draft = await seedRoom(ownerEmail, {
    title: "Borrador secreto",
    status: "draft",
    complete: true,
    photos: 1,
  });
  const paused = await seedRoom(ownerEmail, {
    title: "Pausada secreta",
    status: "paused",
    complete: true,
  });
  const removed = await seedRoom(ownerEmail, {
    title: "Retirada secreta",
    status: "removed",
    complete: true,
  });
  const otherEmail = uniqueEmail("desactivada");
  await seedCandidate({
    name: OTHER_OWNER_NAME,
    version: 2,
    questionIds: [],
    email: otherEmail,
  });
  const deactivated = await seedRoom(otherEmail, {
    title: "De una cuenta desactivada",
    status: "active",
    complete: true,
    photos: 1,
  });
  await deactivateAccount(otherEmail);
  return {
    ownerEmail,
    ownerId,
    publicTitles: [...titles].reverse().concat(filterable),
    filterable: filterableId,
    draft,
    paused,
    removed,
    deactivated,
  };
}

const cards = (page: Page) => page.getByTestId("public-room-card");
const cardTitles = (page: Page) => cards(page).getByRole("heading").allInnerTexts();

async function expectNoPrivateData(page: Page, catalog: Catalog) {
  const html = await page.content();
  for (const text of [OWNER_NAME, OTHER_OWNER_NAME, catalog.ownerId, ...HIDDEN_TITLES])
    expect(html).not.toContain(text);
  expect(html).not.toMatch(/owner_id|approx_l|address/);
}

async function expectSignedImageLoaded(page: Page, img: ReturnType<Page["locator"]>) {
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src"))!;
  expect(src).toMatch(/\/storage\/v1\/object\/sign\/room-images\/.+\.webp\?token=/);
  expect(src).not.toContain("/object/public/");
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBeGreaterThan(0);
}

test("búsqueda sin sesión: 20 tarjetas, portada firmada, sin identidad ni ocultas, como anon", async ({
  page,
}) => {
  const catalog = await seedCatalog();

  await page.goto(SEARCH);
  await expect(
    page.getByRole("heading", { name: "Habitaciones en Barcelona" })
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(20);
  // «Más recientes» por published_at: la 22 es la última publicada.
  expect(await cardTitles(page)).toEqual(catalog.publicTitles.slice(0, 20));
  await expect(cards(page).first()).toContainText("Gràcia, Barcelona");
  await expectSignedImageLoaded(page, cards(page).first().locator("img"));
  await expectNoPrivateData(page, catalog);

  // SEO: canónica sin parámetros e indexable.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${APP}${SEARCH}`
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index, follow"
  );

  // Atribución del catálogo de barrios (R1).
  await expect(page.getByTestId("neighborhoods-attribution").last()).toBeVisible();

  // Peticiones: habitaciones y fotos como anon; service_role solo firma.
  const log = await requestLog();
  const rest = log.filter((entry) => entry.path.startsWith("/rest/v1/"));
  expect(rest.map((entry) => entry.path)).toEqual(
    expect.arrayContaining(["/rest/v1/rooms", "/rest/v1/room_images"])
  );
  for (const entry of rest) expect(entry.bearerRole).toBe("anon");
  expect(rest.some((entry) => /room_addresses|profiles/.test(entry.path))).toBe(false);
  const signs = log.filter(
    (entry) =>
      entry.method === "POST" && entry.path.startsWith("/storage/v1/object/sign/")
  );
  expect(signs).toHaveLength(1);
  expect(signs[0].bearerRole).toBe("service_role");
});

test("paginación por cursor y cambio de orden: sin repetidas ni perdidas, conservando filtros y orden", async ({
  page,
}) => {
  const catalog = await seedCatalog();

  await page.goto(SEARCH);
  const first = await cardTitles(page);
  await expect(
    page.getByRole("link", { name: "Volver a la primera página" })
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Página siguiente" }).click();
  await expect(page).toHaveURL(/cursor=/);
  // Una variante: noindex, con la misma canónica.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow"
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${APP}${SEARCH}`
  );
  const second = await cardTitles(page);
  expect(second).toEqual(catalog.publicTitles.slice(20));
  expect([...first, ...second]).toEqual(catalog.publicTitles);
  await expect(page.getByRole("link", { name: "Página siguiente" })).toHaveCount(0);
  await page.getByRole("link", { name: "Volver a la primera página" }).click();
  await expect(page).toHaveURL(`${APP}${SEARCH}`);

  // Cambio de orden: precio ascendente, con precios repetidos (desempate por id).
  await page.locator("#orden").selectOption("precio_asc");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/orden=precio_asc/);
  await expect(page).not.toHaveURL(/cursor=/);
  const pricesOf = async () =>
    (await cards(page).locator("span.text-lg").allInnerTexts()).map((text) =>
      Number(text.replace(/\D/g, ""))
    );
  const page1 = await cardTitles(page);
  const prices1 = await pricesOf();
  expect(prices1).toEqual([...prices1].sort((a, b) => a - b));
  await page.getByRole("link", { name: "Página siguiente" }).click();
  await expect(page).toHaveURL(/orden=precio_asc/);
  await expect(page).toHaveURL(/cursor=/);
  const page2 = await cardTitles(page);
  const prices2 = await pricesOf();
  expect(prices2).toEqual([...prices2].sort((a, b) => a - b));
  expect(Math.min(...prices2)).toBeGreaterThanOrEqual(Math.max(...prices1));
  expect(new Set([...page1, ...page2]).size).toBe(23);
  expect([...page1, ...page2].sort()).toEqual([...catalog.publicTitles].sort());

  // Disponibilidad más próxima: la filtrable (septiembre) va primera.
  await page.goto(`${SEARCH}?orden=disponibilidad`);
  expect((await cardTitles(page))[0]).toBe("Habitación filtrable Sants");
});

test("filtros sin JavaScript: GET, todos los filtros, sin resultados y parámetros manipulados", async ({
  browser,
}) => {
  await seedCatalog();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto(`${APP}${SEARCH}`);
  // <details> nativo: se abre sin JavaScript.
  await page.locator("summary", { hasText: "Barrios" }).click();
  await page.getByLabel("Sants").check();
  await page.locator("#precio_max").fill("400");
  await page.locator("#entrada").fill("2026-10-01");
  await page.locator("#meses").fill("4");
  await page.locator("#mascotas").selectOption("si");
  await page.locator("#fumar").selectOption("no");
  await page.getByLabel("Solo habitaciones exclusivas para estudiantes").check();
  await page.locator("#dormitorios_max").fill("2");
  await page.locator("#convivientes_max").fill("1");
  await page.locator("summary", { hasText: "Características" }).click();
  await page.getByLabel("Wi-Fi").check();
  await page.getByLabel("Escritorio").check();
  await page.getByRole("button", { name: "Buscar" }).click();

  const url = new URL(page.url());
  expect(url.pathname).toBe(SEARCH);
  expect(url.searchParams.getAll("barrio")).toEqual(["sants"]);
  expect(url.searchParams.getAll("caracteristica")).toEqual(["wifi", "desk"]);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    precio_max: "400",
    entrada: "2026-10-01",
    meses: "4",
    mascotas: "si",
    fumar: "no",
    estudiantes: "1",
    dormitorios_max: "2",
    convivientes_max: "1",
  });
  await expect(cards(page)).toHaveCount(1);
  expect(await cardTitles(page)).toEqual(["Habitación filtrable Sants"]);
  await expect(cards(page)).toContainText("Sants, Barcelona");
  await expect(cards(page)).toContainText("2 dormitorios en la vivienda");
  await expect(cards(page)).toContainText("Convivirás con 1 persona");
  // El formulario conserva lo elegido.
  await expect(page.locator("#precio_max")).toHaveValue("400");
  await expect(page.getByLabel("Sants")).toBeChecked();

  // Una afirmación contraria a la habitación: ninguna.
  await page.goto(`${APP}${SEARCH}?barrio=sants&fumar=si`);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByTestId("search-empty")).toHaveText(
    "No hay habitaciones publicadas con estos filtros."
  );

  // Manipulados: barrio de otra ciudad, parámetro desconocido, cursor falso.
  for (const [query, message] of [
    ["barrio=lavapies", "Algún barrio no es de esta ciudad"],
    ["owner_id=1", "La búsqueda tiene un parámetro que no reconocemos"],
    ["status=draft", "La búsqueda tiene un parámetro que no reconocemos"],
    ["cursor=eyJvIjoicmVjaWVudGVzIn0", "El enlace de esta página no es válido"],
    ["orden=relevancia", "Orden no válido"],
  ]) {
    await page.goto(`${APP}${SEARCH}?${query}`);
    await expect(page.getByTestId("search-invalid")).toContainText(message);
    await expect(cards(page)).toHaveCount(0);
  }

  // La paginación también funciona sin JavaScript.
  await page.goto(`${APP}${SEARCH}`);
  await page.getByRole("link", { name: "Página siguiente" }).click();
  await expect(cards(page)).toHaveCount(3);
  await context.close();
});

test("detalle sin sesión: información pública y fotos firmadas; 404 indistinguible", async ({
  page,
}) => {
  const catalog = await seedCatalog();

  await page.goto(`${SEARCH}?barrio=sants`);
  await cards(page).getByRole("link", { name: "Habitación filtrable Sants" }).click();
  await expect(page).toHaveURL(`${APP}${SEARCH}/${catalog.filterable}`);
  await expect(
    page.getByRole("heading", { name: "Habitación filtrable Sants" })
  ).toBeVisible();
  await expect(page.getByTestId("public-room-location")).toHaveText("Sants, Barcelona");
  const facts = page.getByTestId("public-room-facts");
  for (const text of [
    "380 €",
    "1 de septiembre de 2026",
    "De 3 a 6 meses",
    "2 dormitorios en la vivienda",
    "Convivirás con 1 persona",
    "Se admiten",
    "No se puede fumar",
    "Solo para estudiantes",
  ])
    await expect(facts).toContainText(text);
  await expect(page.getByText("Luminosa y tranquila.")).toBeVisible();
  await expect(page.getByText("Silencio de noche.")).toBeVisible();
  await expect(page.getByText("Gente ordenada.")).toBeVisible();
  await expect(page.getByText("Wi-Fi")).toBeVisible();
  await expectSignedImageLoaded(
    page,
    page.getByRole("img", { name: "Foto 1 de la habitación" })
  );
  await expectSignedImageLoaded(
    page,
    page.getByRole("img", { name: "Foto 2 de la habitación" })
  );
  await expectNoPrivateData(page, catalog);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${APP}${SEARCH}/${catalog.filterable}`
  );

  // 404: la misma respuesta para lo que no existe y para lo que no es público.
  const missing = "00000000-0000-4000-8000-000000000000";
  const bodies: string[] = [];
  for (const path of [
    `${SEARCH}/${missing}`,
    `${SEARCH}/${catalog.draft}`,
    `${SEARCH}/${catalog.paused}`,
    `${SEARCH}/${catalog.removed}`,
    `${SEARCH}/${catalog.deactivated}`,
    `${SEARCH}/no-es-un-id`,
    `/madrid/habitaciones/${catalog.filterable}`,
    `/atlantida/habitaciones/${catalog.filterable}`,
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Página no encontrada" })
    ).toBeVisible();
    bodies.push(await page.locator("main").innerText());
  }
  expect(new Set(bodies).size).toBe(1);
  const city404 = await page.goto("/atlantida/habitaciones");
  expect(city404?.status()).toBe(404);

  // No se ha firmado ninguna foto de las habitaciones ocultas.
  const signed = (await requestLog()).filter(
    (entry) =>
      entry.method === "POST" && entry.path.startsWith("/storage/v1/object/sign/")
  );
  expect(signed.length).toBeGreaterThan(0);
  const draftState = await roomState(catalog.draft);
  const deactivatedState = await roomState(catalog.deactivated);
  const html = await page.content();
  for (const image of [...draftState.images, ...deactivatedState.images])
    expect(html).not.toContain(image.storage_path);
});

test("persona autenticada, propietaria y admin: la misma vista pública, sin borradores", async ({
  page,
}) => {
  const catalog = await seedCatalog();

  // La propietaria entra con su sesión.
  await loginWithMagicLink(page, catalog.ownerEmail);
  await page.goto(SEARCH);
  await expect(cards(page)).toHaveCount(20);
  await expectNoPrivateData(page, catalog);
  for (const id of [catalog.draft, catalog.paused, catalog.removed]) {
    const response = await page.goto(`${SEARCH}/${id}`);
    expect(response?.status()).toBe(404);
  }
  // Con sesión, las páginas públicas leen igualmente como anon.
  const before = (await requestLog()).length;
  await page.goto(`${SEARCH}/${catalog.filterable}`);
  const rest = (await requestLog())
    .slice(before)
    .filter((entry) => entry.path.startsWith("/rest/v1/"));
  expect(rest.length).toBeGreaterThan(0);
  for (const entry of rest) expect(entry.bearerRole).toBe("anon");
  // Su gestión privada sigue intacta: ve su borrador en /habitaciones.
  await page.goto("/habitaciones");
  await expect(page.getByText("Borrador secreto")).toBeVisible();

  // Admin: tampoco ve aquí borradores ni habitaciones de cuentas desactivadas.
  await makeAdmin(catalog.ownerEmail);
  await page.goto(SEARCH);
  await expectNoPrivateData(page, catalog);
  for (const id of [catalog.draft, catalog.deactivated]) {
    const response = await page.goto(`${SEARCH}/${id}`);
    expect(response?.status()).toBe(404);
  }

  // Publicar el borrador desde la gestión: aparece la primera en «Más
  // recientes» (published_at nuevo) y una edición ordinaria no la mueve.
  await page.goto(`/habitaciones/${catalog.draft}/editar`);
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByTestId("room-status")).toHaveText("Publicada");
  const published = (await roomState(catalog.draft)).room?.published_at as string;
  expect(published).toBeTruthy();
  await page.goto(SEARCH);
  expect((await cardTitles(page))[0]).toBe("Borrador secreto");
  await page.goto(`/habitaciones/${catalog.draft}/editar`);
  await page.locator("#price_month").fill("999");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  expect((await roomState(catalog.draft)).room?.published_at).toBe(published);
});

test("el formulario de publicación avisa de no poner datos de contacto ni la dirección", async ({
  page,
}) => {
  const catalog = await seedCatalog();
  await loginWithMagicLink(page, catalog.ownerEmail);
  await page.goto(`/habitaciones/${catalog.draft}/editar`);
  await expect(page.getByTestId("room-public-text-warning")).toContainText(
    "No escribas teléfonos, correos, enlaces de contacto ni la dirección exacta"
  );
});
