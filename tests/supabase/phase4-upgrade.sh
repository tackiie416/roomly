#!/usr/bin/env bash
# R8 — actualización de roomly-validation-3 con las tres migraciones de la
# Fase 4, sobre el esquema que dejaron los runs 16–19 (Fase 3).
#
#   bash tests/supabase/phase4-upgrade.sh --check-inputs   solo valida el modo
#   bash tests/supabase/phase4-upgrade.sh dry_run          ensayo: siempre ROLLBACK
#   bash tests/supabase/phase4-upgrade.sh apply            aplica (confirmación aparte)
#
# Variables (las pone el workflow desde sus entradas; sin valor = false/vacío):
#   PHASE4_UPGRADE           none | dry_run | apply (para --check-inputs)
#   APPLY_MIGRATIONS         la entrada apply_migrations: debe ser false
#   RUN_E2E_REAL             la entrada run_e2e_real: debe ser false
#   PHASE4_UPGRADE_CONFIRM   solo con apply: exactamente PHASE4_APPLY_PHRASE
#   SUPABASE_VALIDATION_PROJECT_REF, SUPABASE_VALIDATION_DB_URL (guarda F1)
#
# Orden, con fallo cerrado en cada paso:
#   1. el modo y su combinación con las demás entradas, sin conectar;
#   2. el SHA-256 de las tres migraciones, de los dos archivos de estado de
#      partida y del preflight vigente, sin conectar;
#   3. la guarda F1 (coherencia local y marca roomly-validation-3 leída en la
#      propia base de datos);
#   4. en una sola sesión y una sola transacción: client_min_messages = notice
#      (R8-MSG), el preflight congelado de la Fase 3, las comprobaciones
#      R8-BASE, las tres migraciones en orden, el preflight vigente (P0–P6) y
#      R8-MSG otra vez. Después, ROLLBACK (dry_run) o COMMIT (apply). Un error
#      corta psql (ON_ERROR_STOP) antes del final de la transacción.
#
# Una pasada solo vale si psql termina bien, sin WARNING (psql no convierte un
# WARNING en error, y solo se ve al leer la salida) y con los avisos de éxito
# esperados, en orden (EXPECTED_NOTICES). apply hace dos pasadas: primero la de
# dry_run, y solo si vale repite todo con COMMIT. Si la pasada con COMMIT falla,
# el resultado no se da por conocido: con la conexión perdida durante el
# COMMIT, pudo quedar aplicado o no.
#
# Nunca imprime la cadena de conexión ni la salida de error de psql en bruto:
# solo NOTICE/WARNING/ERROR filtrados (roomly_sql_filter_output). No usa la CLI
# de Supabase ni variables de Netlify o Vercel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

PHASE4_APPLY_PHRASE="aplicar-fase4-en-roomly-validation-3"

# Archivos fijados: nombre y SHA-256. Cambiar cualquiera exige revisar y
# actualizar esta lista (validation-infra comprueba que coincide).
PHASE4_MIGRATIONS=(
  "20261013120000_rooms_deleted_account_writes.sql 75a5a3b1b0e8c6482b32a17cc678418ebe082b8f15c58cbc0001d753846371ff"
  "20261015120000_rooms_integrity_publication.sql c0a8cb51f8353f06911ed0c4e78badf1d876bfecdcc64d1e60398046fa1ddefa"
  "20261016120000_barcelona_neighborhoods.sql 5ea9dae6c5281ac6eac679c184d88bb2cd2a974dba7c0f7cd25013e37bb11ff0"
)
# Copia exacta de tests/supabase/preflight.sql en f2c12c9 (blob 7155e796…), el
# mismo que pasó en el run 19 contra roomly-validation-3.
PHASE3_BASELINE="tests/supabase/phase3-baseline-preflight.sql 2c33c4a1d8dfb9a838b830777a71e4e877493da24b8fc976c9224bbd15a6e4c4"
PHASE4_BASELINE_CHECKS="tests/supabase/phase4-upgrade-baseline.sql 7c8909b9a3a25394b58d8e2eb81506c6776f28eaecbce8e91eb72ce7d125f491"
# Preflight vigente: el estado de llegada (P0–P6 de la Fase 4), comprobado
# antes del COMMIT. No es el de partida (PHASE3_BASELINE). Si cambia de forma
# legítima: revisar su diff (sin control de transacciones ni meta-comandos de
# psql), recalcular con `sha256sum tests/supabase/preflight.sql` y actualizar
# esta línea. validation-infra comprueba que coincide.
PHASE4_FINAL_PREFLIGHT="tests/supabase/preflight.sql 38ef7a3b011e72519eb4cc695408677c18f6743c547b6440e562565e9ef840ec"

