#!/usr/bin/env bash
# Guarda común de la validación contra Supabase real.
# Se usa con `source` desde los scripts, o se ejecuta directamente
# (bash tests/supabase/guard.sh ...) desde la suite supabase-js.
#
# Dos niveles, los dos obligatorios, sin ningún fallback:
#
#   1. Coherencia local (sin red): existen las variables necesarias (se
#      nombran, nunca se muestran) y la URL de la API y la conexión de BD
#      apuntan al MISMO project ref.
#
#   2. Identidad verificada DESDE EL PROPIO PROYECTO: la base de datos a la
#      que realmente se conecta debe llevar la marca
#         COMMENT ON DATABASE postgres IS 'roomly-validation';
#      (legible por cualquier rol vía pg_shdescription; solo el dueño de la
#      BD puede escribirla). Si la marca falta, no coincide exactamente, o no
#      se puede comprobar, se aborta. Unos secrets coherentes que apunten a
#      otro proyecto NO pasan: ese proyecto no tiene la marca.
#
# Nunca imprime valores de variables ni la salida de error de psql (podría
# contener el host o el usuario de la conexión).
#
# Uso: source tests/supabase/guard.sh [VAR_EXTRA ...]

ROOMLY_VALIDATION_MARKER="roomly-validation"

roomly_guard() {
  local missing=()
  local name
  for name in SUPABASE_VALIDATION_PROJECT_REF SUPABASE_VALIDATION_DB_URL "$@"; do
    if [ -z "${!name:-}" ]; then
      missing+=("$name")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "ERROR: faltan variables de entorno: ${missing[*]}" >&2
    return 1
  fi

  local ref="$SUPABASE_VALIDATION_PROJECT_REF"
  if ! [[ "$ref" =~ ^[a-z0-9]{20}$ ]]; then
    echo "ERROR: SUPABASE_VALIDATION_PROJECT_REF no tiene formato de project ref" >&2
    return 1
  fi

  if [ -n "${SUPABASE_VALIDATION_URL:-}" ] && [ "$SUPABASE_VALIDATION_URL" != "https://${ref}.supabase.co" ]; then
    echo "ERROR: SUPABASE_VALIDATION_URL no corresponde al project ref de validación" >&2
    return 1
  fi

  # Session pooler (usuario postgres.<ref>) o conexión directa (db.<ref>.supabase.co).
  if [[ "$SUPABASE_VALIDATION_DB_URL" != *"postgres.${ref}:"* ]] \
    && [[ "$SUPABASE_VALIDATION_DB_URL" != *"@db.${ref}.supabase.co"* ]]; then
    echo "ERROR: SUPABASE_VALIDATION_DB_URL no corresponde al project ref de validación" >&2
    return 1
  fi

  # --- Identidad verificada desde el propio proyecto ---
  local marker_ok
  if ! marker_ok="$(PGSSLMODE="${PGSSLMODE:-require}" psql -X -q -At --no-psqlrc \
    -v ON_ERROR_STOP=1 -d "$SUPABASE_VALIDATION_DB_URL" \
    -c "select coalesce(shobj_description(d.oid, 'pg_database'), '') = '${ROOMLY_VALIDATION_MARKER}'
        from pg_database d where d.datname = current_database()" 2>/dev/null)"; then
    echo "ERROR: no se pudo verificar la identidad del destino (fallo de conexión o de consulta)." >&2
    echo "       El destino NO está reconocido como ${ROOMLY_VALIDATION_MARKER}. Abortado." >&2
    return 1
  fi
  if [ "$marker_ok" != "t" ]; then
    echo "ERROR: el destino NO está reconocido como ${ROOMLY_VALIDATION_MARKER}:" >&2
    echo "       falta la marca de identidad de la base de datos o no coincide exactamente. Abortado." >&2
    return 1
  fi

  echo "guard: destino verificado como ${ROOMLY_VALIDATION_MARKER} (coherencia local + marca del proyecto)"
}

roomly_guard "$@"
