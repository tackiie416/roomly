import { requireOnboardingStep } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ProfileForm } from "@/components/onboarding/profile-form";
import { Card } from "@/components/ui/card";

/**
 * Paso 1 del onboarding (`/bienvenida/perfil`). Solo para quien no tiene
 * perfil todavía (guard de 2.2); el formulario envía a
 * `submitOnboardingProfile`, que vuelve a comprobar el paso.
 */
export default async function OnboardingProfilePage() {
  await requireOnboardingStep("perfil");

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-6">
        <div>
          <p className="text-xs text-[var(--muted)]">Paso 1 de 2</p>
          <h1 className="mt-1 text-xl font-medium">Crea tu perfil</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Lo básico para empezar a encontrar compañeros compatibles.
          </p>
        </div>
        <ProfileForm />
      </Card>
      <div className="mt-4 self-center">
        <SignOutButton />
      </div>
    </main>
  );
}
