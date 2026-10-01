"use client";

import { useActionState } from "react";
import {
  submitOnboardingProfile,
  type OnboardingFormState,
} from "@/app/actions/onboarding";
import { Input } from "@/components/ui/input";
import {
  FieldError,
  FormError,
  SubmitButton,
  hintClass,
  labelClass,
} from "./form-controls";

/**
 * Paso 1 del onboarding. Formulario HTML + Server Action: funciona también
 * sin JavaScript. Los radios de `seeking_status` NO tienen ninguna opción
 * preseleccionada (decisión de producto: la elección tiene que ser explícita);
 * solo se marcan al volver con errores, con lo que el usuario ya eligió.
 */

export const SEEKING_STATUS_OPTIONS = [
  { value: "looking_for_room", label: "Busco habitación" },
  {
    value: "has_room_looking_for_roommate",
    label: "Tengo habitación y busco compañeros",
  },
  { value: "flexible", label: "Estoy abierto a las dos cosas" },
] as const;

const initialState: OnboardingFormState = {};

export function ProfileForm() {
  const [state, action] = useActionState(submitOnboardingProfile, initialState);
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const text = (key: string) =>
    typeof values[key] === "string" ? (values[key] as string) : "";

  return (
    // `key`: React vacía el formulario tras la acción; así se vuelve a montar
    // con lo que el usuario había escrito cuando hay errores.
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

      <FormError message={state.formError} />
      <SubmitButton label="Continuar" pendingLabel="Guardando…" />
    </form>
  );
}
