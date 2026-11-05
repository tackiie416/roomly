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
#   3. el flujo SQL completo, sin conectar: una copia de cada uno de esos seis
#      archivos en un directorio temporal, con el SHA-256 comprobado otra vez
#      sobre la copia y sin control de transacciones ni meta-comandos de psql
#      (roomly_sql_transform); un cuerpo común, y para cada pasada un archivo
#      con ese mismo cuerpo entre su cabecera y su final, comprobado byte a byte;
#   4. la guarda F1 (coherencia local y marca roomly-validation-3 leída en la
#      propia base de datos);
#   5. en cada pasada, una sola sesión y una sola transacción, que psql lee de
#      ese archivo: client_min_messages = notice (R8-MSG), el preflight
#      congelado de la Fase 3, R8-BASE, las tres migraciones en orden, el
#      preflight vigente (P0–P6) y R8-MSG otra vez. Después, ROLLBACK (dry_run)
#      o COMMIT (apply). Un error corta psql (ON_ERROR_STOP) antes del final.
#
# Mientras hay conexión no se lee ningún archivo del repositorio, y psql lee el
# de la pasada en orden: el ROLLBACK o el COMMIT solo llegan si ha leído todo lo
# anterior.
#
# Una pasada solo vale si psql termina bien, llega a su última línea («== R8 ·
# <final> hecho», que psql solo imprime si el ROLLBACK o el COMMIT terminaron
# bien), sin WARNING (psql no convierte un WARNING en error, y solo se ve al leer
# la salida) y con los avisos de éxito esperados, en orden (EXPECTED_NOTICES).
# apply hace dos pasadas: primero la de dry_run, y solo si vale repite el mismo
# cuerpo con COMMIT. Si la pasada con COMMIT falla o se interrumpe, el resultado
# no se da por conocido: con la conexión perdida durante el COMMIT, pudo quedar
# aplicado o no. Qué hacer entonces: docs/SUPABASE_VALIDATION.md, «Recuperación».
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
# legítima, el procedimiento para actualizar esta línea (y solo esta) está en
# docs/SUPABASE_VALIDATION.md, «Cambiar el SHA-256 del preflight vigente».
# validation-infra comprueba que coincide.
PHASE4_FINAL_PREFLIGHT="tests/supabase/preflight.sql 38ef7a3b011e72519eb4cc695408677c18f6743c547b6440e562565e9ef840ec"

# Avisos de éxito (NOTICE) que tiene que mostrar cada pasada, en este orden:
# R8-MSG, P6 del preflight congelado, R8-BASE, P6 del vigente y R8-MSG. Si no
# llegan, tampoco llegaría un WARNING, así que su ausencia es un fallo.
EXPECTED_NOTICES=("ok - R8-MSG:" "ok - P6:" "ok - R8-BASE:" "ok - P6:" "ok - R8-MSG:")

# Solo antes de conectar: entradas, modo, SHA-256 y construcción del flujo.
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

# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SRC="$WORK/src"
BODY="$WORK/body.sql"
mkdir "$SRC"

# Interrupción (cancelación o timeout del job): la línea RESULTADO dice si la
# pasada con COMMIT había empezado. Un SIGKILL o la pérdida del runner no dejan
# ninguna línea, y su ausencia no demuestra nada.
STAGE="la preparación del flujo"
on_signal() {
  if [ "$STAGE" = "la pasada con COMMIT" ]; then
    echo "RESULTADO: apply INTERRUMPIDO (señal $1) durante la pasada con COMMIT: resultado incierto (no se sabe si el COMMIT llegó a ejecutarse). No repitas apply: sigue «Recuperación» en docs/SUPABASE_VALIDATION.md" >&2
  else
    echo "RESULTADO: INTERRUMPIDO (señal $1) durante ${STAGE}: nada confirmado (todavía no se había enviado ningún COMMIT)" >&2
  fi
  exit $((128 + $2))
}
trap 'on_signal HUP 1' HUP
trap 'on_signal INT 2' INT
trap 'on_signal TERM 15' TERM

# 3. El flujo SQL, construido entero antes de conectar.
src_of() { echo "$SRC/$(basename "${1% *}")"; }

