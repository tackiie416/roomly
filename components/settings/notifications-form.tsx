"use client";

import { useActionState } from "react";
import {
  submitNotificationSettings,
  type SettingsFormState,
} from "@/app/actions/settings";
import {
  FormError,
  SubmitButton,
  hintClass,
} from "@/components/onboarding/form-controls";

/**
 * Aviso por email en `/ajustes` (Fase 2.6). Formulario HTML + Server Action:
 * funciona sin JavaScript. Una sola casilla (`email_notifications_enabled`);
 * sin marcar, el navegador no la envía y se guarda `false`.
 */
export function NotificationsForm({ initialEnabled }: { initialEnabled: boolean }) {
  const [state, action] = useActionState<SettingsFormState, FormData>(
    submitNotificationSettings,
    {}
  );
  const enabled =
    state.emailNotifications === undefined
      ? initialEnabled
      : state.emailNotifications === "on";

  return (
    // `key`: tras guardar, la casilla se vuelve a montar con el valor guardado.
    <form key={String(enabled)} action={action} className="flex flex-col gap-4">
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="email_notifications_enabled"
            defaultChecked={enabled}
            aria-describedby="email_notifications_enabled-hint"
          />
          Quiero recibir avisos por email
        </label>
        <p id="email_notifications_enabled-hint" className={`mt-1 ${hintClass}`}>
          Puedes cambiarlo cuando quieras. También se puede cambiar desde tu perfil.
        </p>
      </div>
      <FormError message={state.formError} />
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {state.success}
        </p>
      ) : null}
      <SubmitButton label="Guardar ajustes" pendingLabel="Guardando…" />
    </form>
  );
}