# Avisos de éxito (NOTICE) que tiene que mostrar cada pasada, en este orden:
# R8-MSG, P6 del preflight congelado, R8-BASE, P6 del vigente y R8-MSG. Si no
# llegan, tampoco llegaría un WARNING, así que su ausencia es un fallo.
EXPECTED_NOTICES=("ok - R8-MSG:" "ok - P6:" "ok - R8-BASE:" "ok - P6:" "ok - R8-MSG:")

# Solo antes de conectar: entradas, modo y SHA-256.
die() {
  echo "ERROR: $1" >&2
  echo "RESULTADO: actualización de la Fase 4 NO ejecutada (nada aplicado)" >&2
  exit 1
}

# 1. Modo y combinación con las demás entradas del workflow.
check_inputs() {
  local mode="$1"
  case "$mode" in
    none | dry_run | apply) ;;
    *) die "phase4_upgrade debe ser none, dry_run o apply" ;;
  esac
  if [ "$mode" = "none" ]; then
    [ -z "${PHASE4_UPGRADE_CONFIRM:-}" ] \
      || die "confirm_phase4_upgrade solo se admite con phase4_upgrade=apply"
    return 0
  fi
  [ "${APPLY_MIGRATIONS:-false}" = "false" ] \
    || die "phase4_upgrade no se combina con apply_migrations=true"
  [ "${RUN_E2E_REAL:-false}" = "false" ] \
    || die "phase4_upgrade no se combina con run_e2e_real=true"
  if [ "$mode" = "apply" ]; then
    [ "${PHASE4_UPGRADE_CONFIRM:-}" = "$PHASE4_APPLY_PHRASE" ] \
      || die "apply exige confirm_phase4_upgrade exactamente igual a ${PHASE4_APPLY_PHRASE}"
  else
    [ -z "${PHASE4_UPGRADE_CONFIRM:-}" ] \
      || die "confirm_phase4_upgrade solo se admite con phase4_upgrade=apply"
  fi
}

# 2. Integridad de los archivos fijados.
check_pinned() {
  local entry path expected actual
  for entry in "$@"; do
    path="${entry% *}"
    expected="${entry##* }"
    [ -f "$ROOT/$path" ] || die "falta el archivo fijado ${path}"
    actual="$(sha256sum "$ROOT/$path" | cut -c1-64)"
    [ "$actual" = "$expected" ] \
      || die "el SHA-256 de ${path} no es el fijado (archivo cambiado o sustituido)"
  done
}

if [ "${1:-}" = "--check-inputs" ]; then
  check_inputs "${PHASE4_UPGRADE:-none}"
  echo "phase4_upgrade=${PHASE4_UPGRADE:-none}: combinación de entradas válida"
  exit 0
fi

MODE="${1:-}"
case "$MODE" in
  dry_run | apply) ;;
  *) die "uso: phase4-upgrade.sh dry_run | apply | --check-inputs" ;;
esac
check_inputs "$MODE"

pinned=("$PHASE3_BASELINE" "$PHASE4_BASELINE_CHECKS" "$PHASE4_FINAL_PREFLIGHT")
for entry in "${PHASE4_MIGRATIONS[@]}"; do
  pinned+=("supabase/migrations/${entry}")
done
check_pinned "${pinned[@]}"
echo "phase4-upgrade: modo ${MODE}; SHA-256 de las 3 migraciones, del estado de partida y del preflight vigente verificados"

# 3. Guarda F1.
# shellcheck source=tests/supabase/guard.sh
source "$ROOT/tests/supabase/guard.sh" SUPABASE_VALIDATION_DB_URL
export PGSSLMODE="${PGSSLMODE:-require}"
# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# R8-MSG: los WARNING solo se detectan si llegan a psql. Un client_min_messages
# más alto (warning o error) en el rol o en la base de datos los ocultaría.
msg_check() {
  cat <<SQL
do \$\$
begin
  if current_setting('client_min_messages') <> 'notice' then
    raise exception 'FALLO R8-MSG (%): client_min_messages = %; los WARNING no llegarían a psql',
      '${1}', current_setting('client_min_messages');
  end if;
  raise notice 'ok - R8-MSG: client_min_messages = notice ${1}; los WARNING llegan a psql';
end \$\$;
SQL
}

