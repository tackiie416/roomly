import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  APP,
  appNav,
  completeOnboarding,
  deactivateAccount,
  loginWithMagicLink,
  makeAdmin,
  requestLog,
  roomState,
  seedRoom,
  uniqueEmail,
  userState,
} from "./helpers";

// CRUD de habitaciones (sesión 68), con la app real (build de producción)
// contra el mock: el mock emula el GRANT por columnas, la RLS de la 4.0, los
// CHECK, la FK barrio ↔ ciudad y H5 (tests/e2e/support/mock-supabase.mjs).
// No es el E2 real: no hay Supabase de verdad.

const NOT_FOUND = "No encontramos esa habitación entre las tuyas.";
const ATTRIBUTION =
  /datos procedentes del conjunto “Unidades administrativas de la ciudad de Barcelona”/;

const JPEG = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#c63" } })
    .jpeg()
    .toBuffer();

async function signUp(page: Page, label: string, name: string) {
  const email = uniqueEmail(label);
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, name);
  return email;
}

async function person(browser: Browser, label: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = await signUp(page, label, name);
  return { context, page, email };
}

/** Rellena los datos mínimos de un borrador (sin barrio ni ocupación). */
async function fillDraft(page: Page, title: string) {
  await page.locator("#title").fill(title);
  await page.locator("#city_id").selectOption({ label: "Barcelona" });
  await page.locator("#price_month").fill("480");
  await page.locator("#available_from").fill("2026-12-01");
  await page.locator('input[name="students_only"][value="false"]').check();
  await page.getByLabel("Wi-Fi").check();
}

const roomIdFrom = (page: Page) =>
  /\/habitaciones\/([0-9a-f-]{36})\//.exec(new URL(page.url()).pathname)?.[1] ?? "";

