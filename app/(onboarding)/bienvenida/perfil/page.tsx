import { requireOnboardingStep } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card } from "@/components/ui/card";

/**
 * Paso 1 del onboarding (`/bienvenida/perfil`). En la Fase 2.2 solo existe
 * como destino técnico y con su guard: el formulario llega en la 2.3.
 */
export default async function OnboardingProfilePage() {
  await requireOnboardingStep("perfil");

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-4">
        <h1 className="text-xl font-medium">Crea tu perfil</h1>
        <p className="text-sm text-[var(--muted)]">
          Este paso estará disponible muy pronto.
        </p>
        <SignOutButton />
      </Card>
    </main>
  );
}
