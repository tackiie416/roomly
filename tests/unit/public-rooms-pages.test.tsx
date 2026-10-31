import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeSupabase, type Call } from "./helpers/fake-supabase";
import {
  decodeRoomSearchCursor,
  encodeRoomSearchCursor,
} from "@/lib/validation/room-search";

const publicMock = vi.hoisted(() => ({ client: null as unknown, created: 0 }));
const serverMock = vi.hoisted(() => ({ created: 0 }));
const signMock = vi.hoisted(() => ({ paths: [] as string[][] }));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => {
    publicMock.created += 1;
    return publicMock.client;
  },
}));
// Las páginas públicas nunca usan el cliente de la sesión.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    serverMock.created += 1;
    throw new Error("las páginas públicas no leen la sesión");
  },
}));
// service_role solo firma (lib/services/room-images.ts).
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      throw new Error("service_role no lee tablas en las páginas públicas");
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          signMock.paths.push([...paths]);
          return {
            data: paths.map((path) => ({
              path,
              signedUrl: `https://signed.test/${path}?token=t`,
              error: null,
            })),
            error: null,
          };
        },
      }),
    },
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));

import SearchPage, {
  dynamic as searchDynamic,
  generateMetadata as searchMetadata,
} from "@/app/(marketing)/[city]/habitaciones/page";
import DetailPage, {
  dynamic as detailDynamic,
  generateMetadata as detailMetadata,
} from "@/app/(marketing)/[city]/habitaciones/[id]/page";
import { RoomForm } from "@/components/rooms/room-form";

// Fase 4.4 (sesión 71) — páginas públicas `/[city]/habitaciones` y su
// detalle: sin sesión, con el cliente de un visitante, 404 indistinguible,
// filtros GET, paginación que conserva filtros y orden, y metadatos SEO
// (canónica sin parámetros; variantes con noindex). El recorrido en el
// navegador, también sin JavaScript, está en E1 (public-rooms.spec.ts).

const CITY = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Barcelona",
  slug: "barcelona",
};
const HOOD = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Gràcia",
  slug: "gracia",
};
const roomId = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const imageId = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const notFoundError = expect.objectContaining({ notFound: true });

const card = (n: number) => ({
  id: roomId(n),
  title: `Habitación ${n}`,
  neighborhood_id: HOOD.id,
  price_month: 400 + n,
  expenses_included: true,
  available_from: "2026-12-01",
  total_rooms: 3,
  total_roommates: 2,
  published_at: `2026-10-30T09:00:00.${String(n).padStart(6, "0")}+00:00`,
});

const detailRow = {
  id: roomId(1),
  title: "Habitación luminosa",
  description: "Cerca del metro.",
  neighborhood_id: HOOD.id,
  price_month: 480,
  expenses_included: false,
  deposit_amount: 500,
  available_from: "2026-12-01",
  min_stay_months: 3,
  max_stay_months: 12,
  total_roommates: 2,
  total_rooms: 3,
  features: ["wifi"],
  pets_allowed: true,
  smoking_allowed: false,
  students_only: true,
  house_rules: "Silencio de noche.",
  roommate_preferences: "Gente tranquila.",
};

type World = {
  city?: unknown;
  rooms?: unknown[];
  room?: unknown;
  images?: unknown[];
};

let calls: Call[] = [];

function visitorWorld(world: World = {}) {
  const fake = createFakeSupabase({
    userId: null,
    respond: (call) => {
      if (call.table === "cities")
        return { data: world.city === undefined ? CITY : world.city, error: null };
      if (call.table === "neighborhoods")
        return call.terminal === "maybeSingle"
          ? { data: { name: HOOD.name }, error: null }
          : { data: [HOOD], error: null };
      if (call.table === "rooms")
        return call.terminal === "maybeSingle"
          ? { data: world.room === undefined ? null : world.room, error: null }
          : { data: world.rooms ?? [], error: null };
      if (call.table === "room_images") return { data: world.images ?? [], error: null };
      return { data: null, error: null };
    },
  });
  calls = fake.calls;
  publicMock.client = fake.client;
}

