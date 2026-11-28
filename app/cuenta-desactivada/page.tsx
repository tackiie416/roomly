import { requireDeletedAccount } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import Link from "next/link";
import { Card } from "@/components/ui/card";

/**
 * Cuenta con `deleted_at` (Fase 2.2). Informa, permite cerrar sesión y,
 * desde la sesión 87, descargar los datos o eliminar la cuenta. No hay
 * ninguna acción de reactivación.
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
        <p className="text-sm">
          Puedes{" "}
          <a href="/ajustes/mis-datos" download className="underline">
            descargar tus datos
          </a>{" "}
          o{" "}
          <Link
            href="/ajustes/eliminar-cuenta"
            className="underline"
            data-testid="account-deletion-link"
          >
            eliminar tu cuenta
          </Link>
          .
        </p>
        <SignOutButton />
      </Card>
    </main>
  );
}
