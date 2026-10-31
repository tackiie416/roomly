"use client";

import { useActionState } from "react";
import type { RoomFormState, RoomFormValues } from "@/lib/validation/room-form";
import { ROOM_FEATURES, ROOM_TEXT_LIMITS } from "@/lib/validation/rooms";
import {
  FieldError,
  FormError,
  SubmitButton,
  hintClass,
  labelClass,
} from "@/components/onboarding/form-controls";
import { Input } from "@/components/ui/input";
import { NeighborhoodsAttribution } from "./neighborhoods-attribution";

/**
 * Formulario de habitación: alta (`/habitaciones/nueva`) y edición
 * (`/habitaciones/[id]/editar`), sesión 68. Formulario HTML + Server Action:
 * funciona sin JavaScript. Los barrios van agrupados por ciudad en un único
 * `<select>` (sin filtrar en el navegador, para que funcione igual sin
 * JavaScript); que el barrio sea de la ciudad lo comprueba la base de datos
 * (FK compuesta) y el servidor lo traduce a un error del campo.
 *
 * Ubicación: solo ciudad y barrio (R2). Nunca se pide la dirección exacta.
 * Del navegador no salen `owner_id`, `status`, `deleted_at` ni `approx_*`:
 * el estado se cambia aparte (R7) y lo demás lo pone el servidor.
 */

type Option = { id: string; name: string };
type NeighborhoodOption = Option & { city_id: string };

type RoomAction = (state: RoomFormState, formData: FormData) => Promise<RoomFormState>;

const fieldClass =
  "mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

const initialState: RoomFormState = {};

/**
 * Aviso de la Fase 4.4: los textos libres se publican tal cual en
 * `/[city]/habitaciones`. Nada filtra teléfonos ni direcciones, así que se
 * pide no ponerlos (y se enlaza desde cada campo de texto).
 */
const PUBLIC_TEXT_WARNING_ID = "public-text-warning";

