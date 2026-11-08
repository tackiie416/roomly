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
#         COMMENT ON DATABASE postgres IS '<marca>';
#      donde <marca> es la que el Environment declara en la variable
#      SUPABASE_VALIDATION_MARKER y que, además, tiene que estar en la
#      allow-list de abajo. La marca es legible por cualquier rol vía
#      pg_shdescription; solo el dueño de la BD puede escribirla. Si la marca
#      falta, no coincide exactamente con la esperada, o no se puede comprobar,
#      se aborta. Unos secrets coherentes que apunten a otro proyecto NO pasan:
#      ese proyecto no tiene la marca esperada.
#
# Allow-list (F1, proyecto aislado de la Fase 4.x): se aceptan EXCLUSIVAMENTE
# roomly-validation-3 (camino de compatibilidad existente) y roomly-validation-4
# (proyecto de instalación limpia, D2). Quedan rechazados explícitamente los
# proyectos de validación anteriores (Fase 2.8, uwxb…, y Fase 1),
# cualquier marca desconocida y cualquier proyecto de producción: no están en
# la lista. En cada ejecución, la marca esperada (SUPABASE_VALIDATION_MARKER)
# tiene que coincidir EXACTAMENTE con la marca leída de la propia base de datos
# y, cuando el workflow lo pasa, con confirm_project (ROOMLY_CONFIRM_PROJECT).
#
# Nunca imprime valores de variables ni la salida de error de psql (podría
# contener el host o el usuario de la conexión). Las marcas de proyecto no son
# secretas (son etiquetas), pero una marca rechazada no se vuelve a imprimir.
#
# Uso: source tests/supabase/guard.sh [VAR_EXTRA ...]
#   Requiere SUPABASE_VALIDATION_MARKER en el entorno (la declara el Environment).

ROOMLY_VALIDATION_ALLOWED_MARKERS=("roomly-validation-3" "roomly-validation-4")

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

  # --- Marca esperada declarada por el Environment, validada contra la allow-list ---
  # El Environment la declara en SUPABASE_VALIDATION_MARKER. Si no está (R8 y los
  # auto-tests que no la fijan), se mantiene el comportamiento histórico: el
  # proyecto de compatibilidad roomly-validation-3. En el workflow, el paso de
  # confirmación exige además que coincida con confirm_project, así que una
  # ejecución real nunca se queda sin declararla.
  local expected="${SUPABASE_VALIDATION_MARKER:-roomly-validation-3}"
  local allowed="" m
  for m in "${ROOMLY_VALIDATION_ALLOWED_MARKERS[@]}"; do
    [ "$expected" = "$m" ] && allowed=1
  done
  if [ -z "$allowed" ]; then
    echo "ERROR: SUPABASE_VALIDATION_MARKER no es un proyecto de validación permitido." >&2
    echo "       Allow-list: ${ROOMLY_VALIDATION_ALLOWED_MARKERS[*]}. Abortado." >&2
    return 1
  fi
  # Si el workflow pasó confirm_project, debe coincidir exactamente con la marca esperada.
  if [ -n "${ROOMLY_CONFIRM_PROJECT:-}" ] && [ "$ROOMLY_CONFIRM_PROJECT" != "$expected" ]; then
    echo "ERROR: confirm_project no coincide con SUPABASE_VALIDATION_MARKER. Abortado." >&2
    return 1
  fi
  # Marca verificada contra la base de datos: debe ser exactamente la esperada.
  ROOMLY_VALIDATION_MARKER="$expected"

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
