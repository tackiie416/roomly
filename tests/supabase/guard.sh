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
#         COMMENT ON DATABASE postgres IS 'roomly-validation-3';
#      (legible por cualquier rol vía pg_shdescription; solo el dueño de la
#      BD puede escribirla). Si la marca falta, no coincide exactamente, o no
#      se puede comprobar, se aborta. Unos secrets coherentes que apunten a
#      otro proyecto NO pasan: ese proyecto no tiene la marca. Tampoco los
#      proyectos de validación anteriores (Fase 3: proyecto nuevo, con una
#      marca distinta de la de la Fase 2.8).
#
# Nunca imprime valores de variables ni la salida de error de psql (podría
# contener el host o el usuario de la conexión).
#
# Uso: source tests/supabase/guard.sh [VAR_EXTRA ...]

ROOMLY_VALIDATION_MARKER="roomly-validation-3"

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
    roomly_guard_diagnose "$ref" >&2
    return 1
  fi

  echo "guard: destino verificado como ${ROOMLY_VALIDATION_MARKER} (coherencia local + marca del proyecto)"
}

# Diagnóstico de la marca que no coincide (Fase 2.8): ayuda a saber a qué
# proyecto apuntan unos secrets que no se pueden leer. Solo de lectura e
# imprime únicamente datos no sensibles:
#   - los 4 primeros caracteres del project ref (nunca el ref completo);
#   - el nombre de la base de datos conectada;
#   - la marca encontrada, solo si es texto simple [a-z0-9-] de hasta 40
#     caracteres (si no, solo su longitud);
#   - cuántas tablas hay en public.
# Nunca imprime la URL, la cadena de conexión, contraseñas ni claves, ni la
# salida de error de psql.
roomly_guard_diagnose() {
  local ref="$1" row db marker tables shown
  row="$(PGSSLMODE="${PGSSLMODE:-require}" psql -X -q -At --no-psqlrc -F '|' \
    -v ON_ERROR_STOP=1 -d "$SUPABASE_VALIDATION_DB_URL" \
    -c "select current_database(),
               coalesce(shobj_description(d.oid, 'pg_database'), ''),
               (select count(*) from pg_tables where schemaname = 'public')
        from pg_database d where d.datname = current_database()" 2>/dev/null)" || row=""
  if [ -z "$row" ]; then
    echo "       diagnóstico: no disponible (la consulta de diagnóstico no respondió)."
    return 0
  fi
  IFS='|' read -r db marker tables <<<"$row"
  if [ -z "$marker" ]; then
    shown="(sin marca)"
  elif [[ "$marker" =~ ^[a-z0-9-]{1,40}$ ]]; then
    shown="'${marker}'"
  else
    shown="(marca con otro formato, ${#marker} caracteres)"
  fi
  [[ "$db" =~ ^[a-z0-9_]{1,63}$ ]] || db="(nombre con otro formato)"
  [[ "$tables" =~ ^[0-9]+$ ]] || tables="?"
  echo "       diagnóstico: ref ${ref:0:4}… · base de datos ${db} · marca ${shown} · tablas en public: ${tables}"
}

roomly_guard "$@"
