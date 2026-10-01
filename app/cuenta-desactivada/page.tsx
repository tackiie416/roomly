import { requireDeletedAccount } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card } from "@/components/ui/card";

/**
 * Cuenta con `deleted_at` (Fase 2.2). Solo informa y permite cerrar sesión:
 * no hay ninguna acción de reactivación.
 */
export default async function DeactivatedAccountPage() {
  await requireDeletedAccount();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center p-8">
      <Card className="flex flex-col gap-4">
        <h1 className="text-xl font-medium">Tu cuenta está desactivada</h1>
        <p className="text-sm text-[var(--muted)]">
          Esta cuenta ya no está activa en Roomly, así que no puedes usarla para entrar.
        </p>
        <SignOutButton />
      </Card>
    </main>
  );
}
