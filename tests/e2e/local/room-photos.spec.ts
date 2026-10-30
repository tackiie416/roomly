import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  APP,
  completeOnboarding,
  deactivateAccount,
  loginWithMagicLink,
  roomState,
  seedRoom,
  uniqueEmail,
} from "./helpers";

// Fase 4.2 — interfaz mínima de las fotos y borrado de una habitación, con la
// app real (build de producción) contra el mock: subida con sharp en el
// servidor, URL firmadas servidas por el Storage simulado y borrado desde el
// servidor. No es el E2 real: no hay Supabase ni Storage de verdad.

const JPEG = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#36c" } })
    .jpeg()
    .toBuffer();

async function owner(page: Page, label: string, name: string) {
  const email = uniqueEmail(label);
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, name);
  return email;
}

async function naturalWidth(page: Page, name: string) {
  const img = page.getByRole("img", { name });
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBeGreaterThan(0);
  return img;
}

test("propietaria: ve sus fotos, sube una, se rechaza otra, quita una y borra la habitación", async ({
  page,
}) => {
  const email = await owner(page, "fotos", "Dueña Fotos");
  const roomId = await seedRoom(email, { title: "Habitación con fotos E1", photos: 1 });

  await page.goto(`/habitaciones/${roomId}/fotos`);
  await expect(
    page.getByRole("heading", { name: "Fotos de la habitación" })
  ).toBeVisible();
  await expect(page.getByText("Habitación con fotos E1")).toBeVisible();
  await expect(page.getByText("1 de 8")).toBeVisible();
  const first = await naturalWidth(page, "Foto 1 de la habitación");
  const firstSrc = (await first.getAttribute("src"))!;
  expect(firstSrc).toMatch(/\/storage\/v1\/object\/sign\/room-images\/.+\.webp\?token=/);
  expect(firstSrc).not.toContain("/object/public/");

  // Subida válida: sharp la limpia y la guarda como WebP en su ruta canónica.
  await page.locator('input[name="photo"]').setInputFiles({
    name: "IMG_0002 casa.jpg",
    mimeType: "image/jpeg",
    buffer: await JPEG(),
  });
  await page.getByRole("button", { name: "Subir foto" }).click();
  await expect(page.getByText("Foto añadida.")).toBeVisible();
  await expect(page.getByText("2 de 8")).toBeVisible();
  await naturalWidth(page, "Foto 2 de la habitación");
  let state = await roomState(roomId);
  expect(state.images).toHaveLength(2);
  expect(state.objects).toHaveLength(2);
  for (const image of state.images)
    expect(image.storage_path).toBe(`${roomId}/${image.id}.webp`);

  // Rechazo: un texto que dice ser JPEG no llega a Storage.
  await page.locator('input[name="photo"]').setInputFiles({
    name: "falsa.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("no soy una imagen"),
  });
  await page.getByRole("button", { name: "Subir foto" }).click();
  await expect(page.getByText("Solo se admiten fotos JPEG, PNG o WebP")).toBeVisible();
  state = await roomState(roomId);
  expect(state.images).toHaveLength(2);
  expect(state.objects).toHaveLength(2);

  // Quitar la primera: se van su fila y su objeto, y su URL deja de servir.
  await page.getByRole("button", { name: "Quitar la foto 1" }).click();
  await expect(page.getByText("1 de 8")).toBeVisible();
  state = await roomState(roomId);
  expect(state.images).toHaveLength(1);
  expect(state.objects).toEqual([state.images[0].storage_path]);
  expect((await fetch(firstSrc)).status).toBe(400);

  // Borrar la habitación: confirmación y borrado en el servidor, sin restos.
  await page.getByRole("link", { name: "Borrar la habitación" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones/${roomId}/borrar`);
  await expect(page.getByText("Se borrarán la habitación y su foto.")).toBeVisible();
  await page.getByRole("button", { name: "Borrar la habitación" }).click();
  await expect(page).toHaveURL(`${APP}/habitaciones/borrada`);
  await expect(page.getByText("La habitación y sus fotos se han borrado.")).toBeVisible();
  expect(await roomState(roomId)).toEqual({ room: null, images: [], objects: [] });

  await page.goto(`/habitaciones/${roomId}/fotos`);
  await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
});

async function student(browser: Browser, label: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = await owner(page, label, name);
  return { context, page, email };
}

test("otra persona no ve la gestión de una habitación ajena ni puede borrarla", async ({
  browser,
}) => {
  const a = await student(browser, "fotos-a", "Dueña A");
  const b = await student(browser, "fotos-b", "Persona B");
  const aRoom = await seedRoom(a.email, { status: "active", photos: 1 });
  const bRoom = await seedRoom(b.email);
  const before = await roomState(aRoom);

  for (const path of [`/habitaciones/${aRoom}/fotos`, `/habitaciones/${aRoom}/borrar`]) {
    await b.page.goto(path);
    await expect(
      b.page.getByRole("heading", { name: "Página no encontrada" })
    ).toBeVisible();
    await expect(b.page.locator('input[type="file"]')).toHaveCount(0);
    await expect(b.page.locator("img")).toHaveCount(0);
  }

  // El id de la habitación de A inyectado en el formulario de borrado de B.
  await b.page.goto(`/habitaciones/${bRoom}/borrar`);
  await b.page.locator('input[name="roomId"]').evaluate((input: HTMLInputElement, id) => {
    input.value = id;
  }, aRoom);
  await b.page.getByRole("button", { name: "Borrar la habitación" }).click();
  await expect(
    b.page.getByText("No encontramos esa habitación entre las tuyas.")
  ).toBeVisible();
  expect(await roomState(aRoom)).toEqual(before);
  expect((await roomState(bRoom)).room).not.toBeNull();

  await a.context.close();
  await b.context.close();
});

test("cuenta desactivada: la gestión de fotos lleva a /cuenta-desactivada", async ({
  page,
}) => {
  const email = await owner(page, "fotos-off", "Dueña Desactivada");
  const roomId = await seedRoom(email, { photos: 1 });
  const before = await roomState(roomId);
  await deactivateAccount(email);
  for (const path of [
    `/habitaciones/${roomId}/fotos`,
    `/habitaciones/${roomId}/borrar`,
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${APP}/cuenta-desactivada`);
  }
  expect(await roomState(roomId)).toEqual(before);
});

test("sin JavaScript: subir y quitar una foto", async ({ page, browser }) => {
  const email = await owner(page, "fotos-sin-js", "Dueña Sin JS");
  const roomId = await seedRoom(email);
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();

  await p.goto(`${APP}/habitaciones/${roomId}/fotos`);
  await expect(p.getByText("Esta habitación todavía no tiene fotos.")).toBeVisible();
  await p.locator('input[name="photo"]').setInputFiles({
    name: "sin-js.jpg",
    mimeType: "image/jpeg",
    buffer: await JPEG(),
  });
  await p.getByRole("button", { name: "Subir foto" }).click();
  await expect(p.getByText("1 de 8")).toBeVisible();
  expect((await roomState(roomId)).images).toHaveLength(1);

  await p.getByRole("button", { name: "Quitar la foto 1" }).click();
  await expect(p.getByText("Esta habitación todavía no tiene fotos.")).toBeVisible();
  expect(await roomState(roomId)).toMatchObject({ images: [], objects: [] });
  await noJs.close();
});
