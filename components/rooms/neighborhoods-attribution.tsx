/**
 * Procedencia del catálogo de barrios (R1, `20261016120000`), verificada por
 * el propietario en el registro de datos.gob.es (sesión 69). El conjunto es
 * «Unidades administrativas de la ciudad de Barcelona»; `BarcelonaCiutat_Barris.json`
 * es uno de sus recursos, no el conjunto.
 */
export const NEIGHBORHOODS_SOURCE = {
  datasetTitle: "Unidades administrativas de la ciudad de Barcelona",
  datasetUrl:
    "https://datos.gob.es/es/catalogo/l01080193-unidades-administrativas-de-la-ciudad-de-barcelona",
  /** Identificador del conjunto en Open Data BCN. */
  datasetId: "808daafa-d9ce-48c0-925a-fa5afdb1ed41",
  publisher: "Ayuntamiento de Barcelona",
  portal: "Open Data BCN",
  resourceName: "BarcelonaCiutat_Barris.json",
  /** Identificador del recurso JSON en Open Data BCN. */
  resourceId: "75197dfe-0306-4c5e-9643-34948af07fb6",
  resourceUrl:
    "https://opendata-ajuntament.barcelona.cat/data/dataset/808daafa-d9ce-48c0-925a-fa5afdb1ed41/resource/75197dfe-0306-4c5e-9643-34948af07fb6/download",
  licenseName: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.es",
} as const;

/**
 * Atribución del catálogo de barrios (CC BY 4.0), la única de la aplicación:
 * va junto a cada lugar donde se ofrece o se muestra el catálogo (alta,
 * edición y listado de habitaciones, onboarding, `/preferencias` y, cuando
 * alguna tarjeta muestra zonas, `/explorar`). Cumple
 * las condiciones de D1 (`PROGRESS.md`, 2026-10-19): identifica el conjunto,
 * el publicador y el recurso, enlaza a su ficha, al recurso original y a la
 * licencia, dice qué se ha adaptado (lo que hace la migración: solo los
 * nombres, con identificadores propios) y aclara que no implica aval. Es HTML
 * sin estado: se ve igual sin JavaScript. No se quita ni se oculta.
 */
export function NeighborhoodsAttribution({ id }: { id?: string }) {
  const source = NEIGHBORHOODS_SOURCE;
  const link = "underline";
  return (
    <p
      id={id}
      className="mt-1 text-xs text-[var(--muted)]"
      data-testid="neighborhoods-attribution"
    >
      Barrios de Barcelona: datos procedentes del conjunto “
      <a
        href={source.datasetUrl}
        className={link}
        rel="noopener noreferrer"
        target="_blank"
      >
        {source.datasetTitle}
      </a>
      ”, publicado por el {source.publisher} ({source.portal}), recurso “
      <a
        href={source.resourceUrl}
        className={link}
        rel="noopener noreferrer"
        target="_blank"
      >
        {source.resourceName}
      </a>
      ”. ROOMLY utiliza los nombres de los 73 barrios y genera identificadores internos;
      no reutiliza los códigos de distrito ni las geometrías del recurso. Licencia{" "}
      <a
        href={source.licenseUrl}
        className={link}
        rel="noopener noreferrer license"
        target="_blank"
      >
        {source.licenseName}
      </a>
      . Esta atribución no implica que el {source.publisher} avale ROOMLY.
    </p>
  );
}
