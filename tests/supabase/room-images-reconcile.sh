#!/usr/bin/env bash
# Informe de conciliación de las fotos (Fase 4.2, D3): SOLO LECTURA.
#
# Compara los objetos del bucket room-images (metadatos de storage.objects)
# con las filas de public.room_images y clasifica las diferencias. NO
# corrige nada: no escribe, no borra objetos ni filas y no tiene ningún modo
# de aplicación. Cualquier limpieza es otra decisión, con otra herramienta y
# su autorización.
#
# Uso:
#   ROOMLY_RECONCILE_DB_URL=<URL de la base de datos> \
#     bash tests/supabase/room-images-reconcile.sh [--min-age-hours N] [--as-of FECHA]
#
#   --min-age-hours N   antigüedad mínima (1–8760 h; 24 por defecto) de un
#                       objeto sin fila para ser candidato a huérfano. Los más
#                       recientes se listan aparte: la subida puede estar en
#                       curso.
#   --as-of FECHA       fecha de referencia, ISO 8601 con zona
#                       (2026-10-25T12:00:00Z); por defecto, la del servidor.
#                       Con la misma fecha y los mismos datos, el informe es
#                       idéntico.
#
# Solo lectura, en tres niveles: la sesión con default_transaction_read_only,
# una transacción READ ONLY que termina en ROLLBACK, y un SQL que solo lee
# (validation-infra lo comprueba). Ejecutarlo contra un proyecto remoto sigue
# necesitando autorización: lee todas las rutas de las fotos.
#
# El informe solo muestra categorías, rutas (ids) y horas: nunca la URL de la
# base de datos, tokens ni URL firmadas.
#
# Salida: 0 sin inconsistencias confirmadas; 1 hay objetos sin fila más
# antiguos que el umbral o filas sin objeto; 2 no se pudo inspeccionar
# (entrada no válida, conexión, permisos o una RLS que podría ocultar filas).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

usage_error() {
  echo "RESULTADO: NO VERIFICABLE: entrada no válida: $1 (no se ha conectado a nada)" >&2
  exit 2
}

MIN_AGE_HOURS=24
AS_OF=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --min-age-hours)
      [ "$#" -ge 2 ] || usage_error "falta el valor de --min-age-hours"
      MIN_AGE_HOURS="$2"
      shift 2
      ;;
    --as-of)
      [ "$#" -ge 2 ] || usage_error "falta el valor de --as-of"
      AS_OF="$2"
      shift 2
      ;;
    *) usage_error "argumento desconocido: $1" ;;
  esac
done

if ! [[ "$MIN_AGE_HOURS" =~ ^[0-9]{1,4}$ ]] || [ "$MIN_AGE_HOURS" -lt 1 ] || [ "$MIN_AGE_HOURS" -gt 8760 ]; then
  usage_error "--min-age-hours tiene que ser un entero entre 1 y 8760"
fi
if [ -n "$AS_OF" ] && ! [[ "$AS_OF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$ ]]; then
  usage_error "--as-of tiene que ser una fecha ISO 8601 con zona, p. ej. 2026-10-25T12:00:00Z"
fi
DB_URL="${ROOMLY_RECONCILE_DB_URL:-}"
[ -n "$DB_URL" ] || usage_error "falta ROOMLY_RECONCILE_DB_URL"

export PGSSLMODE="${PGSSLMODE:-require}"
export PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on"

# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

status=0
{
  echo "begin transaction isolation level repeatable read read only;"
  cat "$ROOT/tests/supabase/room-images-reconcile.sql"
  echo "rollback;"
} | psql -X -q -At -F $'\t' -v ON_ERROR_STOP=1 --no-psqlrc \
  -v as_of="$AS_OF" -v min_age_hours="$MIN_AGE_HOURS" \
  -d "$DB_URL" >"$WORK/report.tsv" 2>"$WORK/error.log" || status=$?

if [ "$status" -ne 0 ]; then
  echo "== Conciliación de room-images (solo lectura)"
  # Solo los errores de SQL; nunca los datos de conexión.
  roomly_sql_filter_output "$WORK/error.log" || true
  echo "RESULTADO: NO VERIFICABLE: no se pudo inspeccionar (conexión, permisos o RLS; psql terminó con ${status}). No se ha cambiado nada." >&2
  exit 2
fi

reference="$(awk -F'\t' '$1 == "referencia" { print $2; exit }' "$WORK/report.tsv")"
if [ -z "$reference" ]; then
  echo "RESULTADO: NO VERIFICABLE: el informe no tiene su línea de referencia" >&2
  exit 2
fi
awk -F'\t' '$1 != "referencia"' "$WORK/report.tsv" >"$WORK/detail.tsv"
count() { awk -F'\t' -v c="$1" '$1 == c' "$WORK/detail.tsv" | wc -l | tr -d ' '; }

orphans="$(count objeto_sin_fila)"
recent="$(count objeto_sin_fila_reciente)"
undated="$(count objeto_sin_fila_sin_fecha)"
rows="$(count fila_sin_objeto)"
foreign="$(count ruta_no_canonica)"

echo "== Conciliación de room-images (solo lectura)"
echo "referencia: ${reference} · antigüedad mínima de un candidato: ${MIN_AGE_HOURS} h"
echo "objeto_sin_fila (candidato a huérfano): ${orphans}"
echo "objeto_sin_fila_reciente (no concluyente): ${recent}"
echo "objeto_sin_fila_sin_fecha (no verificable): ${undated}"
echo "fila_sin_objeto: ${rows}"
echo "ruta_no_canonica (ajena a las fotos de la app): ${foreign}"
echo "-- detalle: categoría, ruta, horas hasta la referencia"
cat "$WORK/detail.tsv"
echo "-- límite: compara metadatos (storage.objects) con room_images; no comprueba que el archivo exista en el almacenamiento de Storage"

if [ "$orphans" -gt 0 ] || [ "$rows" -gt 0 ]; then
  echo "RESULTADO: INCONSISTENCIAS: ${orphans} objeto(s) sin fila y ${rows} fila(s) sin objeto. Solo informe: no se ha cambiado nada."
  exit 1
fi
echo "RESULTADO: sin inconsistencias confirmadas (${recent} reciente(s) y ${undated} sin fecha sin concluir). No se ha cambiado nada."