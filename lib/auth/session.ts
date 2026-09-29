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
import {
  DEACTIVATED_PATH,
  ONBOARDING_PREFERENCES_PATH,
  ONBOARDING_PROFILE_PATH,
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
