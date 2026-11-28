import Link from "next/link";
import { SETTINGS_PATH, requireOwnProfile } from "@/lib/auth/session";
import { BLOCKED_PATH } from "@/lib/auth/destination";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { NotificationsForm } from "@/components/settings/notifications-form";
import { Card } from "@/components/ui/card";

/**
 * Ajustes (`/ajustes`, Fase 2.6): avisos por email y cerrar sesión. Siempre
 * los de la sesión: la ruta no tiene ningún parámetro de perfil. El guard va
 * en la propia página: sin perfil → onboarding, cuenta eliminada →
 * `/cuenta-desactivada`, antes de renderizar nada. El logout es el de 2.2
 * (`SignOutButton` → `signOut`), sin cambios de alcance. No hay borrado de
 * cuenta (H6, fuera de Fase 2).
 */
export default async function SettingsPage() {
  const state = await requireOwnProfile(SETTINGS_PATH);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col justify-center gap-4 p-8">
      <Card className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-medium">Ajustes</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Tus datos personales se editan en{" "}
            <Link href="/perfil" className="underline">
              tu perfil
            </Link>
            .
          </p>
        </div>
        <section aria-labelledby="notifications-heading" className="flex flex-col gap-3">
          <h2 id="notifications-heading" className="text-sm font-medium">
            Notificaciones
          </h2>
          <NotificationsForm initialEnabled={state.profile.email_notifications_enabled} />
        </section>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Privacidad y seguridad</h2>
        <p className="text-sm">
          <Link href={BLOCKED_PATH} className="underline" data-testid="blocked-link">
            Personas bloqueadas
          </Link>
        </p>
        <p className="text-sm">
          {/* Enlace normal (no <Link>): es una descarga de un Route Handler, no
              una página; no debe precargarse ni navegarse en el cliente. */}
          <a
            href="/ajustes/mis-datos"
            download
            className="underline"
            data-testid="data-export-link"
          >
            Descargar mis datos
          </a>
          <span className="text-neutral-600">
            {" "}
            (un archivo JSON con tu perfil, preferencias, test, habitaciones, mensajes
            enviados y reportes)
          </span>
        </p>
        <p className="text-sm">
          <Link
            href="/ajustes/eliminar-cuenta"
            className="underline"
            data-testid="account-deletion-link"
          >
            Eliminar mi cuenta
          </Link>
        </p>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Sesión</h2>
        <SignOutButton />
      </Card>
    </main>
  );
}