# Copia verificada de un archivo fijado: su SHA-256 otra vez, sobre la copia, y
# sin control de transacciones ni meta-comandos de psql. roomly_sql_transform
# admite bloques `begin;`/`rollback;` (los de tests/db), que aquí cerrarían la
# transacción: se rechazan también.
stage_pinned() {
  local path="${1% *}" expected="${1##* }" copy transformed
  copy="$(src_of "$1")"
  cp "$ROOT/$path" "$copy" 2>/dev/null \
    || die "no se pudo copiar ${path} para construir el flujo"
  [ "$(sha256sum "$copy" | cut -c1-64)" = "$expected" ] \
    || die "la copia de ${path} no tiene el SHA-256 fijado (el archivo cambió después de comprobarlo)"
  transformed="$(roomly_sql_transform "$copy")" \
    || die "${path} no supera roomly_sql_transform (control de transacciones o meta-comandos de psql)"
  if grep -q "roomly_file" <<<"$transformed"; then
    die "${path} contiene un bloque begin;/rollback; (control de transacciones)"
  fi
}

# concat_verified <salida> <parte>...: escribe las partes en orden y comprueba
# que la salida es exactamente eso: cada parte, byte a byte, en su posición, y
# nada más.
concat_verified() {
  local out="$1" part size offset=0
  shift
  cat "$@" >"$out" || return 1
  for part in "$@"; do
    size="$(stat -c %s "$part")" || return 1
    cmp -s <(tail -c "+$((offset + 1))" "$out" | head -c "$size") "$part" || return 1
    offset=$((offset + size))
  done
  [ "$(stat -c %s "$out")" -eq "$offset" ]
}

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

section() { printf '%s\n' "\\echo '== R8 · $1'"; }

pass_head() {
  local ending="$1"
  section "transacción abierta (termina en ${ending})" \
    && echo "begin;" \
    && echo "set local client_min_messages = notice;" \
    && echo "set local lock_timeout = '10s';" \
    && echo "set local statement_timeout = '5min';" \
    && msg_check "al empezar"
}

pass_foot() {
  local ending="$1"
  msg_check "antes de ${ending}" \
    && echo "${ending};" \
    && section "${ending} hecho"
}

# build_pass <rollback|commit>: $WORK/pass-<final>.sql es la cabecera, el
# cuerpo común y el final, y su único ROLLBACK o COMMIT es la penúltima línea.
build_pass() {
  local ending="$1"
  local head="$WORK/head-${ending}.sql" foot="$WORK/foot-${ending}.sql" pass="$WORK/pass-${ending}.sql"
  pass_head "$ending" >"$head" && pass_foot "$ending" >"$foot" \
    && concat_verified "$pass" "$head" "$BODY" "$foot" \
    || die "el flujo de la pasada (${ending}) no se ha construido completo"
  [ "$(grep -ciE '^[[:space:]]*(commit|rollback)[[:space:]]*;[[:space:]]*$' "$pass")" = 1 ] \
    && [ "$(tail -n 2 "$pass" | sed -n 1p)" = "${ending};" ] \
    && [ "$(sed -n '$p' "$pass")" = "\\echo '== R8 · ${ending} hecho'" ] \
    || die "el flujo de la pasada (${ending}) no termina en un único ${ending} seguido de su última línea"
}

for entry in "${pinned[@]}"; do
  stage_pinned "$entry"
done

# Cuerpo común a las dos pasadas: las líneas de sección son partes más.
body_parts=()
add_line() {
  local part="$WORK/line-${#body_parts[@]}.sql"
  printf '%s\n' "$1" >"$part" || die "no se pudo escribir el flujo en el directorio temporal"
  body_parts+=("$part")
}
add_line "$(section "estado de partida: preflight congelado de la Fase 3")"
body_parts+=("$(src_of "$PHASE3_BASELINE")")
add_line "$(section "estado de partida: R8-BASE")"
body_parts+=("$(src_of "$PHASE4_BASELINE_CHECKS")")
for entry in "${PHASE4_MIGRATIONS[@]}"; do
  add_line "$(section "migración ${entry% *}")"
  body_parts+=("$SRC/${entry% *}")
  add_line ""
done
add_line "$(section "preflight vigente sobre el resultado")"
body_parts+=("$(src_of "$PHASE4_FINAL_PREFLIGHT")")
concat_verified "$BODY" "${body_parts[@]}" || die "el cuerpo del flujo no se ha construido completo"

build_pass rollback
if [ "$MODE" = "apply" ]; then
  build_pass commit
fi
echo "phase4-upgrade: flujo construido y comprobado antes de conectar (cuerpo común, SHA-256 $(sha256sum "$BODY" | cut -c1-12)…)"

