import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// La Server Action no se ejecuta aquí: solo se renderiza el HTML inicial.
vi.mock("@/app/actions/profile", () => ({ submitOwnProfile: async () => ({}) }));

import { OwnProfileForm } from "@/components/profile/own-profile-form";
import { ownProfileFormValues } from "@/lib/validation/own-profile-form";

/** Etiqueta `<input>` completa que contiene `marker` (el orden de atributos no importa). */
const inputWith = (html: string, marker: string) =>
  (html.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(marker)) ?? "";
const isChecked = (tag: string) => /\schecked(=""|\s|\/|>)/.test(tag);

const savedProfile = {
  full_name: "Ana García",
  date_of_birth: "2000-05-10",
  seeking_status: "has_room_looking_for_roommate",
  bio: null,
  email_notifications_enabled: false,
} as const;
const saved = ownProfileFormValues(savedProfile);

describe("ownProfileFormValues", () => {
  it("bio nula → cadena vacía; casilla marcada → 'on', sin marcar → ''", () => {
    expect(saved).toEqual({
      full_name: "Ana García",
      date_of_birth: "2000-05-10",
      seeking_status: "has_room_looking_for_roommate",
      bio: "",
      email_notifications_enabled: "",
    });
    expect(
      ownProfileFormValues({
        ...savedProfile,
        bio: "Hola",
        email_notifications_enabled: true,
      })
    ).toMatchObject({ bio: "Hola", email_notifications_enabled: "on" });
  });
});

describe("OwnProfileForm", () => {
  const html = renderToStaticMarkup(<OwnProfileForm initialValues={saved} />);

  it("se rellena con el perfil guardado", () => {
    expect(html).toContain('value="Ana García"');
    expect(html).toContain('value="2000-05-10"');
    expect(isChecked(inputWith(html, 'value="has_room_looking_for_roommate"'))).toBe(
      true
    );
    const radios = (html.match(/<input[^>]*>/g) ?? []).filter((tag) =>
      tag.includes('type="radio"')
    );
    expect(radios.filter(isChecked)).toHaveLength(1);
    const checkbox = inputWith(html, 'name="email_notifications_enabled"');
    expect(checkbox).toContain('type="checkbox"');
    expect(isChecked(checkbox)).toBe(false);
  });

  it("casilla marcada cuando el perfil tiene los avisos activados", () => {
    const checked = renderToStaticMarkup(
      <OwnProfileForm initialValues={{ ...saved, email_notifications_enabled: "on" }} />
    );
    expect(isChecked(inputWith(checked, 'name="email_notifications_enabled"'))).toBe(
      true
    );
  });

  it("solo contiene campos editables (ningún campo protegido)", () => {
    const names = [...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names)).toEqual(
      new Set([
        "full_name",
        "date_of_birth",
        "seeking_status",
        "bio",
        "email_notifications_enabled",
      ])
    );
  });

  it("cada campo tiene su etiqueta asociada", () => {
    for (const id of ["full_name", "date_of_birth", "bio"]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("<legend");
  });

  it("límites del navegador iguales a los del servidor, sin inventar otros", () => {
    expect(html).toMatch(
      /id="full_name"[^>]*maxLength="100"|maxLength="100"[^>]*id="full_name"/i
    );
    expect(html).toMatch(/maxLength="500"/i);
  });
});
