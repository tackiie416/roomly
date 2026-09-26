#!/usr/bin/env bash
# Guarda común de la validación contra Supabase real. Se usa con `source`.
#
# Comprueba, SIN imprimir ningún valor, que:
#   - existen las variables necesarias (se nombran, nunca se muestran);
#   - la URL de la API y la conexión de base de datos apuntan al MISMO
#     proyecto, identificado por SUPABASE_VALIDATION_PROJECT_REF.
# Es la barrera contra ejecutar tests destructivos en otro proyecto.
#
# Uso: source tests/supabase/guard.sh VAR1 VAR2 ...

roomly_guard() {
  local missing=()
  local name
  for name in SUPABASE_VALIDATION_PROJECT_REF "$@"; do
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
  if [ -n "${SUPABASE_VALIDATION_DB_URL:-}" ] \
    && [[ "$SUPABASE_VALIDATION_DB_URL" != *"postgres.${ref}:"* ]] \
    && [[ "$SUPABASE_VALIDATION_DB_URL" != *"@db.${ref}.supabase.co"* ]]; then
    echo "ERROR: SUPABASE_VALIDATION_DB_URL no corresponde al project ref de validación" >&2
    return 1
  fi

  echo "guard: destino verificado (proyecto de validación)"
}

roomly_guard "$@"
