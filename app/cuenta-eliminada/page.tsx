import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";

/** Confirmación tras eliminar la cuenta (sesión 87). Pública: ya no hay sesión. */

export const metadata: Metadata = {
  title: "Cuenta eliminada | Roomly",
  robots: { index: false, follow: false },
};

export default function AccountDeletedPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center px-4 py-8">
      <Card className="flex flex-col gap-4">
        <h1 className="text-xl font-medium">Tu cuenta se ha eliminado</h1>
        <p className="text-sm text-[var(--muted)]">
          Hemos borrado tus datos y cerrado tus sesiones. Gracias por haber usado Roomly.
        </p>
        <Link href="/" className="text-sm underline">
          Ir al inicio
        </Link>
      </Card>
    </main>
  );
}
