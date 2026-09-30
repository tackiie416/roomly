import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeSupabase, type Call } from "./helpers/fake-supabase";
import { TEST_USER, profileRow, type ProfileFixture } from "./helpers/profile-rows";

const serverMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverMock.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import OwnPreferencesPage from "@/app/(app)/preferencias/page";
import { preferencesFormValues } from "@/lib/validation/preferences-form";

const BCN = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const MAD = "4a2d7b5f-9c3e-4d2b-8f8a-3b7c6d5e4f32";
const OTHER_USER = "99999999-8888-4777-8666-555555555555";

const savedPreferences = {
  profile_id: TEST_USER,
  city_id: BCN,
  university_id: "u-upc",
  field_of_study: "Ingeniería",
  budget_min: null,
  budget_max: 15000,
  move_in_date: "2026-10-01",
  move_out_date: null,
  preferred_neighborhood_ids: ["n-gracia"],
  roommates_wanted_min: 1,
  roommates_wanted_max: 3,
  updated_at: "2026-09-29T10:00:00Z",
};

function as(
  fixture: ProfileFixture | "anonymous",
  preferences: Record<string, unknown> | null = savedPreferences
) {
  const fake = createFakeSupabase({
    userId: fixture === "anonymous" ? null : TEST_USER,
    respond: (call: Call) => {
      if (call.table === "profiles")
        return {
          data:
            fixture === "anonymous" || fixture === "no_profile"
              ? null
              : profileRow(fixture),
          error: null,
        };
      if (call.table === "housing_preferences") {
        // getProfileState solo pregunta si existen (columna profile_id).
        return { data: preferences, error: null };
      }
      if (call.table === "cities") {
        const ids = call.filters.find((f) => f.kind === "in")?.value as
          string[] | undefined;
        if (ids)
          return {
            data: ids.includes(MAD) ? [{ id: MAD, name: "Madrid" }] : [],
            error: null,
          };
        return { data: [{ id: BCN, name: "Barcelona" }], error: null };
      }
      if (call.table === "universities")
        return {
          data: [
            { id: "u-upc", name: "UPC", city_id: BCN },
            { id: "u-ucm", name: "UCM", city_id: MAD },
          ],
          error: null,
        };
      if (call.table === "neighborhoods")
        return {
          data: [
            { id: "n-gracia", name: "Gràcia", city_id: BCN },
            { id: "n-lavapies", name: "Lavapiés", city_id: MAD },
          ],
          error: null,
        };
      return { data: null, error: null };
    },
  });
  serverMock.createClient.mockResolvedValue(fake.client);
  return fake;
}

const redirectsTo = (url: string) => expect.objectContaining({ url });
const render = async () => renderToStaticMarkup(await OwnPreferencesPage());
const selectTag = (html: string, id: string) =>
  html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>`))?.[0] ?? "";

beforeEach(() => {
  serverMock.createClient.mockReset();
});

describe("/preferencias — guard antes de leer nada", () => {
  it.each([
    ["anonymous", "/login?next=%2Fpreferencias"],
    ["no_profile", "/bienvenida/perfil"],
    ["deleted", "/cuenta-desactivada"],
  ] as const)("%s → %s, sin leer preferencias", async (fixture, expected) => {
    const { calls } = as(fixture);
    await expect(OwnPreferencesPage()).rejects.toEqual(redirectsTo(expected));
    expect(
      calls.some(
        (call) => call.table === "housing_preferences" && call.columns !== "profile_id"
      )
    ).toBe(false);
  });
});

describe("/preferencias — contenido", () => {
  it("completo con preferencias: rellena lo guardado y la ciudad es obligatoria", async () => {
    as("complete");
    const html = await render();
    expect(selectTag(html, "city_id")).toContain("required");
    expect(html).toContain('value="15000"');
    expect(html).toContain('value="Ingeniería"');
    expect(html).toContain("Gràcia");
    expect(html).not.toContain("Lavapiés");
    expect(html).not.toContain("UCM");
    expect(html).not.toContain("Termínala aquí");
    expect(html).toContain("Guardar preferencias");
  });

  it("incompleto: ciudad opcional y aviso para terminar el onboarding", async () => {
    as("incomplete");
    const html = await render();
    expect(selectTag(html, "city_id")).not.toContain("required");
    expect(html).toContain('href="/bienvenida/preferencias"');
  });

  it("sin preferencias: formulario vacío y aviso", async () => {
    as("complete", null);
    const html = await render();
    expect(html).toContain("Aún no tienes preferencias guardadas.");
    expect(html).not.toContain('value="15000"');
  });

  it("ciudad guardada ya inactiva: se muestra para poder conservarla", async () => {
    as("complete", {
      ...savedPreferences,
      city_id: MAD,
      university_id: null,
      preferred_neighborhood_ids: [],
    });
    const html = await render();
    expect(html).toMatch(/<option[^>]*value="4a2d7b5f[^"]*"[^>]*>Madrid<\/option>/);
    expect(html).toContain("Barcelona");
  });

  it("solo lee las preferencias de la sesión e ignora cualquier id de la URL", async () => {
    const { calls } = as("complete");
    const page = OwnPreferencesPage as unknown as (
      props: unknown
    ) => Promise<React.ReactElement>;
    renderToStaticMarkup(
      await page({
        params: Promise.resolve({ id: OTHER_USER }),
        searchParams: Promise.resolve({ profile_id: OTHER_USER }),
      })
    );
    const reads = calls.filter((call) => call.table === "housing_preferences");
    expect(reads.length).toBeGreaterThan(0);
    for (const call of reads) {
      expect(call.filters).toEqual([
        { kind: "eq", column: "profile_id", value: TEST_USER },
      ]);
    }
    expect(calls.every((call) => call.filters.every((f) => f.value !== OTHER_USER))).toBe(
      true
    );
  });

  it("no ofrece campos protegidos", async () => {
    as("complete");
    const html = await render();
    for (const name of ["profile_id", "role", "deleted_at", "onboarding_completed_at"]) {
      expect(html).not.toContain(`name="${name}"`);
    }
  });
});

describe("preferencesFormValues", () => {
  it("nulos → cadena vacía, números → texto, barrios tal cual", () => {
    expect(preferencesFormValues(savedPreferences)).toEqual({
      city_id: BCN,
      university_id: "u-upc",
      field_of_study: "Ingeniería",
      budget_min: "",
      budget_max: "15000",
      move_in_date: "2026-10-01",
      move_out_date: "",
      preferred_neighborhood_ids: ["n-gracia"],
      roommates_wanted_min: "1",
      roommates_wanted_max: "3",
    });
  });
});
