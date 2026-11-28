import type { Metadata } from "next";
import Link from "next/link";
import { SETTINGS_PATH, requireAccountForDeletion } from "@/lib/auth/session";
import { DEACTIVATED_PATH } from "@/lib/auth/destination";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/services/account-deletion";
import { deleteAccountAction } from "@/app/actions/account-deletion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Eliminar la cuenta (`/ajustes/eliminar-cuenta`, sesión 87). Formulario sin
 * JavaScript: el servidor exige escribir la palabra y marcar la casilla. Lo
 * puede usar también una cuenta desactivada. Qué se borra y qué se conserva:
 * docs/PRIVACY_RETENTION.md (la explicación de aquí lo resume).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Eliminar la cuenta | Roomly",
  robots: { index: false, follow: false },
};

const NOTICES: Record<string, { tone: "error" | "info"; text: string }> = {
  confirmacion: {
    tone: "error",
    text: `Para eliminar la cuenta, escribe ${ACCOUNT_DELETION_CONFIRMATION} y marca la casilla.`,
  },
  pendiente: {
    tone: "info",
    text: "Tu cuenta ya está desactivada, pero no hemos podido terminar de eliminarla. Vuelve a intentarlo en unos minutos: continuaremos donde se quedó.",
  },
};

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = await requireAccountForDeletion();
  const query = await searchParams;
  const notice = typeof query.aviso === "string" ? NOTICES[query.aviso] : undefined;
  const back = state.status === "deleted" ? DEACTIVATED_PATH : SETTINGS_PATH;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:p-8">
      <p className="text-sm">
        <Link href={back} className="underline">
          ← Volver
        </Link>
      </p>
      <Card className="flex flex-col gap-4">
        <h1 className="text-xl font-medium">Eliminar tu cuenta</h1>
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            data-testid="account-deletion-notice"
            className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
          >
            {notice.text}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 text-sm">
          <p>Es definitivo y no se puede deshacer. Al eliminarla:</p>
          <ul className="list-disc pl-5">
            <li>
              se cierra tu sesión en todos tus dispositivos y no podrás volver a entrar;
            </li>
            <li>
              se borran tu perfil, tus preferencias, tu test, tus habitaciones y sus
              fotos, tus intereses, tus matches, tus bloqueos y los mensajes que has
              escrito;
            </li>
            <li>tus chats se cierran para la otra persona.</li>
          </ul>
          <p>
            Por seguridad, conservamos sin tu nombre los reportes que hayas hecho o
            recibido y las acciones de moderación, solo con un identificador interno. Los
            mensajes que te escribieron otras personas son también suyos y no se borran.
          </p>
          <p>
            Si quieres una copia de tus datos,{" "}
            <a href="/ajustes/mis-datos" download className="underline">
              descárgalos antes
            </a>
            .
          </p>
        </div>
        <form
          action={deleteAccountAction}
          className="flex flex-col gap-3"
          data-testid="account-deletion-form"
        >
          <label htmlFor="account-deletion-confirmation" className="text-sm font-medium">
            Escribe {ACCOUNT_DELETION_CONFIRMATION} para confirmar
          </label>
          <Input
            id="account-deletion-confirmation"
            name="confirmation"
            autoComplete="off"
            required
            maxLength={50}
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="acknowledge"
              id="account-deletion-acknowledge"
              required
              className="mt-1"
            />
            <span>Entiendo que la eliminación es definitiva.</span>
          </label>
          <Button type="submit" data-testid="account-deletion-submit">
            Eliminar mi cuenta definitivamente
          </Button>
        </form>
      </Card>
    </main>
  );
}
