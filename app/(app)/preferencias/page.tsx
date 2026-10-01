import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OWN_PREFERENCES_PATH, requireOwnProfile } from "@/lib/auth/session";
import { ONBOARDING_PREFERENCES_PATH } from "@/lib/auth/destination";
import { submitOwnPreferences } from "@/app/actions/housing-preferences";
import { getHousingPreferences } from "@/lib/services/housing-preferences";
import {
  listActiveCities,
  listCitiesByIds,
  listNeighborhoods,
  listUniversities,
} from "@/lib/services/reference-data";
import { preferencesFormValues } from "@/lib/validation/preferences-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PreferencesForm } from "@/components/onboarding/preferences-form";
import { Card } from "@/components/ui/card";

/**
 * Preferencias de vivienda propias (`/preferencias`, Fase 2.5). Siempre las
 * de la sesión: la ruta no tiene ningún parámetro de perfil. El guard va en
 * la propia página: sin perfil → onboarding, cuenta eliminada →
 * `/cuenta-desactivada`, antes de leer nada más. Lecturas vía servicios (las
 * preferencias solo son legibles por su dueño, RLS); la escritura va por
 * `submitOwnPreferences`. Con el onboarding completado la ciudad es
 * obligatoria; sin completar, todo es opcional y se indica cómo terminarlo.
 */

class PreferencesUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar tus preferencias. Vuelve a intentarlo en un momento.");
    this.name = "PreferencesUnavailableError";
  }
}

export default async function OwnPreferencesPage() {
  const state = await requireOwnProfile(OWN_PREFERENCES_PATH);
  const supabase = await createClient();

  const [activeCities, saved] = await Promise.all([
    listActiveCities(supabase),
    getHousingPreferences(supabase),
  ]);
  if (!activeCities.ok || !saved.ok) throw new PreferencesUnavailableError();
  const preferences = saved.data;

  // La ciudad guardada se muestra aunque ya no esté activa (se puede
  // conservar, no elegir de nuevo).
  let cities = activeCities.data;
  const savedCityId = preferences?.city_id ?? null;
  if (savedCityId && !cities.some((city) => city.id === savedCityId)) {
    const savedCity = await listCitiesByIds(supabase, [savedCityId]);
    if (!savedCity.ok) throw new PreferencesUnavailableError();
    cities = [...cities, ...savedCity.data];
  }
  const cityIds = cities.map((city) => city.id);

  const [universities, neighborhoods] = await Promise.all([
    listUniversities(supabase, cityIds),
    listNeighborhoods(supabase, cityIds),
  ]);
  if (!universities.ok || !neighborhoods.ok) throw new PreferencesUnavailableError();

  const completed = state.status === "complete";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-medium">Tus preferencias de vivienda</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {completed
              ? "La ciudad es obligatoria. El resto nos ayuda a afinar tus matches."
              : "Todo es opcional hasta que termines de configurar tu cuenta."}
          </p>
        </div>
        {!completed ? (
          <p className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm">
            Todavía no has terminado de configurar tu cuenta.{" "}
            <Link href={ONBOARDING_PREFERENCES_PATH} className="underline">
              Termínala aquí
            </Link>{" "}
            (hace falta elegir ciudad).
          </p>
        ) : null}
        {preferences === null ? (
          <p className="text-sm text-[var(--muted)]">
            Aún no tienes preferencias guardadas.
          </p>
        ) : null}
        <PreferencesForm
          cities={cities}
          universities={universities.data}
          neighborhoods={neighborhoods.data}
          initialValues={preferences ? preferencesFormValues(preferences) : {}}
          submitAction={submitOwnPreferences}
          submitLabel="Guardar preferencias"
          cityRequired={completed}
        />
      </Card>
      <div className="mt-4 self-center">
        <SignOutButton />
      </div>
    </main>
  );
}