beforeEach(() => {
  publicMock.created = 0;
  serverMock.created = 0;
  signMock.paths = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://roomly.test");
});

const searchProps = (
  raw: Record<string, string | string[]> = {},
  city = "barcelona"
) => ({
  params: Promise.resolve({ city }),
  searchParams: Promise.resolve(raw),
});
const detailProps = (id: string, city = "barcelona") => ({
  params: Promise.resolve({ city, id }),
});
const renderSearch = async (raw: Record<string, string | string[]> = {}, city?: string) =>
  renderToStaticMarkup(await SearchPage(searchProps(raw, city)));
const renderDetail = async (id: string, city?: string) =>
  renderToStaticMarkup(await DetailPage(detailProps(id, city)));

/** El `href` del enlace con este texto. */
const hrefOf = (html: string, text: string) => {
  const match = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>${text}</a>`).exec(html);
  return match ? match[1].replaceAll("&amp;", "&") : null;
};

describe("dinámicas en cada petición, sin ISR", () => {
  it("las dos páginas exportan dynamic = force-dynamic", () => {
    expect(searchDynamic).toBe("force-dynamic");
    expect(detailDynamic).toBe("force-dynamic");
  });
});

describe("búsqueda pública", () => {
  it("sin sesión: lee con el cliente del visitante, nunca con el de la sesión", async () => {
    visitorWorld({ rooms: [card(1)] });
    const html = await renderSearch();
    expect(publicMock.created).toBeGreaterThan(0);
    expect(serverMock.created).toBe(0);
    expect(html).toContain("Habitaciones en Barcelona");
    expect(html).toContain("Habitación 1");
  });

  it("ciudad inexistente o inactiva: 404", async () => {
    visitorWorld({ city: null });
    await expect(renderSearch({}, "atlantida")).rejects.toEqual(notFoundError);
  });

  it("formulario GET con todos los filtros, el orden y sin cursor", async () => {
    visitorWorld();
    const html = await renderSearch();
    const form = /<form[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/barcelona/habitaciones"');
    const names = [
      ...new Set([...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1])),
    ].sort();
    expect(names).toEqual([
      "barrio",
      "caracteristica",
      "convivientes_max",
      "dormitorios_max",
      "entrada",
      "estudiantes",
      "fumar",
      "mascotas",
      "meses",
      "orden",
      "precio_max",
    ]);
    expect(html).toContain("Dormitorios de la vivienda, como máximo");
    expect(html).toContain("Personas con las que convivirás, como máximo");
    expect(html).toContain("Solo habitaciones exclusivas para estudiantes");
    for (const label of [
      "Más recientes",
      "Precio: de menor a mayor",
      "Precio: de mayor a menor",
      "Disponibilidad más próxima",
    ])
      expect(html).toContain(label);
    expect(html).not.toMatch(/Relevancia|Compatibilidad|Distancia/);
  });

  it("filtros no válidos: aviso, el formulario vacío y ninguna consulta de habitaciones", async () => {
    visitorWorld({ rooms: [card(1)] });
    const html = await renderSearch({ barrio: "eixample" });
    expect(html).toContain("Algún filtro de la búsqueda no es válido.");
    expect(html).toContain("Algún barrio no es de esta ciudad");
    expect(calls.some((c) => c.table === "rooms")).toBe(false);
    expect(html).not.toContain("Habitación 1");
    expect(html).not.toMatch(/name="barrio"[^>]*checked/);

    // Un parámetro desconocido (aquí, uno que intenta filtrar por la propietaria).
    const unknown = await renderSearch({ owner_id: roomId(9) });
    expect(unknown).toContain("La búsqueda tiene un parámetro que no reconocemos");
    expect(calls.some((c) => c.table === "rooms")).toBe(false);
  });

  it("tarjetas: barrio y ciudad, precio, disponibilidad, convivencia, portada firmada y enlace al detalle", async () => {
    visitorWorld({
      rooms: [card(1)],
      images: [
        {
          id: imageId(1),
          room_id: roomId(1),
          storage_path: `${roomId(1)}/${imageId(1)}.webp`,
          position: 0,
        },
      ],
    });
    const html = await renderSearch();
    expect(html).toContain("Gràcia, Barcelona");
    expect(html).toContain("401 €");
    expect(html).toContain("gastos incluidos");
    expect(html).toContain("Disponible desde el 1 de diciembre de 2026");
    expect(html).toContain("3 dormitorios en la vivienda");
    expect(html).toContain("Convivirás con 2 personas");
    expect(html).toContain(
      `src="https://signed.test/${roomId(1)}/${imageId(1)}.webp?token=t"`
    );
    expect(html).toContain(`href="/barcelona/habitaciones/${roomId(1)}"`);
    expect(signMock.paths).toEqual([[`${roomId(1)}/${imageId(1)}.webp`]]);
    // Atribución del catálogo de barrios (R1): los nombres salen de él.
    expect(html).toContain("Unidades administrativas de la ciudad de Barcelona");
  });

  it("paginación: el enlace siguiente conserva filtros y orden; el de vuelta quita el cursor", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => card(i + 1));
    visitorWorld({ rooms: rows });
    const raw = { barrio: "gracia", precio_max: "700", orden: "precio_desc" };
    const first = await renderSearch(raw);
    const next = hrefOf(first, "Página siguiente");
    expect(next).not.toBeNull();
    const url = new URL(next as string, "https://roomly.test");
    expect(url.pathname).toBe("/barcelona/habitaciones");
    expect(url.searchParams.getAll("barrio")).toEqual(["gracia"]);
    expect(url.searchParams.get("precio_max")).toBe("700");
    expect(url.searchParams.get("orden")).toBe("precio_desc");
    expect(
      decodeRoomSearchCursor(url.searchParams.get("cursor") as string, "precio_desc")
    ).toEqual({ order: "precio_desc", value: rows[19].price_month, id: rows[19].id });
    expect(first).not.toContain("Volver a la primera página");

    const cursor = encodeRoomSearchCursor({
      order: "precio_desc",
      value: 420,
      id: roomId(20),
    });
    visitorWorld({ rooms: rows.slice(0, 3) });
    const second = await renderSearch({ ...raw, cursor });
    expect(hrefOf(second, "Volver a la primera página")).toBe(
      "/barcelona/habitaciones?barrio=gracia&precio_max=700&orden=precio_desc"
    );
    expect(second).not.toContain("Página siguiente");
  });

  it("sin resultados: mensaje según haya filtros o no", async () => {
    visitorWorld({ rooms: [] });
    expect(await renderSearch()).toContain(
      "Todavía no hay habitaciones publicadas en Barcelona."
    );
    expect(await renderSearch({ mascotas: "si" })).toContain(
      "No hay habitaciones publicadas con estos filtros."
    );
  });

  it("nada de la propietaria ni de la dirección en la página", async () => {
    visitorWorld({
      rooms: [
        { ...card(1), owner_id: "ffffffff-0000-4000-8000-000000000000", status: "draft" },
      ],
    });
    const html = await renderSearch();
    expect(html).not.toMatch(/ffffffff|owner|draft|Borrador|propietari/i);
  });
});

describe("metadatos de la búsqueda", () => {
  it("sin parámetros: indexable, con la canónica de la ciudad", async () => {
    visitorWorld();
    const metadata = await searchMetadata(searchProps());
    expect(metadata).toMatchObject({
      title: "Habitaciones en Barcelona | Roomly",
      alternates: { canonical: "/barcelona/habitaciones" },
      robots: { index: true, follow: true },
    });
    expect(String(metadata.metadataBase)).toBe("https://roomly.test/");
  });

  it("con filtros, orden o cursor: noindex, follow y la misma canónica", async () => {
    visitorWorld();
    const variants: Array<Record<string, string>> = [
      { mascotas: "si" },
      { orden: "precio_asc" },
      { cursor: "abc" },
      { barrio: "gracia" },
    ];
    for (const raw of variants) {
      const metadata = await searchMetadata(searchProps(raw));
      expect(metadata).toMatchObject({
        alternates: { canonical: "/barcelona/habitaciones" },
        robots: { index: false, follow: true },
      });
    }
  });

  it("ciudad inexistente: noindex", async () => {
    visitorWorld({ city: null });
    expect(await searchMetadata(searchProps({}, "atlantida"))).toMatchObject({
      robots: { index: false },
    });
  });
});

describe("detalle público", () => {
  it("muestra la información aprobada, barrio y ciudad y las fotos firmadas", async () => {
    visitorWorld({
      room: detailRow,
      images: [
        { id: imageId(1), storage_path: `${roomId(1)}/${imageId(1)}.webp`, position: 0 },
      ],
    });
    const html = await renderDetail(roomId(1));
    for (const text of [
      "Habitación luminosa",
      "Gràcia, Barcelona",
      "480 €",
      "gastos aparte",
      "500 €",
      "1 de diciembre de 2026",
      "De 3 a 12 meses",
      "3 dormitorios en la vivienda",
      "Convivirás con 2 personas",
      "Se admiten",
      "No se puede fumar",
      "Solo para estudiantes",
      "Wi-Fi",
      "Cerca del metro.",
      "Silencio de noche.",
      "Gente tranquila.",
      "Unidades administrativas de la ciudad de Barcelona",
    ])
      expect(html).toContain(text);
    expect(html).toContain(
      `src="https://signed.test/${roomId(1)}/${imageId(1)}.webp?token=t"`
    );
    expect(publicMock.created).toBeGreaterThan(0);
    expect(serverMock.created).toBe(0);
  });

  it("404 indistinguible: id no válido, habitación no pública o inexistente, ciudad inexistente", async () => {
    visitorWorld({ room: null });
    await expect(renderDetail("no-es-un-uuid")).rejects.toEqual(notFoundError);
    await expect(renderDetail(roomId(1))).rejects.toEqual(notFoundError);
    visitorWorld({ city: null, room: detailRow });
    await expect(renderDetail(roomId(1), "atlantida")).rejects.toEqual(notFoundError);
  });

  it("metadatos: canónica del detalle, indexable; un 404 no se indexa", async () => {
    visitorWorld({ room: detailRow });
    expect(await detailMetadata(detailProps(roomId(1)))).toMatchObject({
      title: "Habitación luminosa · Habitación en Gràcia, Barcelona | Roomly",
      alternates: { canonical: `/barcelona/habitaciones/${roomId(1)}` },
      robots: { index: true, follow: true },
    });
    visitorWorld({ room: null });
    expect(await detailMetadata(detailProps(roomId(1)))).toMatchObject({
      robots: { index: false },
    });
  });
});

describe("aviso en el formulario de publicación", () => {
  it("pide no escribir datos de contacto ni la dirección, y lo enlazan el título y los textos", () => {
    const html = renderToStaticMarkup(
      <RoomForm
        action={async (state) => state}
        cities={[]}
        neighborhoods={[]}
        initialValues={{}}
        submitLabel="Guardar"
      />
    );
    expect(html).toContain('data-testid="room-public-text-warning"');
    expect(html).toContain(
      "No escribas teléfonos, correos, enlaces de contacto ni la dirección exacta"
    );
    expect(html).toContain("Roomly no revisa estos textos ni los quita");
    for (const field of ["title", "description", "house_rules", "roommate_preferences"])
      expect(html).toMatch(
        new RegExp(`id="${field}"[^>]*aria-describedby="[^"]*public-text-warning`)
      );
  });
});
