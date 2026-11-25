#!/usr/bin/env bash
# Verificación independiente de la limpieza de un proyecto de validación
# (paso 8 del procedimiento D2 de la 4.2): SOLO LECTURA.
#
# Comprueba que en el proyecto no quedan usuarios, filas de usuario ni objetos
# de Storage de las pruebas. NO limpia nada: no escribe, no borra y no tiene
# ningún modo de aplicación. Cualquier limpieza es otra decisión, con otra
# herramienta y su autorización.
#
# Uso:
#   ROOMLY_CLEANUP_DB_URL=<URL de la base de datos> \
#     bash tests/supabase/validation-cleanup-check.sh --expect-marker roomly-validation-4
#
#   --expect-marker M   marca esperada de la base de datos (comment on
#                       database): roomly-validation-3 o roomly-validation-4.
#                       Si no coincide, no se informa de nada (salida 2).
#
# Solo lectura, en tres niveles: la sesión con default_transaction_read_only,
# una transacción READ ONLY que termina en ROLLBACK, y un SQL que solo lee
# (validation-infra lo comprueba). Ejecutarlo contra un proyecto remoto
# necesita autorización.
#
# El informe solo muestra la marca, nombres de comprobaciones y contadores:
# nunca la URL de la base de datos, emails, ids ni rutas.
#
# Salida: 0 limpio (todo a 0); 1 quedan restos; 2 no se pudo inspeccionar
# (entrada no válida, marca distinta, conexión, permisos o una RLS que podría
# ocultar filas).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

usage_error() {
  echo "RESULTADO: NO VERIFICABLE: entrada no válida: $1 (no se ha conectado a nada)" >&2
  exit 2
}

EXPECTED_MARKER=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expect-marker)
      [ "$#" -ge 2 ] || usage_error "falta el valor de --expect-marker"
      EXPECTED_MARKER="$2"
      shift 2
      ;;
    *) usage_error "argumento desconocido: $1" ;;
  esac
done

case "$EXPECTED_MARKER" in
  roomly-validation-3 | roomly-validation-4) ;;
  "") usage_error "falta --expect-marker (roomly-validation-3 o roomly-validation-4)" ;;
  *) usage_error "--expect-marker solo acepta roomly-validation-3 o roomly-validation-4" ;;
esac
DB_URL="${ROOMLY_CLEANUP_DB_URL:-}"
[ -n "$DB_URL" ] || usage_error "falta ROOMLY_CLEANUP_DB_URL"

export PGSSLMODE="${PGSSLMODE:-require}"
# La marca ya está validada contra la allow-list: no admite espacios ni comillas.
export PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on -c roomly.expected_marker=${EXPECTED_MARKER}"

# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

status=0
{
  echo "begin transaction isolation level repeatable read read only;"
  cat "$ROOT/tests/supabase/validation-cleanup-check.sql"
  echo "rollback;"
} | psql -X -q -At -F $'\t' -v ON_ERROR_STOP=1 --no-psqlrc \
  -d "$DB_URL" >"$WORK/report.tsv" 2>"$WORK/error.log" || status=$?

echo "== Verificación de la limpieza (solo lectura)"
if [ "$status" -ne 0 ]; then
  # Solo los errores de SQL; nunca los datos de conexión.
  roomly_sql_filter_output "$WORK/error.log" || true
  echo "RESULTADO: NO VERIFICABLE: no se pudo inspeccionar (marca, conexión, permisos o RLS; psql terminó con ${status}). No se ha cambiado nada." >&2
  exit 2
fi

marker="$(awk -F'\t' '$1 == "marca" { print $2; exit }' "$WORK/report.tsv")"
if [ "$marker" != "$EXPECTED_MARKER" ]; then
  echo "RESULTADO: NO VERIFICABLE: el informe no confirma la marca esperada" >&2
  exit 2
fi
echo "marca: ${marker}"
leftovers=0
while IFS=$'\t' read -r name value; do
  [ "$name" = "marca" ] && continue
  echo "${name}: ${value}"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "RESULTADO: NO VERIFICABLE: contador no numérico en ${name}" >&2
    exit 2
  fi
  [ "$value" -eq 0 ] || leftovers=$((leftovers + 1))
done <"$WORK/report.tsv"

if [ "$leftovers" -gt 0 ]; then
  echo "RESULTADO: QUEDAN RESTOS: ${leftovers} comprobación(es) con filas u objetos. Solo informe: no se ha cambiado nada."
  exit 1
fi
echo "RESULTADO: limpio: 0 usuarios, 0 filas de usuario y 0 objetos de Storage. No se ha cambiado nada."
