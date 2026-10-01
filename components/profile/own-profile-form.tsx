"use client";

import { useActionState } from "react";
import { submitOwnProfile, type ProfileFormState } from "@/app/actions/profile";
import { Input } from "@/components/ui/input";
import {
  FieldError,
  FormError,
  SubmitButton,
  hintClass,
  labelClass,
} from "@/components/onboarding/form-controls";
import { SEEKING_STATUS_OPTIONS } from "@/components/onboarding/profile-form";

/**
 * Edición del perfil propio (`/perfil`, Fase 2.4). Formulario HTML + Server
 * Action: funciona también sin JavaScript. Solo contiene los campos
 * editables (los de `profileUpdateSchema`); nunca `id`, `role`,
 * `deleted_at` ni `onboarding_completed_at`. Las reglas (longitudes, edad
 * mínima) las aplica el servidor; aquí solo hay ayudas del navegador.
 */

const BIO_MAX_LENGTH = 500;

export function OwnProfileForm({
  initialValues,
}: {
  initialValues: Record<string, string>;
}) {
  const [state, action] = useActionState<ProfileFormState, FormData>(
    submitOwnProfile,
    {}
  );
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};
  const text = (key: string) =>
    typeof values[key] === "string" ? (values[key] as string) : "";

  return (
    // `key`: React vacía el formulario tras la acción; así se vuelve a montar
    // con lo enviado (si hay errores) o con lo guardado.
    <form key={JSON.stringify(values)} action={action} className="flex flex-col gap-5">
      <div>
        <label htmlFor="full_name" className={labelClass}>
          Nombre
        </label>
        <Input
          id="full_name"
          name="full_name"
          required
          maxLength={100}
          autoComplete="name"
          defaultValue={text("full_name")}
          aria-invalid={Boolean(errors.full_name)}
          aria-describedby={errors.full_name ? "full_name-error" : undefined}
          className="mt-1"
        />
        <FieldError id="full_name-error" messages={errors.full_name} />
      </div>

      <div>
        <label htmlFor="date_of_birth" className={labelClass}>
          Fecha de nacimiento
        </label>
        <Input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          required
          autoComplete="bday"
          defaultValue={text("date_of_birth")}
          aria-invalid={Boolean(errors.date_of_birth)}
          aria-describedby={
            errors.date_of_birth ? "date_of_birth-error" : "date_of_birth-hint"
          }
          className="mt-1"
        />
        <p id="date_of_birth-hint" className={hintClass}>
          Tienes que tener al menos 18 años.
        </p>
        <FieldError id="date_of_birth-error" messages={errors.date_of_birth} />
      </div>

      <fieldset
        aria-invalid={Boolean(errors.seeking_status)}
        aria-describedby={errors.seeking_status ? "seeking_status-error" : undefined}
      >
        <legend className={labelClass}>¿Qué estás buscando?</legend>
        <div className="mt-2 flex flex-col gap-2">
          {SEEKING_STATUS_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="seeking_status"
                value={option.value}
                required
                defaultChecked={values.seeking_status === option.value}
              />
              {option.label}
            </label>
          ))}
        </div>
        <FieldError id="seeking_status-error" messages={errors.seeking_status} />
      </fieldset>

      <div>
        <label htmlFor="bio" className={labelClass}>
          Sobre ti <span className="font-normal text-[var(--muted)]">(opcional)</span>
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={BIO_MAX_LENGTH}
          defaultValue={text("bio")}
          aria-invalid={Boolean(errors.bio)}
          aria-describedby={errors.bio ? "bio-error" : "bio-hint"}
          className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
        <p id="bio-hint" className={hintClass}>
          Hasta {BIO_MAX_LENGTH} caracteres. Déjalo vacío para borrarlo.
        </p>
        <FieldError id="bio-error" messages={errors.bio} />
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="email_notifications_enabled"
            defaultChecked={values.email_notifications_enabled === "on"}
            aria-describedby={
              errors.email_notifications_enabled
                ? "email_notifications_enabled-error"
                : undefined
            }
          />
          Quiero recibir avisos por email
        </label>
        <FieldError
          id="email_notifications_enabled-error"
          messages={errors.email_notifications_enabled}
        />
      </div>

      <FormError message={state.formError} />
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {state.success}
        </p>
      ) : null}
      <SubmitButton label="Guardar cambios" pendingLabel="Guardando…" />
    </form>
  );
}
