import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OTHER_ROOM_ID,
  OTHER_USER,
  ROOM_ID,
  createRoomWorld,
  room,
  worldImage,
  type RoomWorld,
} from "./helpers/room-world";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const adminMock = vi.hoisted(() => ({ world: null as RoomWorld | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!adminMock.world) throw new Error("createAdminClient sin mundo simulado");
    return adminMock.world.createAdminClient();
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));

import RoomPhotosPage from "@/app/(app)/habitaciones/[id]/fotos/page";
import DeleteRoomPage from "@/app/(app)/habitaciones/[id]/borrar/page";
import RoomDeletedPage from "@/app/(app)/habitaciones/borrada/page";

// Fase 4.2 — interfaz mínima de las fotos: quién ve qué controles. La página
// se renderiza en el servidor con los servicios reales sobre un mundo en
// memoria; las fotos solo llegan como URL firmadas del servicio.

const photo1 = worldImage(1);
const photo2 = worldImage(2);
const theirs = worldImage(3, OTHER_ROOM_ID);
const notFoundError = expect.objectContaining({ notFound: true });
const redirectsTo = (url: string) => expect.objectContaining({ url });

beforeEach(() => {
  serverMock.createClient.mockReset();
  adminMock.world = null;
});

function setup(options: Parameters<typeof createRoomWorld>[0] = {}) {
  const world = createRoomWorld({
    rooms: [room(), room({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" })],
    owners: { [OTHER_USER]: null },
    images: [photo1, photo2, theirs],
    objects: [photo1.storage_path, photo2.storage_path, theirs.storage_path],
    ...options,
  });
  serverMock.createClient.mockResolvedValue(world.userClient);
  adminMock.world = world;
  return world;
}

const photosPage = async (id: string) =>
  renderToStaticMarkup(await RoomPhotosPage({ params: Promise.resolve({ id }) }));
const deletePage = async (id: string) =>
  renderToStaticMarkup(await DeleteRoomPage({ params: Promise.resolve({ id }) }));

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("/habitaciones/[id]/fotos", () => {
  it("propietaria: fotos con URL firmadas, subida, quitar cada foto y enlace al borrado", async () => {
    setup();
    const html = await photosPage(ROOM_ID);
    expect(html).toContain("Fotos de la habitación");
    expect(html).toContain("Habitación luminosa en Gràcia");
    expect(html).toContain("2 de 8");
    // Cada foto, con su URL firmada (lleva el token) y nada más.
    expect(count(html, /<img /g)).toBe(2);
    expect(html).toContain(
      `src="https://storage.test/sign/${photo1.storage_path}?token=`
    );
    expect(html).not.toMatch(/object\/public|getPublicUrl/);
    expect(html).not.toContain(theirs.id);
    // Subida: un campo de archivo y solo el id de la habitación.
    expect(count(html, /type="file"/g)).toBe(1);
    expect(html).toContain('name="photo"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain(`name="roomId" value="${ROOM_ID}"`);
    // Quitar: un formulario por foto, con ids y nunca la ruta del objeto.
    expect(count(html, /name="imageId"/g)).toBe(2);
    expect(html).toContain(`name="imageId" value="${photo1.id}"`);
    expect(html).toContain('aria-label="Quitar la foto 1"');
    expect(html).not.toMatch(/name="(storagePath|storage_path|path|position)"/);
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/borrar"`);
  });

  it("admin activo: ve las fotos de otra habitación, en solo lectura y sin controles", async () => {
    setup({ profile: { role: "admin" } });
    const html = await photosPage(OTHER_ROOM_ID);
    expect(html).toContain("Vista de administración: solo lectura.");
    expect(count(html, /<img /g)).toBe(1);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('name="imageId"');
    expect(html).not.toContain("/borrar");
    expect(html).not.toContain("<form");
  });

  it("otra persona (habitación pública ajena) → 404, sin firmar nada", async () => {
    const world = setup();
    await expect(photosPage(OTHER_ROOM_ID)).rejects.toEqual(notFoundError);
    expect(world.state.log).not.toContain("storage.sign");
  });

  it("id que no es un UUID → 404", async () => {
    setup();
    await expect(photosPage("../../etc")).rejects.toEqual(notFoundError);
  });

  it("cuenta desactivada → /cuenta-desactivada antes de leer la habitación", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(photosPage(ROOM_ID)).rejects.toEqual(redirectsTo("/cuenta-desactivada"));
    expect(world.userCalls.some((c) => c.table === "rooms")).toBe(false);
  });

  it("sin sesión → /login con vuelta a la página", async () => {
    setup({ userId: null });
    await expect(photosPage(ROOM_ID)).rejects.toEqual(
      redirectsTo(`/login?next=${encodeURIComponent(`/habitaciones/${ROOM_ID}/fotos`)}`)
    );
  });

  it("habitación retirada: se pueden quitar fotos, pero no subir", async () => {
    setup({ rooms: [room({ status: "removed" })] });
    const html = await photosPage(ROOM_ID);
    expect(html).not.toContain('type="file"');
    expect(count(html, /name="imageId"/g)).toBe(2);
    expect(html).toContain("Esta habitación está retirada");
  });

  it("con 8 fotos no hay subida, y se explica", async () => {
    const images = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => worldImage(n));
    setup({ images, objects: images.map((i) => i.storage_path) });
    const html = await photosPage(ROOM_ID);
    expect(html).toContain("8 de 8");
    expect(html).not.toContain('type="file"');
    expect(html).toContain("Has llegado al máximo de 8 fotos");
  });

  it("si la firma falla: aviso, ninguna URL y sin subida", async () => {
    const world = setup();
    world.failures.storage.sign = () => ({ message: "sign 500 <interno>" });
    const html = await photosPage(ROOM_ID);
    expect(html).toContain("No hemos podido cargar las fotos");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("interno");
    expect(html).not.toContain('type="file"');
  });

  it("una foto sin URL (objeto ausente) se muestra como hueco, no como enlace roto", async () => {
    setup({ objects: [photo2.storage_path, theirs.storage_path] });
    const html = await photosPage(ROOM_ID);
    expect(count(html, /<img /g)).toBe(1);
    expect(html).toContain("No se ha podido cargar esta foto");
  });
});

describe("/habitaciones/[id]/borrar y /habitaciones/borrada", () => {
  it("propietaria: confirmación con el número de fotos y solo roomId en el formulario", async () => {
    setup();
    const html = await deletePage(ROOM_ID);
    expect(html).toContain("Borrar la habitación");
    expect(html).toContain("Se borrarán la habitación y sus 2 fotos.");
    expect(html).toContain(`name="roomId" value="${ROOM_ID}"`);
    expect(html).not.toContain('name="imageId"');
  });

  it("sin fotos, lo dice", async () => {
    setup({ images: [], objects: [] });
    expect(await deletePage(ROOM_ID)).toContain("que no tiene fotos");
  });

  it("habitación ajena (también para un admin) → 404", async () => {
    setup();
    await expect(deletePage(OTHER_ROOM_ID)).rejects.toEqual(notFoundError);
    setup({ profile: { role: "admin" } });
    await expect(deletePage(OTHER_ROOM_ID)).rejects.toEqual(notFoundError);
  });

  it("borrada: completa o con fotos pendientes, nunca completa si quedan", async () => {
    setup();
    const done = renderToStaticMarkup(
      await RoomDeletedPage({ searchParams: Promise.resolve({}) })
    );
    expect(done).toContain("La habitación y sus fotos se han borrado.");
    const pending = renderToStaticMarkup(
      await RoomDeletedPage({ searchParams: Promise.resolve({ fotos: "pendientes" }) })
    );
    expect(pending).toContain("quedan pendientes de limpieza");
    expect(pending).not.toContain("La habitación y sus fotos se han borrado.");
  });
});
