import { createClient } from "@/lib/supabase/server";
import { requireOnboardingStep } from "@/lib/auth/session";
import { getHousingPreferences } from "@/lib/services/housing-preferences";
import {
  listActiveCities,
  listNeighborhoods,
  listUniversities,
} from "@/lib/services/reference-data";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  PreferencesForm,
  type PreferencesInitialValues,
} from "@/components/onboarding/preferences-form";
import { Card } from "@/components/ui/card";

/**
 * Paso 2 del onboarding (`/bienvenida/preferencias`). Solo con perfil y
 * onboarding sin completar (guard de 2.2). Lee en el servidor los datos de
 * referencia y, si ya existen, las preferencias guardadas para rellenar el
 * formulario (lecturas vía servicios; las escrituras van por la Server Action
 * `submitOnboardingPreferences`).
 */

class OnboardingDataUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar el formulario. Vuelve a intentarlo en un momento.");
    this.name = "OnboardingDataUnavailableError";
  }
}

export default async function OnboardingPreferencesPage() {
  const state = await requireOnboardingStep("preferencias");
  const supabase = await createClient();

  const cities = await listActiveCities(supabase);
  if (!cities.ok) throw new OnboardingDataUnavailableError();
  const cityIds = cities.data.map((city) => city.id);

  const [universities, neighborhoods, saved] = await Promise.all([
    listUniversities(supabase, cityIds),
    listNeighborhoods(supabase, cityIds),
    state.status === "incomplete" && state.hasPreferences
      ? getHousingPreferences(supabase)
      : Promise.resolve(null),
  ]);
  if (!universities.ok || !neighborhoods.ok || (saved && !saved.ok)) {
    throw new OnboardingDataUnavailableError();
  }

  const initialValues: PreferencesInitialValues = {};
  if (saved?.ok && saved.data) {
    const preferences = saved.data;
    const asText = (value: string | number | null) =>
      value === null ? "" : String(value);
    initialValues.city_id = asText(preferences.city_id);
    initialValues.university_id = asText(preferences.university_id);
    initialValues.field_of_study = asText(preferences.field_of_study);
    initialValues.budget_min = asText(preferences.budget_min);
    initialValues.budget_max = asText(preferences.budget_max);
    initialValues.move_in_date = asText(preferences.move_in_date);
    initialValues.move_out_date = asText(preferences.move_out_date);
    initialValues.roommates_wanted_min = asText(preferences.roommates_wanted_min);
    initialValues.roommates_wanted_max = asText(preferences.roommates_wanted_max);
    initialValues.preferred_neighborhood_ids = preferences.preferred_neighborhood_ids;
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-6">
        <div>
          <p className="text-xs text-[var(--muted)]">Paso 2 de 2</p>
          <h1 className="mt-1 text-xl font-medium">Tus preferencias de vivienda</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Solo la ciudad es obligatoria. El resto nos ayuda a afinar tus matches.
          </p>
        </div>
        <PreferencesForm
          cities={cities.data}
          universities={universities.data}
          neighborhoods={neighborhoods.data}
          initialValues={initialValues}
        />
      </Card>
      <div className="mt-4 self-center">
        <SignOutButton />
      </div>
    </main>
  );
}
