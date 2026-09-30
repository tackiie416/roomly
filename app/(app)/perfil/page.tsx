import Link from "next/link";
import { requireOwnProfile } from "@/lib/auth/session";
import { ONBOARDING_PREFERENCES_PATH } from "@/lib/auth/destination";
import { ownProfileFormValues } from "@/lib/validation/own-profile-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { OwnProfileForm } from "@/components/profile/own-profile-form";
import { Card } from "@/components/ui/card";

/**
 * Perfil propio (`/perfil`, Fase 2.4). Siempre el de la sesión: la ruta no
 * tiene ningún parámetro de perfil. El guard va en la página (no hay layout
 * que lo haga por ella): sin perfil → onboarding, cuenta eliminada →
 * `/cuenta-desactivada`, antes de renderizar nada. Con el onboarding sin
 * terminar se puede editar igualmente y se indica cómo completarlo.
 */
export default async function OwnProfilePage() {
  const state = await requireOwnProfile();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-medium">Tu perfil</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Estos datos son tuyos y solo tú puedes cambiarlos.
          </p>
        </div>
        {state.status === "incomplete" ? (
          <p className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm">
            Todavía no has terminado de configurar tu cuenta.{" "}
            <Link href={ONBOARDING_PREFERENCES_PATH} className="underline">
              Completa tus preferencias
            </Link>{" "}
            para empezar a buscar.
          </p>
        ) : null}
        <OwnProfileForm initialValues={ownProfileFormValues(state.profile)} />
      </Card>
      <div className="mt-4 self-center">
        <SignOutButton />
      </div>
    </main>
  );
}
