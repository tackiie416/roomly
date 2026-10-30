import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BCN,
  GRACIA,
  MAD,
  LAVAPIES,
  OTHER_ROOM_ID,
  OTHER_USER,
  ROOM_ID,
  completeRoom,
  createRoomWorld,
  room,
} from "./helpers/room-world";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
const adminMock = vi.hoisted(() => ({ created: 0 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminMock.created += 1;
    throw new Error("estas páginas no usan service_role");
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

import OwnRoomsPage from "@/app/(app)/habitaciones/page";
import NewRoomPage from "@/app/(app)/habitaciones/nueva/page";
import EditRoomPage from "@/app/(app)/habitaciones/[id]/editar/page";

// CRUD de habitaciones (sesión 68): qué ve cada persona en el listado, el
// alta y la edición, con los servicios reales sobre el mundo en memoria. El
// recorrido completo, también sin JavaScript, está en E1 (rooms-crud.spec.ts).

const notFoundError = expect.objectContaining({ notFound: true });
const redirectsTo = (url: string) => expect.objectContaining({ url });
const ATTRIBUTION = /© Ajuntament de Barcelona,.*Open Data BCN.*CC BY 4\.0/;

beforeEach(() => {
  serverMock.createClient.mockReset();
  adminMock.created = 0;
});

function setup(options: Parameters<typeof createRoomWorld>[0] = {}) {
  const world = createRoomWorld({
    rooms: [
      room({ title: "Mi borrador" }),
      completeRoom({
        id: OTHER_ROOM_ID,
        owner_id: OTHER_USER,
        status: "active",
        title: "La de otra persona",
      }),
    ],
    owners: { [OTHER_USER]: null },
    ...options,
  });
  serverMock.createClient.mockResolvedValue(world.userClient);
  return world;
}

const listPage = async () => renderToStaticMarkup(await OwnRoomsPage());
const newPage = async () => renderToStaticMarkup(await NewRoomPage());
const editPage = async (id: string) =>
  renderToStaticMarkup(await EditRoomPage({ params: Promise.resolve({ id }) }));

/** Nombres de los campos de un formulario renderizado. */
const fieldNames = (html: string) =>
  [...new Set([...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1]))].sort();

const ROOM_FORM_NAMES = [
  "available_from",
  "city_id",
  "deposit_amount",
  "description",
  "expenses_included",
  "features",
  "house_rules",
  "max_stay_months",
  "min_stay_months",
  "neighborhood_id",
  "pets_allowed",
  "price_month",
  "roommate_preferences",
  "smoking_allowed",
  "students_only",
  "title",
  "total_roommates",
  "total_rooms",
];

describe("/habitaciones", () => {
  it("lista solo las propias, con su estado, ubicación y enlaces de gestión", async () => {
    setup({
      rooms: [
        room({ title: "Mi borrador" }),
        completeRoom({
          id: "abababab-3333-4444-8555-666666666666",
          title: "Mi publicada",
          status: "active",
          neighborhood_id: GRACIA,
        }),
        completeRoom({ id: OTHER_ROOM_ID, owner_id: OTHER_USER, status: "active" }),
      ],
    });
    const html = await listPage();
    expect(html).toContain("Mi borrador");
    expect(html).toContain("Mi publicada");
    expect(html).not.toContain(OTHER_ROOM_ID);
    expect(html).toContain("Borrador");
    expect(html).toContain("Publicada");
    expect(html).toContain("Gràcia, Barcelona");
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/editar"`);
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/fotos"`);
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/borrar"`);
    expect(html).toContain('href="/habitaciones/nueva"');
    // Lo que le falta al borrador para publicarse.
    expect(html).toContain("Para publicarla:");
    expect(html).toMatch(ATTRIBUTION);
    expect(html).not.toMatch(/approx_|address|dirección exacta/i);
    expect(adminMock.created).toBe(0);
  });

  it("sin habitaciones: lo dice y enlaza al alta", async () => {
    setup({ rooms: [] });
    const html = await listPage();
    expect(html).toContain("Todavía no tienes habitaciones");
    expect(html).toContain('href="/habitaciones/nueva"');
  });

  it("un admin ve solo las suyas: no es la moderación", async () => {
    setup({ profile: { role: "admin" } });
    const html = await listPage();
    expect(html).toContain("Mi borrador");
    expect(html).not.toContain("La de otra persona");
  });

  it("sin sesión → /login; cuenta desactivada → /cuenta-desactivada; sin perfil → onboarding", async () => {
    setup({ userId: null });
    await expect(listPage()).rejects.toEqual(redirectsTo("/login?next=%2Fhabitaciones"));
    setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(listPage()).rejects.toEqual(redirectsTo("/cuenta-desactivada"));
    setup({ profile: null });
    await expect(listPage()).rejects.toEqual(redirectsTo("/bienvenida/perfil"));
  });
});

describe("/habitaciones/nueva", () => {
  it("formulario completo, sin dirección exacta, estado ni propietario, con la atribución de los barrios", async () => {
    setup();
    const html = await newPage();
    expect(html).toContain("Nueva habitación");
    expect(fieldNames(html)).toEqual(ROOM_FORM_NAMES);
    expect(html).not.toMatch(
      /name="(owner_id|status|deleted_at|approx_\w+|address\w*|roomId)"/
    );
    // Solo ciudades activas; barrios agrupados por ciudad (sin JavaScript).
    expect(html).toContain(`value="${BCN}"`);
    expect(html).not.toContain(`value="${MAD}"`);
    expect(html).toMatch(/<optgroup label="Barcelona">/);
    expect(html).toContain(`value="${GRACIA}"`);
    expect(html).not.toContain(`value="${LAVAPIES}"`);
    expect(html).toMatch(ATTRIBUTION);
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/deed.es"');
    expect(html).toContain("nunca la dirección exacta");
    // «Solo estudiantes» es explícito: dos radios, ninguno marcado.
    expect(html.match(/type="radio"[^>]*name="students_only"/g)).toHaveLength(2);
    expect(html).not.toMatch(/name="students_only"[^>]*checked/);
    expect(html).toContain("Crear borrador");
  });

  it("cuenta desactivada → /cuenta-desactivada, sin leer nada más", async () => {
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(newPage()).rejects.toEqual(redirectsTo("/cuenta-desactivada"));
    expect(world.userCalls.filter((c) => c.table === "cities")).toEqual([]);
  });

  it("sin sesión → /login con vuelta al alta", async () => {
    setup({ userId: null });
    await expect(newPage()).rejects.toEqual(
      redirectsTo("/login?next=%2Fhabitaciones%2Fnueva")
    );
  });
});

describe("/habitaciones/[id]/editar", () => {
  it("propietaria: formulario relleno, estado, enlaces a fotos y borrado y roomId oculto", async () => {
    setup({
      rooms: [
        room({
          title: "Mi borrador",
          neighborhood_id: GRACIA,
          features: ["wifi"],
          students_only: false,
        }),
      ],
    });
    const html = await editPage(ROOM_ID);
    expect(html).toContain("Editar habitación");
    expect(html).toMatch(
      /name="title"[^>]*value="Mi borrador"|value="Mi borrador"[^>]*name="title"/
    );
    expect(html).toContain(`<input type="hidden" name="roomId" value="${ROOM_ID}"/>`);
    expect(html).toMatch(/value="false"[^>]*checked|checked[^>]*value="false"/);
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/fotos"`);
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/borrar"`);
    expect(html).toContain('data-testid="room-status"');
    // Cambios de estado: los otros tres de R7, nunca removed.
    expect(html).toContain('name="status" value="active"');
    expect(html).toContain('name="status" value="paused"');
    expect(html).toContain('name="status" value="rented"');
    expect(html).not.toContain('name="status" value="draft"');
    expect(html).not.toContain('value="removed"');
    // Falta lo que exige la publicación.
    expect(html).toContain("Para publicarla te falta");
    expect(html).toMatch(ATTRIBUTION);
    expect(adminMock.created).toBe(0);
  });

  it("publicada y completa: sin aviso de lo que falta, y puede pausar o marcar alquilada", async () => {
    setup({ rooms: [completeRoom({ status: "active" })] });
    const html = await editPage(ROOM_ID);
    expect(html).not.toContain("Para publicarla te falta");
    expect(html).toContain('name="status" value="paused"');
    expect(html).toContain('name="status" value="draft"');
    expect(html).not.toContain('name="status" value="active"');
  });

  it("ciudad guardada que ya no está activa: se muestra para conservarla", async () => {
    setup({ rooms: [room({ city_id: MAD, neighborhood_id: LAVAPIES })] });
    const html = await editPage(ROOM_ID);
    expect(html).toContain(`value="${MAD}"`);
    expect(html).toContain(`value="${LAVAPIES}"`);
  });

  it("retirada por moderación: sin formularios, con fotos y borrado", async () => {
    setup({ rooms: [completeRoom({ status: "removed" })] });
    const html = await editPage(ROOM_ID);
    expect(html).toContain("retirada por moderación");
    expect(html).not.toContain("<form");
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/fotos"`);
    expect(html).toContain(`href="/habitaciones/${ROOM_ID}/borrar"`);
  });

  it("ajena (también pública) → 404 para otra persona y para un admin", async () => {
    setup();
    await expect(editPage(OTHER_ROOM_ID)).rejects.toEqual(notFoundError);
    setup({ profile: { role: "admin" } });
    await expect(editPage(OTHER_ROOM_ID)).rejects.toEqual(notFoundError);
  });

  it("id no válido → 404; con borrado lógico → 404", async () => {
    setup();
    await expect(editPage("no-es-un-uuid")).rejects.toEqual(notFoundError);
    setup({ rooms: [room({ deleted_at: "2026-10-06T10:00:00Z" })] });
    await expect(editPage(ROOM_ID)).rejects.toEqual(notFoundError);
  });

  it("sin sesión → /login con vuelta a la edición; cuenta desactivada → /cuenta-desactivada", async () => {
    setup({ userId: null });
    await expect(editPage(ROOM_ID)).rejects.toEqual(
      redirectsTo(`/login?next=${encodeURIComponent(`/habitaciones/${ROOM_ID}/editar`)}`)
    );
    const world = setup({ profile: { deleted_at: "2026-10-20T10:00:00Z" } });
    await expect(editPage(ROOM_ID)).rejects.toEqual(redirectsTo("/cuenta-desactivada"));
    expect(world.userCalls.filter((c) => c.table === "rooms")).toEqual([]);
  });
});
