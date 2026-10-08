import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getProfileState,
  isActiveAdmin,
  type OwnProfile,
  type ProfileState,
} from "@/lib/services/profile";
import type { ServiceResult } from "@/lib/services/result";
import { getOwnQuestionnaire, type OwnQuestionnaire } from "@/lib/services/compatibility";
import {
  DEACTIVATED_PATH,
  EXPLORE_PATH,
  ONBOARDING_PREFERENCES_PATH,
  ONBOARDING_PROFILE_PATH,
  TEST_PATH,
  loginPath,
  resolveDestination,
} from "@/lib/auth/destination";

/**
 * Estado de sesión/perfil y guards de servidor (Fase 2.2).
 *
 * El estado sale de `getProfileState` (Fase 2.1), sin repetir su lógica, y
 * los destinos de `resolveDestination`. `proxy.ts` solo bloquea a anónimos;
 * la decisión por estado del perfil se toma aquí, en el servidor, antes de
 * renderizar: nunca en el cliente.
 */

/**
 * Estado del perfil de la sesión, una sola vez por petición: `cache()` de
 * React lo memoiza durante el render de servidor, así que layout y página
 * comparten la misma consulta.
 */
export const getCurrentProfileState = cache(
  async (): Promise<ServiceResult<ProfileState>> => getProfileState(await createClient())
);

/**
 * Error genérico si el estado no se puede determinar (fallo de base de datos,
 * no de sesión). No se redirige para no crear bucles, y no se muestra el
 * mensaje de Supabase.
 */
class ProfileStateUnavailableError extends Error {
  constructor() {
    super("No hemos podido comprobar tu cuenta. Vuelve a intentarlo en un momento.");
    this.name = "ProfileStateUnavailableError";
  }
}

/** Estado de la sesión, o redirección a `/login` si no hay sesión. */
async function requireSessionState(currentPath?: string): Promise<ProfileState> {
  const result = await getCurrentProfileState();
  if (result.ok) return result.data;
  if (result.error === "unauthenticated") redirect(loginPath({ next: currentPath }));
  throw new ProfileStateUnavailableError();
}

/** Páginas de la aplicación: exige onboarding completo. */
export async function requireCompleteProfile(currentPath?: string): Promise<OwnProfile> {
  const state = await requireSessionState(currentPath);
  if (state.status !== "complete") redirect(resolveDestination(state));
  return state.profile;
}

export const OWN_PROFILE_PATH = "/perfil";

/** Estados en los que existe un perfil propio activo que se puede editar. */
export type EditableProfileState = Extract<
  ProfileState,
  { status: "incomplete" } | { status: "complete" }
>;

export const OWN_PREFERENCES_PATH = "/preferencias";
export const SETTINGS_PATH = "/ajustes";

/**
 * Datos propios editables (`/perfil`, Fase 2.4; `/preferencias`, Fase 2.5;
 * `/ajustes`, Fase 2.6):
 * siempre los de la sesión, nunca un id de la URL. Sin perfil → paso 1 del
 * onboarding; cuenta eliminada → pantalla de cuenta desactivada. Incompleto
 * y completo pueden editar (con el onboarding sin terminar, la página lo
 * indica). `currentPath` solo sirve para volver tras el login.
 */
export async function requireOwnProfile(
  currentPath:
    | typeof OWN_PROFILE_PATH
    | typeof OWN_PREFERENCES_PATH
    | typeof SETTINGS_PATH = OWN_PROFILE_PATH
): Promise<EditableProfileState> {
  const state = await requireSessionState(currentPath);
  if (state.status === "no_profile" || state.status === "deleted") {
    redirect(resolveDestination(state));
  }
  return state;
}

const ONBOARDING_STEP_PATHS = {
  perfil: ONBOARDING_PROFILE_PATH,
  preferencias: ONBOARDING_PREFERENCES_PATH,
} as const;

export type OnboardingStep = keyof typeof ONBOARDING_STEP_PATHS;

/**
 * Pasos del onboarding: solo se entra en el paso que corresponde al estado
 * (sin perfil → perfil; incompleto → preferencias). Con el perfil completo
 * se sale a la aplicación y con la cuenta eliminada, a la pantalla de cuenta
 * desactivada. Así el acceso directo a un paso que no toca no es posible.
 */
export async function requireOnboardingStep(step: OnboardingStep): Promise<ProfileState> {
  const state = await requireSessionState(ONBOARDING_STEP_PATHS[step]);
  const destination = resolveDestination(state);
  if (destination !== ONBOARDING_STEP_PATHS[step]) redirect(destination);
  return state;
}

/** Pantalla de cuenta desactivada: solo para cuentas con `deleted_at`. */
export async function requireDeletedAccount(): Promise<void> {
  const state = await requireSessionState(DEACTIVATED_PATH);
  if (state.status !== "deleted") redirect(resolveDestination(state));
}

/**
 * Panel de administración: rol admin **y** cuenta no eliminada. Es una
 * protección de routing/UI; en la base de datos, `is_admin()` sigue siendo
 * la defensa de los datos. Quien no es admin vuelve a donde le toca según su
 * estado.
 */
export async function requireAdmin(): Promise<void> {
  const state = await requireSessionState("/admin");
  if (state.status === "deleted" || state.status === "no_profile") {
    redirect(resolveDestination(state));
  }

  const admin = await isActiveAdmin(await createClient());
  if (!admin.ok) {
    if (admin.error === "unauthenticated") redirect(loginPath({ next: "/admin" }));
    throw new ProfileStateUnavailableError();
  }
  if (!admin.data) redirect(resolveDestination(state));
}

/**
 * Estado del test propio, una sola vez por petición (Fase 3.5). Lo calcula
 * `getOwnQuestionnaire` con `questionnaireStatus`, la única función que decide
 * el estado, y con el cliente del usuario: nunca service_role.
 */
export const getCurrentQuestionnaire = cache(
  async (): Promise<ServiceResult<OwnQuestionnaire>> =>
    getOwnQuestionnaire(await createClient())
);

/** Error genérico si el estado del test no se puede usar (fallo de base de datos o versión desconocida). */
class QuestionnaireUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar tu test. Vuelve a intentarlo en un momento.");
    this.name = "QuestionnaireUnavailableError";
  }
}

/**
 * `/test` y `/explorar`: onboarding completo (si no, a donde toque) y el
 * estado del test. Una versión guardada posterior a la vigente
 * (`unsupported`, no debería pasar nunca) es un error genérico: fallo cerrado.
 * No redirige según el estado del test: `/test` se puede abrir en cualquier
 * estado, también para editar uno completado.
 */
export async function requireQuestionnaire(
  currentPath: typeof TEST_PATH | typeof EXPLORE_PATH
): Promise<OwnQuestionnaire> {
  await requireCompleteProfile(currentPath);
  const result = await getCurrentQuestionnaire();
  if (!result.ok) {
    if (result.error === "unauthenticated") redirect(loginPath({ next: currentPath }));
    throw new QuestionnaireUnavailableError();
  }
  if (result.data.status === "unsupported") throw new QuestionnaireUnavailableError();
  return result.data;
}

/**
 * `/explorar`: exige el test completado en la versión vigente. Sin test, en
 * borrador o desactualizado → 307 a `/test` (que nunca redirige según el
 * estado del test, así que no hay bucle).
 */
export async function requireCompletedQuestionnaire(): Promise<OwnQuestionnaire> {
  const questionnaire = await requireQuestionnaire(EXPLORE_PATH);
  if (questionnaire.status !== "completed") redirect(TEST_PATH);
  return questionnaire;
}
