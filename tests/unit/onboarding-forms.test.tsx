import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Las Server Actions no se ejecutan aquí: solo se renderiza el HTML inicial.
vi.mock("@/app/actions/onboarding", () => ({
  submitOnboardingProfile: async () => ({}),
  submitOnboardingPreferences: async () => ({}),
}));

import {
  ProfileForm,
  SEEKING_STATUS_OPTIONS,
} from "@/components/onboarding/profile-form";
import { PreferencesForm } from "@/components/onboarding/preferences-form";

const CITY = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";
const OTHER_CITY = "4a2d7b5f-9c3e-4d2b-8f8a-3b7c6d5e4f32";

describe("ProfileForm", () => {
  const html = renderToStaticMarkup(<ProfileForm />);

  it("ofrece los tres valores del enum como radios obligatorios", () => {
    for (const option of SEEKING_STATUS_OPTIONS) {
      expect(html).toContain(`value="${option.value}"`);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/type="radio"[^>]*required/g)).toHaveLength(3);
  });

  it("NINGÚN radio de seeking_status está preseleccionado (tampoco flexible)", () => {
    expect(html).not.toMatch(/type="radio"[^>]*checked/);
    expect(html).not.toMatch(/checked=""[^>]*type="radio"/);
  });

  it("no incluye campos protegidos", () => {
    for (const name of [
      "profile_id",
      "role",
      "deleted_at",
      "onboarding_completed_at",
      "avatar_url",
    ]) {
      expect(html).not.toContain(`name="${name}"`);
    }
  });

  it("nombre y fecha obligatorios", () => {
    expect(html).toMatch(/name="full_name"[^>]*required|required[^>]*name="full_name"/);
    expect(html).toMatch(
      /name="date_of_birth"[^>]*required|required[^>]*name="date_of_birth"/
    );
  });
});

describe("PreferencesForm", () => {
  const props = {
    cities: [
      { id: CITY, name: "Barcelona" },
      { id: OTHER_CITY, name: "Madrid" },
    ],
    universities: [
      { id: "u1", name: "UPC", city_id: CITY },
      { id: "u2", name: "UCM", city_id: OTHER_CITY },
    ],
    neighborhoods: [
      { id: "n1", name: "Gràcia", city_id: CITY },
      { id: "n2", name: "Lavapiés", city_id: OTHER_CITY },
    ],
  };

  it("sin datos guardados: ciudad obligatoria y sin elegir; sin barrios hasta elegir ciudad", () => {
    const html = renderToStaticMarkup(<PreferencesForm {...props} initialValues={{}} />);
    expect(html).toMatch(/name="city_id"[^>]*required|required[^>]*name="city_id"/);
    expect(html).toContain("Elige primero una ciudad.");
    expect(html).not.toContain('name="preferred_neighborhood_ids"');
  });

  it("con ciudad guardada: solo barrios y universidades de esa ciudad", () => {
    const html = renderToStaticMarkup(
      <PreferencesForm
        {...props}
        initialValues={{
          city_id: CITY,
          preferred_neighborhood_ids: ["n1"],
          budget_max: "15000",
        }}
      />
    );
    expect(html).toContain("Gràcia");
    expect(html).not.toContain("Lavapiés");
    expect(html).toContain("UPC");
    expect(html).not.toContain("UCM");
    expect(html).toMatch(/value="n1"[^>]*checked|checked[^>]*value="n1"/);
    expect(html).toContain('value="15000"');
  });

  it("no incluye profile_id ni onboarding_completed_at", () => {
    const html = renderToStaticMarkup(<PreferencesForm {...props} initialValues={{}} />);
    expect(html).not.toContain('name="profile_id"');
    expect(html).not.toContain('name="onboarding_completed_at"');
  });

  it("los números no tienen máximo (sin techos)", () => {
    const html = renderToStaticMarkup(<PreferencesForm {...props} initialValues={{}} />);
    expect(html).not.toMatch(/type="number"[^>]*max=/);
  });
});