test("anunciante: crea un borrador, sube una foto, publica, edita, pausa, alquila y borra", async ({
  page,
}) => {
  const email = await signUp(page, "anunciante", "Anunciante E1");
  const { id: userId } = await userState(email);
  const logStart = (await requestLog()).length;

  await appNav(page).getByRole("link", { name: "Habitaciones" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones`);
  await expect(page.getByText("Todavía no tienes habitaciones")).toBeVisible();

  // Alta: nace en borrador y lleva a las fotos.
  await page.getByRole("link", { name: "Nueva habitación" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones/nueva`);
  await expect(page.getByText(ATTRIBUTION)).toBeVisible();
  await expect(page.getByText("nunca la dirección exacta")).toBeVisible();
  await expect(page.locator('[name*="address"], [name="status"]')).toHaveCount(0);
  await fillDraft(page, "Habitación del anunciante E1");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await page.waitForURL(/\/habitaciones\/[0-9a-f-]{36}\/fotos\?creada=1$/);
  const roomId = roomIdFrom(page);
  await expect(page.getByText("Habitación creada como borrador")).toBeVisible();
  expect((await roomState(roomId)).room).toMatchObject({
    owner_id: userId,
    status: "draft",
    title: "Habitación del anunciante E1",
    price_month: 480,
    students_only: false,
    features: ["wifi"],
    neighborhood_id: null,
    approx_lat: null,
    approx_lng: null,
    deleted_at: null,
  });

  // Una foto (no es obligatoria para publicar, R7).
  await page.locator('input[name="photo"]').setInputFiles({
    name: "habitacion.jpg",
    mimeType: "image/jpeg",
    buffer: await JPEG(),
  });
  await page.getByRole("button", { name: "Subir foto" }).click();
  await expect(page.getByText("1 de 8")).toBeVisible();

  // Publicar un borrador incompleto: dice qué falta y no cambia nada.
  await page.getByRole("link", { name: "Datos y estado" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones/${roomId}/editar`);
  await expect(page.getByTestId("room-status")).toHaveText("Borrador");
  await expect(page.getByText("Para publicarla te falta")).toBeVisible();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Todavía no se puede publicar")).toBeVisible();
  expect((await roomState(roomId)).room?.status).toBe("draft");

  // Completarla y publicarla.
  await page.locator("#neighborhood_id").selectOption({ label: "Gràcia" });
  await page.locator("#total_roommates").fill("2");
  await page.locator("#total_rooms").fill("3");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await expect(page.getByText("Para publicarla te falta")).toHaveCount(0);
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Estado actualizado: Publicada.")).toBeVisible();
  await expect(page.getByTestId("room-status")).toHaveText("Publicada");
  expect((await roomState(roomId)).room).toMatchObject({
    status: "active",
    neighborhood_id: "55555555-5555-4555-8555-555555555555",
    total_roommates: 2,
    total_rooms: 3,
  });

  // Editarla publicada; quitarle el barrio no se guarda.
  await page.locator("#price_month").fill("500");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(async () => (await roomState(roomId)).room?.price_month).toBe(500);
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await page.locator("#neighborhood_id").selectOption({ label: "Sin barrio" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Para publicar, elige un barrio")).toBeVisible();
  expect((await roomState(roomId)).room?.neighborhood_id).not.toBeNull();

  // Pausarla y marcarla como alquilada.
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByTestId("room-status")).toHaveText("Pausada");
  await page.getByRole("button", { name: "Marcar como alquilada" }).click();
  await expect(page.getByTestId("room-status")).toHaveText("Alquilada");
  await expect.poll(async () => (await roomState(roomId)).room?.status).toBe("rented");

  // El listado la muestra, con su estado y su barrio.
  await page.getByRole("link", { name: "Tus habitaciones" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones`);
  const item = page
    .getByRole("listitem")
    .filter({ hasText: "Habitación del anunciante E1" });
  await expect(item.getByText("Alquilada")).toBeVisible();
  await expect(item.getByText(/Gràcia, Barcelona/)).toBeVisible();
  await expect(page.getByText(ATTRIBUTION)).toBeVisible();

  // Crear, leer, editar y cambiar el estado: siempre con el cliente del
  // usuario, nunca con service_role (el borrado, abajo, sí lo usa: D17).
  const crud = (await requestLog())
    .slice(logStart)
    .filter((entry) => entry.path === "/rest/v1/rooms");
  expect(crud.length).toBeGreaterThan(0);
  for (const entry of crud) {
    expect(entry.apikeyIsService).toBe(false);
    expect(entry.bearerRole).toBe("authenticated");
  }
  expect(
    crud.filter((entry) => ["POST", "PATCH"].includes(entry.method)).length
  ).toBeGreaterThanOrEqual(6);

  // Borrarla desde el listado.
  await item.getByRole("link", { name: "Borrar" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones/${roomId}/borrar`);
  await page.getByRole("button", { name: "Borrar la habitación" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones/borrada`);
  expect(await roomState(roomId)).toEqual({ room: null, images: [], objects: [] });
  await page.getByRole("link", { name: "Volver a tus habitaciones" }).click();
  await expect(page.getByText("Todavía no tienes habitaciones")).toBeVisible();
});

test("sin JavaScript: crear, completar, publicar y pausar", async ({ page, browser }) => {
  await signUp(page, "anunciante-sin-js", "Anunciante Sin JS");
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();

  await p.goto(`${APP}/habitaciones/nueva`);
  await expect(p.getByText(ATTRIBUTION)).toBeVisible();
  await fillDraft(p, "Habitación sin JavaScript");
  // Sin JavaScript, el barrio se elige del grupo de su ciudad.
  await p.locator("#neighborhood_id").selectOption({ label: "Sants" });
  await p.getByRole("button", { name: "Crear borrador" }).click();
  await p.waitForURL(/\/habitaciones\/[0-9a-f-]{36}\/fotos\?creada=1$/);
  const roomId = roomIdFrom(p);
  await expect(p.getByText("Habitación creada como borrador")).toBeVisible();

  await p.goto(`${APP}/habitaciones/${roomId}/editar`);
  await p.locator("#total_roommates").fill("1");
  await p.locator("#total_rooms").fill("2");
  await p.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(p.getByText("Cambios guardados.")).toBeVisible();

  await p.getByRole("button", { name: "Publicar" }).click();
  await expect(p.getByTestId("room-status")).toHaveText("Publicada");
  await p.getByRole("button", { name: "Pausar" }).click();
  await expect(p.getByTestId("room-status")).toHaveText("Pausada");
  expect((await roomState(roomId)).room).toMatchObject({
    status: "paused",
    total_roommates: 1,
    total_rooms: 2,
    title: "Habitación sin JavaScript",
  });
  await noJs.close();
});

test("otra persona y un admin: 404 en la edición ajena, y un roomId ajeno inyectado no cambia nada", async ({
  browser,
}) => {
  const a = await person(browser, "crud-a", "Dueña A");
  const b = await person(browser, "crud-b", "Persona B");
  const admin = await person(browser, "crud-admin", "Admin C");
  await makeAdmin(admin.email);
  const aRoom = await seedRoom(a.email, {
    title: "La habitación de A",
    status: "active",
    complete: true,
  });
  const before = await roomState(aRoom);

  for (const viewer of [b, admin]) {
    const ownRoom = await seedRoom(viewer.email, { title: "La mía", complete: true });

    await viewer.page.goto(`/habitaciones/${aRoom}/editar`);
    await expect(
      viewer.page.getByRole("heading", { name: "Página no encontrada" })
    ).toBeVisible();
    await viewer.page.goto("/habitaciones");
    await expect(viewer.page.getByText("La habitación de A")).toHaveCount(0);
    await expect(viewer.page.getByText("La mía")).toBeVisible();

    // El roomId de A en el formulario de edición de su propia habitación.
    await viewer.page.goto(`/habitaciones/${ownRoom}/editar`);
    await viewer.page
      .locator('form:has(#title) input[name="roomId"]')
      .evaluate((input: HTMLInputElement, id) => {
        input.value = id;
      }, aRoom);
    await viewer.page.locator("#title").fill("Cambiada por otra persona");
    await viewer.page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(viewer.page.getByText(NOT_FOUND)).toBeVisible();

    // Y en el cambio de estado.
    await viewer.page.goto(`/habitaciones/${ownRoom}/editar`);
    const pause = viewer.page.locator('form:has(input[name="status"][value="paused"])');
    await pause
      .locator('input[name="roomId"]')
      .evaluate((input: HTMLInputElement, id) => {
        input.value = id;
      }, aRoom);
    await pause.getByRole("button", { name: "Pausar" }).click();
    await expect(viewer.page.getByText(NOT_FOUND)).toBeVisible();
    expect(await roomState(aRoom)).toEqual(before);
  }

  // El admin sí ve las fotos ajenas, en solo lectura (moderación de la Fase 7).
  await admin.page.goto(`/habitaciones/${aRoom}/fotos`);
  await expect(
    admin.page.getByText("Vista de administración: solo lectura.")
  ).toBeVisible();
  await expect(admin.page.getByRole("link", { name: "Datos y estado" })).toHaveCount(0);

  for (const who of [a, b, admin]) await who.context.close();
});

test("campos manipulados: owner_id, status, deleted_at, approx_* o una dirección no se guardan", async ({
  page,
}) => {
  await signUp(page, "crud-manipula", "Persona Manipula");

  for (const [name, value] of [
    ["owner_id", "99999999-8888-4777-8666-555555555555"],
    ["status", "active"],
    ["deleted_at", "2026-10-20T10:00:00Z"],
    ["approx_lat", "41.40"],
    ["address_exact", "Carrer de Verdi 1"],
  ]) {
    await page.goto("/habitaciones/nueva");
    await fillDraft(page, `Manipulada ${name}`);
    await page.locator("form:has(#title)").evaluate(
      (form, [key, val]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = val;
        form.appendChild(input);
      },
      [name, value]
    );
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await expect(page.getByText(`Campo no permitido: ${name}`)).toBeVisible();
    await expect(page).toHaveURL(`${APP}/habitaciones/nueva`);
  }

  // Sin la validación del navegador: precio 0 y estancia al revés.
  await page.goto("/habitaciones/nueva");
  await fillDraft(page, "Manipulada sin validación");
  await page.locator("form:has(#title)").evaluate((form) => {
    form.setAttribute("novalidate", "");
  });
  await page.locator("#price_month").fill("0");
  await page.locator("#min_stay_months").fill("6");
  await page.locator("#max_stay_months").fill("3");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page.getByText("El precio tiene que ser mayor que 0")).toBeVisible();
  await expect(
    page.getByText("La estancia máxima no puede ser menor que la mínima")
  ).toBeVisible();

  // Nada se ha creado.
  await page.goto("/habitaciones");
  await expect(page.getByText("Todavía no tienes habitaciones")).toBeVisible();
});

test("cuenta desactivada: el listado, el alta y la edición llevan a /cuenta-desactivada", async ({
  page,
}) => {
  const email = await signUp(page, "crud-off", "Persona Desactivada");
  const roomId = await seedRoom(email, { complete: true });

  // Formulario abierto antes de la desactivación: al enviarlo, no se guarda.
  await page.goto(`/habitaciones/${roomId}/editar`);
  const before = await roomState(roomId);
  await deactivateAccount(email);
  await page.locator("#title").fill("Cambiada tras desactivar");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(`${APP}/cuenta-desactivada`);
  expect(await roomState(roomId)).toEqual(before);

  for (const path of [
    "/habitaciones",
    "/habitaciones/nueva",
    `/habitaciones/${roomId}/editar`,
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${APP}/cuenta-desactivada`);
  }
});

test("sin sesión: el CRUD lleva a /login con vuelta a la página", async ({ page }) => {
  for (const path of ["/habitaciones", "/habitaciones/nueva"]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${APP}/login?next=${encodeURIComponent(path)}`);
  }
});