# 4. Guarda F1.
STAGE="la guarda"
# shellcheck source=tests/supabase/guard.sh
source "$ROOT/tests/supabase/guard.sh" SUPABASE_VALIDATION_DB_URL
export PGSSLMODE="${PGSSLMODE:-require}"

# Una pasada: 0 si psql terminó bien, sin ningún ERROR del servidor, llegó a
# «== R8 · <final> hecho», sin WARNING y con EXPECTED_NOTICES; 1 si psql falló,
# mostró un ERROR o no llegó a esa línea (con COMMIT: resultado incierto); 2 si
# llegó (el COMMIT se ejecutó) pero hubo WARNING o faltan avisos.
run_pass() {
  local ending="$1" out="$WORK/out-$1.log" status=0 warn=0 seen expected
  psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$SUPABASE_VALIDATION_DB_URL" \
    <"$WORK/pass-${ending}.sql" >"$out" 2>&1 || status=$?
  roomly_sql_filter_output "$out" || warn=1
  if [ "$status" -ne 0 ]; then
    if ! grep -qE '^(psql:<stdin>:[0-9]+: )?(ERROR|NOTICE|WARNING):' "$out"; then
      echo "   ERROR: psql terminó sin mensajes del servidor (conexión u otro fallo; detalle omitido)"
    fi
    echo "   psql terminó con código ${status} en la pasada (${ending})"
    return 1
  fi
  # Con ON_ERROR_STOP, un error corta psql: un ERROR con código 0 significa que
  # algo lo desactivó, y entonces la línea final no prueba nada (un COMMIT sobre
  # una transacción abortada es un ROLLBACK). Solo cuentan las líneas que
  # empiezan por ERROR (las filas de resultados empiezan por un espacio y los
  # avisos, por NOTICE).
  if grep -qE '^(psql:<stdin>:[0-9]+: )?ERROR:  ' "$out"; then
    echo "   ERROR del servidor en la pasada (${ending}) aunque psql terminó con código 0: fallo cerrado"
    return 1
  fi
  # psql solo imprime esta línea después de que el ROLLBACK o el COMMIT
  # terminen bien (ON_ERROR_STOP); sin ella, no consta que llegara a enviarlos.
  if ! grep -qxF "== R8 · ${ending} hecho" "$out"; then
    echo "   psql terminó sin llegar al final del flujo de la pasada (${ending}): falta «== R8 · ${ending} hecho»"
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

STAGE="la pasada de ensayo (ROLLBACK)"
status=0
run_pass rollback || status=$?
if [ "$status" -ne 0 ]; then
  # El flujo de esta pasada no contiene COMMIT (comprobado al construirlo).
  echo "RESULTADO: ensayo FALLIDO; nada confirmado (la pasada termina en ROLLBACK y no envía COMMIT)" >&2
  exit 1
fi
if [ "$MODE" = "dry_run" ]; then
  echo "RESULTADO: dry_run correcto: las 3 migraciones se aplican y el resultado pasa P0–P6; todo revertido (ROLLBACK)"
  exit 0
fi

# Desde aquí, una interrupción deja el resultado incierto (on_signal).
STAGE="la pasada con COMMIT"
echo "phase4-upgrade: ensayo limpio; se repite el mismo cuerpo con COMMIT"
run_pass commit || status=$?
if [ "$status" -eq 1 ]; then
  echo "RESULTADO: apply NO CONFIRMADO: la pasada con COMMIT falló, mostró un ERROR o no llegó al final, y su resultado es incierto (si la conexión se perdió durante el COMMIT, la actualización pudo quedar aplicada o no; al ser una sola transacción, está entera o no está). No repitas apply: investiga antes el estado según «Recuperación» en docs/SUPABASE_VALIDATION.md (primero un dry_run, que no confirma nada; si falla en el estado de partida, el preflight vigente, tests/supabase/run-preflight.sh, que en el workflow lanza también las suites)" >&2
  exit 1
fi
if [ "$status" -eq 2 ]; then
  echo "RESULTADO: apply NO VÁLIDO: el COMMIT se ejecutó (psql llegó a «== R8 · commit hecho»), pero la segunda pasada tuvo WARNING o le faltan avisos de éxito. No repitas apply: comprueba el estado de llegada con el preflight vigente (tests/supabase/run-preflight.sh; ver «Recuperación» en docs/SUPABASE_VALIDATION.md)" >&2
  exit 1
fi
echo "RESULTADO: apply correcto: las 3 migraciones de la Fase 4 aplicadas y P0–P6 superadas antes del COMMIT"