# 4. El flujo de una pasada, terminado en ROLLBACK o COMMIT.
stream() {
  local ending="$1" entry
  echo "\\echo '== R8 · transacción abierta (termina en ${ending})'"
  echo "begin;"
  echo "set local client_min_messages = notice;"
  echo "set local lock_timeout = '10s';"
  echo "set local statement_timeout = '5min';"
  msg_check "al empezar"
  echo "\\echo '== R8 · estado de partida: preflight congelado de la Fase 3'"
  cat "$ROOT/${PHASE3_BASELINE% *}"
  echo "\\echo '== R8 · estado de partida: R8-BASE'"
  cat "$ROOT/${PHASE4_BASELINE_CHECKS% *}"
  for entry in "${PHASE4_MIGRATIONS[@]}"; do
    echo "\\echo '== R8 · migración ${entry% *}'"
    cat "$ROOT/supabase/migrations/${entry% *}"
    echo
  done
  echo "\\echo '== R8 · preflight vigente sobre el resultado, antes de ${ending}'"
  cat "$ROOT/${PHASE4_FINAL_PREFLIGHT% *}"
  msg_check "antes de ${ending}"
  echo "${ending};"
  echo "\\echo '== R8 · ${ending} hecho'"
}

# Una pasada: 0 si psql terminó bien, sin WARNING y con EXPECTED_NOTICES;
# 1 si psql falló; 2 si psql terminó bien pero hubo WARNING o faltan avisos.
run_pass() {
  local ending="$1" out="$WORK/pass-$1.log" status=0 warn=0 seen expected
  stream "$ending" | psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc \
    -d "$SUPABASE_VALIDATION_DB_URL" >"$out" 2>&1 || status=$?
  roomly_sql_filter_output "$out" || warn=1
  if [ "$status" -ne 0 ]; then
    if ! grep -qE '^(psql:<stdin>:[0-9]+: )?(ERROR|NOTICE|WARNING):' "$out"; then
      echo "   ERROR: psql terminó sin mensajes del servidor (conexión u otro fallo; detalle omitido)"
    fi
    echo "   psql terminó con código ${status} en la pasada (${ending})"
    return 1
  fi
  if [ "$warn" -ne 0 ]; then
    echo "   WARNING en la pasada (${ending}): fallo cerrado"
    return 2
  fi
  # Solo cuentan las líneas NOTICE del servidor, no un texto dentro de otra.
  seen="$(sed -nE 's/^(psql:<stdin>:[0-9]+: )?NOTICE:  (ok - (R8-[A-Z]+|P6):).*$/\2/p' "$out")"
  expected="$(printf '%s\n' "${EXPECTED_NOTICES[@]}")"
  if [ "$seen" != "$expected" ]; then
    echo "   faltan avisos de éxito en la pasada (${ending}): se esperaban, en orden, R8-MSG, P6 (congelado), R8-BASE, P6 (vigente) y R8-MSG; fallo cerrado"
    return 2
  fi
  return 0
}

status=0
run_pass rollback || status=$?
if [ "$status" -ne 0 ]; then
  # Esta pasada no envía COMMIT: todo su contenido está fijado por SHA-256.
  echo "RESULTADO: ensayo FALLIDO; nada confirmado (la pasada termina en ROLLBACK y no envía COMMIT)" >&2
  exit 1
fi
if [ "$MODE" = "dry_run" ]; then
  echo "RESULTADO: dry_run correcto: las 3 migraciones se aplican y el resultado pasa P0–P6; todo revertido (ROLLBACK)"
  exit 0
fi

echo "phase4-upgrade: ensayo limpio; se repite con COMMIT"
run_pass commit || status=$?
if [ "$status" -eq 1 ]; then
  echo "RESULTADO: apply NO CONFIRMADO: la pasada con COMMIT falló y su resultado es incierto (si la conexión se perdió durante el COMMIT, la actualización pudo quedar aplicada o no; al ser una sola transacción, está entera o no está). Antes de volver a ejecutar nada, comprueba el estado con el preflight vigente (tests/supabase/run-preflight.sh)" >&2
  exit 1
fi
if [ "$status" -eq 2 ]; then
  echo "RESULTADO: apply NO VÁLIDO: psql terminó sin error, así que el COMMIT se ejecutó, pero la segunda pasada tuvo WARNING o le faltan avisos de éxito. Antes de seguir, comprueba el estado con el preflight vigente (tests/supabase/run-preflight.sh)" >&2
  exit 1
fi
echo "RESULTADO: apply correcto: las 3 migraciones de la Fase 4 aplicadas y P0–P6 superadas antes del COMMIT"