export function RoomForm({
  action: submitAction,
  cities,
  neighborhoods,
  initialValues,
  roomId,
  submitLabel,
  pendingLabel = "Guardando…",
}: {
  action: RoomAction;
  cities: Option[];
  neighborhoods: NeighborhoodOption[];
  initialValues: RoomFormValues;
  /** Solo al editar: la habitación (el servidor comprueba que es tuya). */
  roomId?: string;
  submitLabel: string;
  pendingLabel?: string;
}) {
  const [state, action] = useActionState(submitAction, initialState);
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};
  const text = (key: string) =>
    typeof values[key] === "string" ? (values[key] as string) : "";
  const list = (key: string) =>
    Array.isArray(values[key]) ? (values[key] as string[]) : [];
  const described = (key: string, hint?: string) =>
    [hint, errors[key] ? `${key}-error` : undefined].filter(Boolean).join(" ") ||
    undefined;

  const neighborhoodGroups = cities
    .map((city) => ({
      city,
      options: neighborhoods.filter((neighborhood) => neighborhood.city_id === city.id),
    }))
    .filter((group) => group.options.length > 0);

  const numberField = (
    name: string,
    label: string,
    options: { min: number; required?: boolean; hint?: string; optional?: boolean }
  ) => (
    <div className="flex-1">
      <label htmlFor={name} className={labelClass}>
        {label}
        {options.optional ? <span className={hintClass}> (opcional)</span> : null}
      </label>
      <Input
        id={name}
        name={name}
        type="number"
        min={options.min}
        step={1}
        inputMode="numeric"
        required={options.required}
        defaultValue={text(name)}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={described(name, options.hint ? `${name}-hint` : undefined)}
        className="mt-1"
      />
      {options.hint ? (
        <p id={`${name}-hint`} className={`mt-1 ${hintClass}`}>
          {options.hint}
        </p>
      ) : null}
      <FieldError id={`${name}-error`} messages={errors[name]} />
    </div>
  );

  const textArea = (name: keyof typeof ROOM_TEXT_LIMITS, label: string) => (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label} <span className={hintClass}>(opcional)</span>
      </label>
      <textarea
        id={name}
        name={name}
        rows={4}
        maxLength={ROOM_TEXT_LIMITS[name]}
        defaultValue={text(name)}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={described(name, `${name}-hint ${PUBLIC_TEXT_WARNING_ID}`)}
        className={fieldClass}
      />
      <p id={`${name}-hint`} className={hintClass}>
        Hasta {ROOM_TEXT_LIMITS[name]} caracteres. Déjalo vacío para borrarlo.
      </p>
      <FieldError id={`${name}-error`} messages={errors[name]} />
    </div>
  );

  const checkbox = (name: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={text(name) === "on"} />
      {label}
    </label>
  );

  return (
    <form
      key={JSON.stringify(state.values ?? null)}
      action={action}
      className="flex flex-col gap-6"
    >
      {roomId ? <input type="hidden" name="roomId" value={roomId} /> : null}

      <p
        id={PUBLIC_TEXT_WARNING_ID}
        className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
        data-testid="room-public-text-warning"
      >
        Cuando publiques la habitación, el título, la descripción, las normas y las
        preferencias de convivencia se verán en la búsqueda pública, también sin iniciar
        sesión. No escribas teléfonos, correos, enlaces de contacto ni la dirección
        exacta: Roomly no revisa estos textos ni los quita.
      </p>

      <div>
        <label htmlFor="title" className={labelClass}>
          Título
        </label>
        <Input
          id="title"
          name="title"
          required
          maxLength={ROOM_TEXT_LIMITS.title}
          defaultValue={text("title")}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={described("title", PUBLIC_TEXT_WARNING_ID)}
          className="mt-1"
        />
        <FieldError id="title-error" messages={errors.title} />
      </div>

      {textArea("description", "Descripción")}

      <fieldset className="flex flex-col gap-4">
        <legend className={labelClass}>Ubicación</legend>
        <p id="location-hint" className={hintClass}>
          Solo pedimos la ciudad y el barrio: nunca la dirección exacta.
        </p>
        <div>
          <label htmlFor="city_id" className={labelClass}>
            Ciudad
          </label>
          <select
            id="city_id"
            name="city_id"
            required
            defaultValue={text("city_id")}
            aria-invalid={Boolean(errors.city_id)}
            aria-describedby={described("city_id", "location-hint")}
            className={fieldClass}
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
          <label htmlFor="neighborhood_id" className={labelClass}>
            Barrio <span className={hintClass}>(necesario para publicar)</span>
          </label>
          <select
            id="neighborhood_id"
            name="neighborhood_id"
            defaultValue={text("neighborhood_id")}
            aria-invalid={Boolean(errors.neighborhood_id)}
            aria-describedby={described("neighborhood_id", "neighborhood_id-hint")}
            className={fieldClass}
          >
            <option value="">Sin barrio</option>
            {neighborhoodGroups.map(({ city, options }) => (
              <optgroup key={city.id} label={city.name}>
                {options.map((neighborhood) => (
                  <option key={neighborhood.id} value={neighborhood.id}>
                    {neighborhood.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p id="neighborhood_id-hint" className={`mt-1 ${hintClass}`}>
            Elige un barrio de la ciudad que has indicado.
          </p>
          <NeighborhoodsAttribution />
          <FieldError id="neighborhood_id-error" messages={errors.neighborhood_id} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className={labelClass}>Precio y disponibilidad</legend>
        <div className="flex gap-3">
          {numberField("price_month", "Precio al mes (€)", { min: 1, required: true })}
          {numberField("deposit_amount", "Fianza (€)", { min: 0, optional: true })}
        </div>
        {checkbox("expenses_included", "Gastos incluidos")}
        <div>
          <label htmlFor="available_from" className={labelClass}>
            Disponible desde
          </label>
          <Input
            id="available_from"
            name="available_from"
            type="date"
            required
            defaultValue={text("available_from")}
            aria-invalid={Boolean(errors.available_from)}
            aria-describedby={described("available_from")}
            className="mt-1"
          />
          <FieldError id="available_from-error" messages={errors.available_from} />
        </div>
        <div className="flex gap-3">
          {numberField("min_stay_months", "Estancia mínima (meses)", {
            min: 1,
            optional: true,
          })}
          {numberField("max_stay_months", "Estancia máxima (meses)", {
            min: 1,
            optional: true,
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className={labelClass}>La vivienda</legend>
        <div className="flex gap-3">
          {numberField("total_roommates", "Personas con las que convivirá", {
            min: 0,
            hint: "Sin contar a quien entre en la habitación. Necesario para publicar.",
          })}
          {numberField("total_rooms", "Dormitorios de la vivienda", {
            min: 1,
            hint: "Necesario para publicar.",
          })}
        </div>
      </fieldset>

      <fieldset aria-describedby={errors.features ? "features-error" : undefined}>
        <legend className={labelClass}>
          Características <span className={hintClass}>(opcional)</span>
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {ROOM_FEATURES.map((feature) => (
            <label key={feature.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="features"
                value={feature.key}
                defaultChecked={list("features").includes(feature.key)}
              />
              {feature.label}
            </label>
          ))}
        </div>
        <FieldError id="features-error" messages={errors.features} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Normas de la vivienda</legend>
        {checkbox("pets_allowed", "Se admiten mascotas")}
        {checkbox("smoking_allowed", "Se puede fumar")}
      </fieldset>

      <fieldset
        aria-describedby={errors.students_only ? "students_only-error" : undefined}
      >
        <legend className={labelClass}>¿Solo para estudiantes?</legend>
        <div className="mt-2 flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="students_only"
              value="true"
              required
              defaultChecked={text("students_only") === "true"}
            />
            Sí
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="students_only"
              value="false"
              defaultChecked={text("students_only") === "false"}
            />
            No
          </label>
        </div>
        <FieldError id="students_only-error" messages={errors.students_only} />
      </fieldset>

      {textArea("house_rules", "Normas de convivencia")}
      {textArea("roommate_preferences", "Qué buscas en quien venga a vivir")}

      <FormError message={state.formError} />
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {state.success}
        </p>
      ) : null}
      <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
    </form>
  );
}
