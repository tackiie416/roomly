import Link from "next/link";
import type { PublicNeighborhood } from "@/lib/services/room-search";
import {
  ROOM_SEARCH_ORDERS,
  ROOM_SEARCH_ORDER_LABELS,
  ROOM_SEARCH_PARAMS as P,
  type RoomSearchFilters,
  roomSearchPath,
} from "@/lib/validation/room-search";
import { ROOM_FEATURES } from "@/lib/validation/rooms";
import { NeighborhoodsAttribution } from "./neighborhoods-attribution";

/**
 * Filtros de la búsqueda pública (`/[city]/habitaciones`, Fase 4.4). Un
 * formulario GET sin JavaScript: enviarlo carga la misma página con los
 * filtros en la URL, que el servidor valida (lib/validation/room-search.ts).
 * Las listas largas (barrios, características) van en `<details>`, que se
 * abre y se cierra sin JavaScript. El cursor no está en el formulario: al
 * cambiar un filtro o el orden, la búsqueda vuelve a la primera página.
 *
 * Etiquetas según el significado real de cada columna: `total_rooms` son los
 * dormitorios de la vivienda y `total_roommates`, las personas con las que se
 * convivirá sin contarse a sí mismo (docs/DATABASE.md).
 */

// Las mismas clases que components/onboarding/form-controls.tsx (que es un
// módulo de cliente: sus constantes no se pueden importar desde aquí).
const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-[var(--muted)]";
const fieldClass =
  "mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

export function PublicRoomSearchForm({
  citySlug,
  neighborhoods,
  filters,
}: {
  citySlug: string;
  neighborhoods: PublicNeighborhood[];
  /** Los filtros aplicados; `null` si la búsqueda no era válida (el formulario sale vacío). */
  filters: RoomSearchFilters | null;
}) {
  const selectedHoods = new Set(filters?.neighborhoods ?? []);
  const selectedFeatures = new Set<string>(filters?.features ?? []);
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? "" : String(value);

  return (
    <form
      method="get"
      action={roomSearchPath(citySlug)}
      className="flex flex-col gap-4"
      aria-label="Filtros de búsqueda"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={P.maxPrice} className={labelClass}>
            Precio máximo <span className={hintClass}>(€ al mes)</span>
          </label>
          <input
            id={P.maxPrice}
            name={P.maxPrice}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            defaultValue={number(filters?.maxPrice)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={P.moveIn} className={labelClass}>
            Fecha de entrada
          </label>
          <input
            id={P.moveIn}
            name={P.moveIn}
            type="date"
            defaultValue={filters?.moveIn ?? ""}
            aria-describedby={`${P.moveIn}-hint`}
            className={fieldClass}
          />
          <p id={`${P.moveIn}-hint`} className={`mt-1 ${hintClass}`}>
            Habitaciones disponibles ese día o antes.
          </p>
        </div>
        <div>
          <label htmlFor={P.stayMonths} className={labelClass}>
            Meses de estancia
          </label>
          <input
            id={P.stayMonths}
            name={P.stayMonths}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            defaultValue={number(filters?.stayMonths)}
            aria-describedby={`${P.stayMonths}-hint`}
            className={fieldClass}
          />
          <p id={`${P.stayMonths}-hint`} className={`mt-1 ${hintClass}`}>
            Dentro de la estancia mínima y máxima de la habitación.
          </p>
        </div>
        <div>
          <label htmlFor={P.order} className={labelClass}>
            Ordenar por
          </label>
          <select
            id={P.order}
            name={P.order}
            defaultValue={filters?.order ?? "recientes"}
            className={fieldClass}
          >
            {ROOM_SEARCH_ORDERS.map((order) => (
              <option key={order} value={order}>
                {ROOM_SEARCH_ORDER_LABELS[order]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={P.maxBedrooms} className={labelClass}>
            Dormitorios de la vivienda, como máximo
          </label>
          <input
            id={P.maxBedrooms}
            name={P.maxBedrooms}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            defaultValue={number(filters?.maxBedrooms)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={P.maxRoommates} className={labelClass}>
            Personas con las que convivirás, como máximo
          </label>
          <input
            id={P.maxRoommates}
            name={P.maxRoommates}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={number(filters?.maxRoommates)}
            aria-describedby={`${P.maxRoommates}-hint`}
            className={fieldClass}
          />
          <p id={`${P.maxRoommates}-hint`} className={`mt-1 ${hintClass}`}>
            Sin contarte a ti.
          </p>
        </div>
        <div>
          <label htmlFor={P.pets} className={labelClass}>
            Mascotas
          </label>
          <select
            id={P.pets}
            name={P.pets}
            defaultValue={filters?.pets ?? ""}
            className={fieldClass}
          >
            <option value="">Indiferente</option>
            <option value="si">Se admiten mascotas</option>
            <option value="no">No se admiten mascotas</option>
          </select>
        </div>
        <div>
          <label htmlFor={P.smoking} className={labelClass}>
            Tabaco
          </label>
          <select
            id={P.smoking}
            name={P.smoking}
            defaultValue={filters?.smoking ?? ""}
            className={fieldClass}
          >
            <option value="">Indiferente</option>
            <option value="si">Se puede fumar</option>
            <option value="no">No se puede fumar</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={P.studentsOnly}
          value="1"
          defaultChecked={filters?.studentsOnly ?? false}
        />
        Solo habitaciones exclusivas para estudiantes
      </label>

      {neighborhoods.length > 0 ? (
        <details open={selectedHoods.size > 0}>
          <summary className={`cursor-pointer ${labelClass}`}>
            Barrios{" "}
            <span className={hintClass}>
              {selectedHoods.size > 0
                ? `(${selectedHoods.size} elegidos)`
                : "(todos los de la ciudad)"}
            </span>
          </summary>
          <fieldset className="mt-2">
            <legend className="sr-only">Barrios</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {neighborhoods.map((hood) => (
                <label key={hood.slug} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={P.neighborhoods}
                    value={hood.slug}
                    defaultChecked={selectedHoods.has(hood.slug)}
                  />
                  {hood.name}
                </label>
              ))}
            </div>
          </fieldset>
          <NeighborhoodsAttribution />
        </details>
      ) : null}

      <details open={selectedFeatures.size > 0}>
        <summary className={`cursor-pointer ${labelClass}`}>
          Características <span className={hintClass}>(con todas las que marques)</span>
        </summary>
        <fieldset className="mt-2">
          <legend className="sr-only">Características</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ROOM_FEATURES.map((feature) => (
              <label key={feature.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={P.features}
                  value={feature.key}
                  defaultChecked={selectedFeatures.has(feature.key)}
                />
                {feature.label}
              </label>
            ))}
          </div>
        </fieldset>
      </details>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Buscar
        </button>
        <Link href={roomSearchPath(citySlug)} className="text-sm underline">
          Quitar filtros
        </Link>
      </div>
    </form>
  );
}
