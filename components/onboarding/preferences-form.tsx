"use client";

import { useActionState, useState } from "react";
import {
  submitOnboardingPreferences,
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
 * Paso 2 del onboarding. Ciudad obligatoria; el resto, opcional y sin techos
 * (solo mínimos ≥ 0 y mínimo ≤ máximo, como en la base de datos). Universidad
 * y barrios se filtran por la ciudad elegida; la coherencia real la comprueban
 * la validación del servidor y el trigger de barrios.
 */

type Option = { id: string; name: string };
type CityScopedOption = Option & { city_id: string | null };

export type PreferencesInitialValues = Record<string, string | string[]>;

const selectClass =
  "mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

const initialState: OnboardingFormState = {};

export function PreferencesForm({
  cities,
  universities,
  neighborhoods,
  initialValues,
}: {
  cities: Option[];
  universities: CityScopedOption[];
  neighborhoods: CityScopedOption[];
  initialValues: PreferencesInitialValues;
}) {
  const [state, action] = useActionState(submitOnboardingPreferences, initialState);
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};
  const text = (key: string) =>
    typeof values[key] === "string" ? (values[key] as string) : "";
  const list = (key: string) =>
    Array.isArray(values[key]) ? (values[key] as string[]) : [];

  const [cityId, setCityId] = useState(text("city_id"));
  const cityUniversities = universities.filter(
    (university) => university.city_id === null || university.city_id === cityId
  );
  const cityNeighborhoods = neighborhoods.filter(
    (neighborhood) => neighborhood.city_id === cityId
  );

  const described = (key: string) => (errors[key] ? `${key}-error` : undefined);

  const numberField = (name: string, label: string) => (
    <div className="flex-1">
      <label htmlFor={name} className={labelClass}>
        {label}
      </label>
      <Input
        id={name}
        name={name}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        defaultValue={text(name)}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={described(name)}
        className="mt-1"
      />
      <FieldError id={`${name}-error`} messages={errors[name]} />
    </div>
  );

  const dateField = (name: string, label: string) => (
    <div className="flex-1">
      <label htmlFor={name} className={labelClass}>
        {label}
      </label>
      <Input
        id={name}
        name={name}
        type="date"
        defaultValue={text(name)}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={described(name)}
        className="mt-1"
      />
      <FieldError id={`${name}-error`} messages={errors[name]} />
    </div>
  );

  return (
    <form
      key={JSON.stringify(state.values ?? null)}
      action={action}
      className="flex flex-col gap-5"
    >
      <div>
        <label htmlFor="city_id" className={labelClass}>
          Ciudad
        </label>
        <select
          id="city_id"
          name="city_id"
          required
          defaultValue={cityId}
          onChange={(event) => setCityId(event.target.value)}
          aria-invalid={Boolean(errors.city_id)}
          aria-describedby={described("city_id")}
          className={selectClass}
        >
          <option value="">Elige una ciudad</option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </select>
        <FieldError id="city_id-error" messages={errors.city_id} />
      </div>

      <div>
        <label htmlFor="university_id" className={labelClass}>
          Universidad <span className={hintClass}>(opcional)</span>
        </label>
        <select
          key={`university-${cityId}`}
          id="university_id"
          name="university_id"
          defaultValue={
            cityUniversities.some((u) => u.id === text("university_id"))
              ? text("university_id")
              : ""
          }
          aria-invalid={Boolean(errors.university_id)}
          aria-describedby={described("university_id")}
          className={selectClass}
        >
          <option value="">Sin universidad</option>
          {cityUniversities.map((university) => (
            <option key={university.id} value={university.id}>
              {university.name}
            </option>
          ))}
        </select>
        <FieldError id="university_id-error" messages={errors.university_id} />
      </div>

      <div>
        <label htmlFor="field_of_study" className={labelClass}>
          Estudios <span className={hintClass}>(opcional)</span>
        </label>
        <Input
          id="field_of_study"
          name="field_of_study"
          maxLength={120}
          defaultValue={text("field_of_study")}
          aria-invalid={Boolean(errors.field_of_study)}
          aria-describedby={described("field_of_study")}
          className="mt-1"
        />
        <FieldError id="field_of_study-error" messages={errors.field_of_study} />
      </div>

      <fieldset>
        <legend className={labelClass}>
          Presupuesto al mes, en euros <span className={hintClass}>(opcional)</span>
        </legend>
        <div className="mt-1 flex gap-3">
          {numberField("budget_min", "Mínimo")}
          {numberField("budget_max", "Máximo")}
        </div>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>
          Fechas <span className={hintClass}>(opcional)</span>
        </legend>
        <div className="mt-1 flex gap-3">
          {dateField("move_in_date", "Entrada")}
          {dateField("move_out_date", "Salida")}
        </div>
      </fieldset>

      <fieldset
        key={`neighborhoods-${cityId}`}
        aria-describedby={described("preferred_neighborhood_ids")}
      >
        <legend className={labelClass}>
          Barrios que prefieres <span className={hintClass}>(opcional)</span>
        </legend>
        {cityNeighborhoods.length === 0 ? (
          <p className={`mt-1 ${hintClass}`}>
            {cityId
              ? "Todavía no hay barrios para esta ciudad."
              : "Elige primero una ciudad."}
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {cityNeighborhoods.map((neighborhood) => (
              <label key={neighborhood.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="preferred_neighborhood_ids"
                  value={neighborhood.id}
                  defaultChecked={list("preferred_neighborhood_ids").includes(
                    neighborhood.id
                  )}
                />
                {neighborhood.name}
              </label>
            ))}
          </div>
        )}
        <FieldError
          id="preferred_neighborhood_ids-error"
          messages={errors.preferred_neighborhood_ids}
        />
      </fieldset>

      <fieldset>
        <legend className={labelClass}>
          Número de compañeros <span className={hintClass}>(opcional)</span>
        </legend>
        <div className="mt-1 flex gap-3">
          {numberField("roommates_wanted_min", "Mínimo")}
          {numberField("roommates_wanted_max", "Máximo")}
        </div>
      </fieldset>

      <FormError message={state.formError} />
      <SubmitButton label="Terminar" pendingLabel="Guardando…" />
    </form>
  );
}
