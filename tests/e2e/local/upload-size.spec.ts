import { createServer, request as httpRequest, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { exactSizeJpeg } from "../../support/exact-size-jpeg.mjs";
import {
  completeOnboarding,
  loginWithMagicLink,
  requestLog,
  roomState,
  seedRoom,
  uniqueEmail,
} from "./helpers";

// Sesión 65 — tamaño real de la subida de una foto en el límite (4 MiB), con
// la Server Action real (build de producción) y un navegador real. Un proxy
// HTTP local entre el navegador y la app cuenta los bytes del cuerpo tal como
// llegan por la red, con el boundary, las cabeceras de cada parte y los campos
// que añade la Server Action. No es Vercel ni Netlify: su límite (unos 4,5 MB
// decimales para un cuerpo binario, según la documentación que indicó el
// propietario, sin comprobar desde aquí) se compara con esta medida.

const MAX = 4 * 1024 * 1024;
/** Referencia de las plataformas (4,5 MB decimales) y margen exigido. */
const PLATFORM_LIMIT = 4_500_000;
const REQUIRED_MARGIN = 100_000;
const APP_PORT = 3000;
const PROXY_PORT = 3100;
const PROXY = `http://localhost:${PROXY_PORT}`;

type Seen = {
  method: string;
  path: string;
  action: string | null;
  contentType: string;
  contentLength: number | null;
  bodyBytes: number;
  status: number | null;
};

let proxy: Server;
const seen: Seen[] = [];
/**
 * Si tiene valor, el proxy imita el límite de la plataforma: un cuerpo de más
 * bytes no llega a la app y recibe un 413, como haría Vercel o Netlify.
 */
let platformLimit: number | null = null;

test.beforeAll(async () => {
  proxy = createServer((req, res) => {
    const entry: Seen = {
      method: req.method ?? "",
      path: req.url ?? "",
      action: (req.headers["next-action"] as string | undefined) ?? null,
      contentType: req.headers["content-type"] ?? "",
      contentLength: req.headers["content-length"]
        ? Number(req.headers["content-length"])
        : null,
      bodyBytes: 0,
      status: null,
    };
    seen.push(entry);
    req.on("data", (chunk: Buffer) => {
      entry.bodyBytes += chunk.length;
    });
    if (platformLimit !== null && (entry.contentLength ?? 0) > platformLimit) {
      req.resume();
      req.on("end", () => {
        entry.status = 413;
        res.writeHead(413, { "content-type": "text/plain" });
        res.end("Request Entity Too Large");
      });
      return;
    }
    // Se reenvía tal cual, con el mismo Host: la app ve el mismo origen que
    // el navegador (localhost:3100) y su comprobación de CSRF no cambia.
    const upstream = httpRequest(
      {
        host: "localhost",
        port: APP_PORT,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (response) => {
        entry.status = response.statusCode ?? null;
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      }
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(PROXY_PORT, "localhost", resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
});

/** Propietaria con sesión y una habitación sin fotos. */
async function ownerWithRoom(page: Page, label: string) {
  const email = uniqueEmail(label);
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, `Dueña ${label}`);
  // Las cookies de localhost valen para cualquier puerto: la sesión sirve
  // también a través del proxy.
  const roomId = await seedRoom(email);
  return { email, roomId };
}

const actionPosts = () =>
  seen.filter((entry) => entry.method === "POST" && /\/fotos$/.test(entry.path));

function report(label: string, entry: Seen) {
  const margin = PLATFORM_LIMIT - entry.bodyBytes;
  const line =
    `MEDICIÓN ${label}: cuerpo ${entry.bodyBytes} bytes (Content-Length ${entry.contentLength}), ` +
    `foto ${MAX} bytes, sobrecoste ${entry.bodyBytes - MAX} bytes, ` +
    `margen frente a 4 500 000: ${margin} bytes (${((margin / PLATFORM_LIMIT) * 100).toFixed(2)} %), ` +
    `Content-Type ${entry.contentType.split(";")[0]}, Next-Action ${entry.action ? "sí" : "no"}, estado ${entry.status}`;
  console.log(line);
  test.info().annotations.push({ type: "medición", description: line });
}

test("una foto de 4 MiB exactos con JavaScript: cuerpo real por debajo de 4,5 MB, con margen, y se guarda", async ({
  page,
}) => {
  const { roomId } = await ownerWithRoom(page, "limite-js");
  const photo = await exactSizeJpeg(MAX);
  expect(photo.length).toBe(MAX);

  await page.goto(`${PROXY}/habitaciones/${roomId}/fotos`);
  const before = actionPosts().length;
  await page.locator('input[name="photo"]').setInputFiles({
    name: "IMG_4MiB.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await page.getByRole("button", { name: "Subir foto" }).click();
  await expect(page.getByText("Foto añadida.")).toBeVisible();

  const posts = actionPosts().slice(before);
  expect(posts).toHaveLength(1);
  const [post] = posts;
  report("con JavaScript (fetch de la Server Action)", post);
  expect(post.action).not.toBeNull();
  expect(post.contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(post.contentLength).toBe(post.bodyBytes);
  expect(post.bodyBytes).toBeGreaterThan(MAX);
  expect(post.bodyBytes).toBeLessThan(PLATFORM_LIMIT);
  expect(PLATFORM_LIMIT - post.bodyBytes).toBeGreaterThanOrEqual(REQUIRED_MARGIN);
  expect(post.bodyBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(post.status).toBe(200);
  expect((await roomState(roomId)).images).toHaveLength(1);
});

test("la misma foto sin JavaScript (formulario HTML): cuerpo real por debajo de 4,5 MB, y se guarda", async ({
  page,
  browser,
}) => {
  const { roomId } = await ownerWithRoom(page, "limite-sin-js");
  const photo = await exactSizeJpeg(MAX);
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();
  await p.goto(`${PROXY}/habitaciones/${roomId}/fotos`);
  const before = actionPosts().length;
  await p.locator('input[name="photo"]').setInputFiles({
    name: "IMG_4MiB.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await p.getByRole("button", { name: "Subir foto" }).click();
  await expect(p.getByText("1 de 8")).toBeVisible();

  const posts = actionPosts().slice(before);
  expect(posts).toHaveLength(1);
  const [post] = posts;
  report("sin JavaScript (formulario HTML)", post);
  expect(post.contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(post.contentLength).toBe(post.bodyBytes);
  expect(post.bodyBytes).toBeGreaterThan(MAX);
  expect(PLATFORM_LIMIT - post.bodyBytes).toBeGreaterThanOrEqual(REQUIRED_MARGIN);
  expect((await roomState(roomId)).images).toHaveLength(1);
  await noJs.close();
});

test("un byte de más (sin JavaScript, para llegar al servidor): se rechaza sin consultas privilegiadas ni de habitaciones", async ({
  page,
  browser,
}) => {
  const { roomId } = await ownerWithRoom(page, "limite-mas-1");
  const photo = await exactSizeJpeg(MAX + 1);
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const p = await noJs.newPage();
  await p.goto(`${PROXY}/habitaciones/${roomId}/fotos`);
  const logBefore = (await requestLog()).length;
  await p.locator('input[name="photo"]').setInputFiles({
    name: "IMG_4MiB_mas_1.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await p.getByRole("button", { name: "Subir foto" }).click();
  await expect(p.getByText("La foto no puede superar los 4 MB")).toBeVisible();
  // Lo que la app pidió al Supabase simulado durante la petición: sin
  // JavaScript, Next.js ejecuta la acción y después vuelve a renderizar la
  // página en la misma petición. Ninguna es de service_role ni de Storage (la
  // página no tiene fotos que firmar), y antes de la primera lectura de rooms
  // (la del render) solo hay sesión y perfil: la acción rechaza la foto sin
  // leer la habitación ni sus fotos.
  const during = (await requestLog()).slice(logBefore);
  expect(during.some((entry) => entry.apikeyIsService)).toBe(false);
  expect(during.some((entry) => entry.path.startsWith("/storage/v1/"))).toBe(false);
  const firstRooms = during.findIndex((entry) => entry.path.startsWith("/rest/v1/rooms"));
  const beforeRender = firstRooms === -1 ? during : during.slice(0, firstRooms);
  expect(beforeRender.length).toBeGreaterThan(0);
  for (const entry of beforeRender) {
    expect(entry.path).toMatch(/^\/(auth\/v1\/user|rest\/v1\/profiles)$/);
  }
  expect((await roomState(roomId)).images).toHaveLength(0);
  await noJs.close();
});

/**
 * Con JavaScript, el formulario avisa antes de enviar una foto de más de
 * 4 MB. Para llegar al servidor se pone el archivo sin el evento change (como
 * haría un cliente manipulado) y se envía el formulario.
 */
async function submitWithoutClientCheck(page: Page, bytes: number) {
  await page.evaluate((size) => {
    const input = document.querySelector<HTMLInputElement>('input[name="photo"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(size)], "enorme.jpg", { type: "image/jpeg" })
    );
    input.files = transfer.files;
    input.form!.requestSubmit();
  }, bytes);
}

test("más de 5 MB llega a Next.js: lo rechaza antes de la acción (16.4.3 responde 500, no 413), sin guardar nada ni mostrar detalles", async ({
  page,
}) => {
  const { roomId } = await ownerWithRoom(page, "limite-5mb");
  await page.goto(`${PROXY}/habitaciones/${roomId}/fotos`);
  const before = actionPosts().length;
  const logBefore = (await requestLog()).length;
  await submitWithoutClientCheck(page, 6 * 1024 * 1024);
  await expect.poll(() => actionPosts().length).toBe(before + 1);
  await expect.poll(() => actionPosts().at(-1)?.status ?? null).not.toBeNull();
  const post = actionPosts().at(-1)!;
  console.log(
    `MEDICIÓN más de 5 MB: cuerpo enviado ${post.bodyBytes} bytes, estado de Next.js ${post.status}`
  );
  // Next.js 16.4.3 corta el cuerpo al pasar de bodySizeLimit y responde 500
  // en las acciones con fetch (action-handler.js: «TODO: consider checking if
  // the error is an ApiError and change status code … 413»).
  expect(post.status).toBe(500);
  await expect(page.getByRole("heading", { name: "Algo ha fallado" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/exceeded|bodySizeLimit|5mb/i);
  const during = (await requestLog()).slice(logBefore);
  expect(during.some((entry) => entry.apikeyIsService)).toBe(false);
  expect(during.some((entry) => entry.path.startsWith("/storage/v1/"))).toBe(false);
  expect(during.some((entry) => entry.path.startsWith("/rest/v1/room"))).toBe(false);
  expect((await roomState(roomId)).images).toHaveLength(0);
});

test("413 de la plataforma (el proxy imita un límite de 4,5 MB): la acción no se ejecuta, error genérico y nada guardado", async ({
  page,
}) => {
  const { roomId } = await ownerWithRoom(page, "limite-413");
  await page.goto(`${PROXY}/habitaciones/${roomId}/fotos`);
  const before = actionPosts().length;
  const logBefore = (await requestLog()).length;
  platformLimit = PLATFORM_LIMIT;
  try {
    await submitWithoutClientCheck(page, 4_600_000);
    await expect.poll(() => actionPosts().at(-1)?.status ?? null).toBe(413);
  } finally {
    platformLimit = null;
  }
  expect(actionPosts()).toHaveLength(before + 1);
  await expect(page.getByRole("heading", { name: "Algo ha fallado" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Too Large|413/);
  const during = (await requestLog()).slice(logBefore);
  expect(during.some((entry) => entry.path.startsWith("/rest/v1/room"))).toBe(false);
  expect(during.some((entry) => entry.path.startsWith("/storage/v1/"))).toBe(false);
  expect((await roomState(roomId)).images).toHaveLength(0);
});
