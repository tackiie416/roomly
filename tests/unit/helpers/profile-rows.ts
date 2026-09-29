import type { Call, FakeResponse, Responder } from "./fake-supabase";

/**
 * Respuestas del cliente simulado para cada estado del perfil, tal y como
 * las leen `getProfileState` e `isActiveAdmin`.
 */

export const TEST_USER = "11111111-2222-4333-8444-555555555555";

export type ProfileFixture = "no_profile" | "incomplete" | "complete" | "deleted";

export function profileRow(
  fixture: Exclude<ProfileFixture, "no_profile">,
  role = "user"
) {
  return {
    id: TEST_USER,
    full_name: "Ana García",
    date_of_birth: "2000-05-10",
    bio: null,
    seeking_status: "looking_for_room",
    email_notifications_enabled: true,
    onboarding_completed_at: fixture === "complete" ? "2026-09-20T10:00:00Z" : null,
    deleted_at: fixture === "deleted" ? "2026-09-25T10:00:00Z" : null,
    role,
  };
}

/** Responder según el estado del perfil (y el rol, para /admin). */
export function respondAs(fixture: ProfileFixture, role = "user"): Responder {
  return (call: Call): FakeResponse => {
    if (call.table === "profiles") {
      return {
        data: fixture === "no_profile" ? null : profileRow(fixture, role),
        error: null,
      };
    }
    if (call.table === "housing_preferences") return { data: null, error: null };
    return { data: null, error: null };
  };
}
