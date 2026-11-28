#!/usr/bin/env bash
# Guarda de staging (sesión 88). Se usa con `source` desde los scripts de
# scripts/staging/. Nunca imprime valores de variables ni la salida de psql.
#
# Para que un script de staging se ejecute, todo esto tiene que cumplirse:
#   1. existen STAGING_PROJECT_REF y STAGING_DB_URL (se nombran, nunca se
#      muestran) y STAGING_CONFIRM, que la persona escribe a mano y debe ser
#      exactamente "roomly-staging";
#   2. el ref tiene formato de project ref, la URL de la base de datos (y
#      STAGING_SUPABASE_URL, si se da) apuntan a ese mismo ref, y el ref no es
#      uno prohibido: `uwxb…` siempre, y los de DEPLOY_FORBIDDEN_SUPABASE_REFS;
#   3. la base de datos a la que se conecta lleva la marca
#         COMMENT ON DATABASE postgres IS 'roomly-staging';
#      escrita por el propietario al crear el proyecto. Una marca de validación
#      (roomly-validation-*) o cualquier otra se rechaza.
#
# No hay ningún modo que se salte la guarda. Los auto-tests
# (scripts/staging/staging-selftest.sh) simulan proyectos en un PostgreSQL
# local con el usuario postgres.<ref>.

ROOMLY_STAGING_MARKER="roomly-staging"
ROOMLY_STAGING_FORBIDDEN_PREFIXES=("uwxb")

roomly_staging_guard() {
  local missing=() name
  for name in STAGING_PROJECT_REF STAGING_DB_URL STAGING_CONFIRM; do
    [ -z "${!name:-}" ] && missing+=("$name")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "ERROR: faltan variables de entorno: ${missing[*]}" >&2
    return 1
  fi
  if [ "$STAGING_CONFIRM" != "$ROOMLY_STAGING_MARKER" ]; then
    echo "ERROR: STAGING_CONFIRM debe ser exactamente ${ROOMLY_STAGING_MARKER}. Abortado." >&2
    return 1
  fi

  local ref="$STAGING_PROJECT_REF"
  if ! [[ "$ref" =~ ^[a-z0-9]{20}$ ]]; then
    echo "ERROR: STAGING_PROJECT_REF no tiene formato de project ref" >&2
    return 1
  fi
  local prefix forbidden=("${ROOMLY_STAGING_FORBIDDEN_PREFIXES[@]}")
  IFS=',' read -r -a extra <<<"${DEPLOY_FORBIDDEN_SUPABASE_REFS:-}"
  for prefix in "${extra[@]}"; do
    prefix="$(echo "$prefix" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
    [ -n "$prefix" ] && forbidden+=("$prefix")
  done
  for prefix in "${forbidden[@]}"; do
    if [[ "$ref" == "$prefix"* ]]; then
      echo "ERROR: STAGING_PROJECT_REF es un proyecto prohibido (validación o histórico). Abortado." >&2
      return 1
    fi
  done
  if [ -n "${STAGING_SUPABASE_URL:-}" ] && [ "$STAGING_SUPABASE_URL" != "https://${ref}.supabase.co" ]; then
    echo "ERROR: STAGING_SUPABASE_URL no corresponde a STAGING_PROJECT_REF" >&2
    return 1
  fi
  if [[ "$STAGING_DB_URL" != *"postgres.${ref}:"* ]] \
    && [[ "$STAGING_DB_URL" != *"@db.${ref}.supabase.co"* ]]; then
    echo "ERROR: STAGING_DB_URL no corresponde a STAGING_PROJECT_REF" >&2
    return 1
  fi

  local marker_ok
  if ! marker_ok="$(PGSSLMODE="${PGSSLMODE:-require}" psql -X -q -At --no-psqlrc \
    -v ON_ERROR_STOP=1 -d "$STAGING_DB_URL" \
    -c "select coalesce(shobj_description(d.oid, 'pg_database'), '') = '${ROOMLY_STAGING_MARKER}'
        from pg_database d where d.datname = current_database()" 2>/dev/null)"; then
    echo "ERROR: no se pudo verificar la identidad del destino (fallo de conexión o de consulta). Abortado." >&2
    return 1
  fi
  if [ "$marker_ok" != "t" ]; then
    echo "ERROR: el destino no lleva la marca ${ROOMLY_STAGING_MARKER}. Abortado." >&2
    return 1
  fi
  echo "guard: destino verificado como ${ROOMLY_STAGING_MARKER}"
}

roomly_staging_guard
