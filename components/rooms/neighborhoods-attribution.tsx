/**
 * Atribución del catálogo de barrios (R1, `20261016120000`): © Ajuntament de
 * Barcelona, Open Data BCN, licencia CC BY 4.0. Las condiciones de D1
 * (`PROGRESS.md`, 2026-10-19) piden la atribución, el conjunto, el enlace a la
 * fuente y a la licencia, que se diga si se han adaptado los datos y no
 * sugerir que el Ajuntament avala ROOMLY. Va allí donde se muestre el
 * catálogo; no se quita ni se oculta. Antes del lanzamiento hay que
 * confirmarla (decisión pendiente del propietario).
 */
export function NeighborhoodsAttribution({ id }: { id?: string }) {
  return (
    <p
      id={id}
      className="mt-1 text-xs text-[var(--muted)]"
      data-testid="neighborhoods-attribution"
    >
      Barrios de Barcelona: © Ajuntament de Barcelona,{" "}
      <a
        href="https://opendata-ajuntament.barcelona.cat/"
        className="underline"
        rel="noopener noreferrer"
        target="_blank"
      >
        Open Data BCN
      </a>{" "}
      (conjunto «BarcelonaCiutat_Barris»), con licencia{" "}
      <a
        href="https://creativecommons.org/licenses/by/4.0/deed.es"
        className="underline"
        rel="noopener noreferrer license"
        target="_blank"
      >
        CC BY 4.0
      </a>
      . ROOMLY solo usa los nombres de los barrios, sin sus límites ni coordenadas. La
      atribución no implica que el Ajuntament avale ROOMLY.
    </p>
  );
}
