#!/usr/bin/env bash
# Auto-test de tests/supabase/phase4-upgrade.sh (R8) contra un PostgreSQL
# LOCAL temporal (nunca contra Supabase ni con credenciales reales).
#
# Simula roomly-validation-3 como los demás selftests: el usuario de pooler
# postgres.<ref> (rol temporal con contraseña aleatoria) y la marca exacta.
# Construye una vez el esquema de la Fase 3 (migraciones hasta 20261007120000
# y seed, como el run 16) y lo clona para cada caso. Comprueba:
#   A. combinaciones de entradas: se rechazan apply_migrations=true,
#      run_e2e_real=true, apply sin la confirmación exacta, un modo
#      desconocido y una confirmación sin apply, antes de conectar;
#   B. dry_run: pasa P0–P6 dentro de la transacción y no deja nada;
#   C. apply: aplica las 3 migraciones y el esquema pasa el preflight vigente;
#   D. una segunda aplicación se rechaza sin cambiar nada;
#   E. otra marca, o ninguna, se rechaza;
#   F. un esquema de partida inesperado se rechaza (política de más, un
#      barrio, la 4.0 ya aplicada, una restricción de la 4.1, una tabla de
#      otro rol, un usuario de prueba);
#   G. un archivo con otro SHA-256 (una migración, el preflight congelado o el
#      vigente) se rechaza antes de conectar: un psql falso demuestra que no
#      se llega a llamar a psql. Tampoco conecta si un archivo desaparece o
#      cambia justo después de su comprobación, ni si un archivo fijado
#      contiene control de transacciones o meta-comandos de psql;
#      Desde M1, también los meta-comandos a mitad de línea y $$ pegado a un
#      nombre; las barras invertidas de literales y comentarios se aceptan;
#   N. el flujo se construye entero antes de conectar: retirar archivos entre
#      las dos pasadas no cambia la segunda, y una entrada cortada antes del
#      ROLLBACK o del COMMIT no se da por buena;
#   H. un error a mitad (en la segunda migración) revierte todo;
#   I. si el preflight vigente falla, apply no confirma nada;
#   J. un WARNING hace fallar el ensayo y apply no llega a confirmar, también
#      con client_min_messages = error en la base de datos; una migración que
#      oculta los WARNING (client_min_messages) se rechaza (R8-MSG);
#   L. si falta un aviso de éxito esperado (P6 del vigente), la pasada falla;
#   M. un fallo solo en la pasada con COMMIT (un error, o la conexión perdida
#      durante el propio COMMIT) da «NO CONFIRMADO» e «incierto», y pide el
#      preflight antes de repetir: nunca «nada aplicado»;
#   V. un WARNING o un aviso que falta solo en la segunda pasada, con el COMMIT
#      ya ejecutado, da «apply NO VÁLIDO»;
#   S. una señal (SIGINT o SIGTERM al grupo de procesos, como al cancelar un
#      job) durante la pasada con COMMIT da «INTERRUMPIDO… incierto»; durante el
#      ensayo, «nada confirmado»;
#   O. una línea ERROR con psql terminado en 0 (ON_ERROR_STOP desactivado)
#      no vale: incierta en la pasada con COMMIT, ensayo FALLIDO en la primera;
#      el texto «ERROR:» en un aviso o en un resultado no cuenta;
#   R. cada resultado tiene una sola línea RESULTADO, la suya;
#   K. ninguna salida contiene la contraseña ni la cadena de conexión.
#
# Conexión: variables estándar de libpq con un usuario que pueda crear roles
# y bases de datos (igual que tests/db/run.sh). Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
HOST="${PGHOST:-localhost}"
case "$HOST" in /*) HOST=127.0.0.1 ;; esac
PORT="${PGPORT:-5432}"
# Contraseña aleatoria del rol temporal: no se escribe en ningún archivo del
# repositorio ni se imprime (el caso K lo comprueba en todas las salidas).
SELFTEST_PW="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
REF="eeeeeeeeeeeeeeeeeeee"
ROLE="postgres.${REF}"
OTHER="phase4_selftest_other_$$"
BASE="phase4_base_$$"
CASE_PREFIX="phase4_case_$$_"
LAST_PHASE3="20261007120000_compatibility_responses_hardening.sql"
WORK="$(mktemp -d)"
MARKER="$(sed -n 's/^ROOMLY_VALIDATION_MARKER="\(.*\)"$/\1/p' "$ROOT/tests/supabase/guard.sh")"
PHRASE="$(sed -n 's/^PHASE4_APPLY_PHRASE="\(.*\)"$/\1/p' "$ROOT/tests/supabase/phase4-upgrade.sh")"
export PGSSLMODE=disable

cleanup() {
  local db
  for db in $("${ADMIN[@]}" -At -c "select datname from pg_database where datname like '${CASE_PREFIX}%' or datname = '${BASE}'" 2>/dev/null); do
    "${ADMIN[@]}" -c "drop database if exists ${db}" >/dev/null 2>&1 || true
  done
  "${ADMIN[@]}" -c "drop role if exists \"${ROLE}\"" -c "drop role if exists ${OTHER}" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

url() { echo "postgresql://${ROLE}:${SELFTEST_PW}@${HOST}:${PORT}/$1"; }

"${ADMIN[@]}" -c "create role \"${ROLE}\" login superuser password '${SELFTEST_PW}'" \
  -c "create role ${OTHER} nologin" \
  -c "create database ${BASE} owner \"${ROLE}\"" >/dev/null
B=(psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d "$(url "$BASE")")
"${B[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
for migration in "$ROOT"/supabase/migrations/*.sql; do
  [[ "$(basename "$migration")" > "$LAST_PHASE3" ]] && continue
  "${B[@]}" -f "$migration" >/dev/null
done
"${B[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null

failed=0
n_case=0
ok() { echo "   ok - $1"; }
ko() { echo "   FALLO: $1"; failed=1; }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

# clone [marca]: deja en $db una base de datos nueva con el esquema de la
# Fase 3; sin marca si se pasa "", con la exacta si no se pasa nada. No se usa
# dentro de $(...): el contador tiene que sobrevivir entre llamadas.
clone() {
  n_case=$((n_case + 1))
  local marker="${1-$MARKER}"
  db="${CASE_PREFIX}${n_case}"
  if ! "${ADMIN[@]}" -c "create database ${db} template ${BASE} owner \"${ROLE}\"" >/dev/null; then
    echo "   FALLO: no se pudo crear la base de datos del caso ${n_case}"
    exit 1
  fi
  if [ -n "$marker" ]; then
    "${ADMIN[@]}" -c "comment on database ${db} is '${marker}'" >/dev/null
  fi
}
q() { psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d "$(url "$1")" -c "$2"; }
# Huella del esquema y de los datos que tocan las migraciones de la Fase 4.
fp() {
  q "$1" "select md5(concat_ws('|',
    (select string_agg(tablename || '.' || policyname || '.' || cmd, ',' order by tablename, policyname)
       from pg_policies where schemaname = 'public'),
    (select string_agg(x, ',' order by x) from (select conrelid::regclass::text || '.' || conname as x
       from pg_constraint where connamespace = 'public'::regnamespace) c),
    (select string_agg(tgname, ',' order by tgname) from pg_trigger where not tgisinternal),
    (select string_agg(x, ',' order by x) from (select grantee || '.' || table_name || '.' || privilege_type as x
       from information_schema.role_table_grants where table_schema = 'public') g),
    (select string_agg(x, ',' order by x) from (select grantee || '.' || column_name || '.' || privilege_type as x
       from information_schema.column_privileges where table_schema = 'public' and table_name = 'rooms') p),
    (select count(*) from public.cities)::text,
    (select string_agg(slug, ',' order by slug) from public.neighborhoods),
    (select string_agg(t.tablename || '.' || t.tableowner, ',' order by t.tablename)
       from pg_tables t where t.schemaname = 'public')))"
}
# upgrade <árbol> <base de datos> <modo> <log> [VAR=valor ...]
upgrade() {
  local tree="$1" db="$2" mode="$3" log="$4"
  shift 4
  env -u PHASE4_UPGRADE_CONFIRM -u APPLY_MIGRATIONS -u RUN_E2E_REAL "$@" \
    SUPABASE_VALIDATION_PROJECT_REF="$REF" SUPABASE_VALIDATION_DB_URL="$(url "$db")" \
    bash "$tree/tests/supabase/phase4-upgrade.sh" "$mode" >"$WORK/$log" 2>&1
}
logged() { grep -qF -- "$2" "$WORK/$1"; }
# offline <árbol> <modo> <log> [VAR=valor ...]: como upgrade, pero con un psql
# falso delante en el PATH que solo deja constancia de que se le llamó. Toda
# conexión del script pasa por psql: si no hay constancia, no conectó.
STUB="$WORK/stub-bin"
mkdir -p "$STUB"
cat >"$STUB/psql" <<STUB_PSQL
#!/usr/bin/env bash
echo llamado >>"$WORK/psql-calls"
exit 1
STUB_PSQL
chmod +x "$STUB/psql"
offline() {
  local tree="$1" mode="$2" log="$3"
  shift 3
  rm -f "$WORK/psql-calls"
  PATH="$STUB:$PATH" upgrade "$tree" sin_conexion "$mode" "$log" "$@"
}
psql_called() { [ -e "$WORK/psql-calls" ]; }
# Herramientas reales, para los envoltorios de abajo.
export R8_REAL_PSQL R8_REAL_SHA256SUM R8_HOOK_TMP="$WORK"
R8_REAL_PSQL="$(command -v psql)"
R8_REAL_SHA256SUM="$(command -v sha256sum)"
# sha256sum que, justo después de calcular el de R8_TOCTOU_FILE, lo cambia
# (R8_TOCTOU_ACTION=append: le añade «commit;») o lo retira (move): un archivo
# que cambia o desaparece después de su comprobación.
TOCTOU="$WORK/toctou-bin"
mkdir -p "$TOCTOU"
cat >"$TOCTOU/sha256sum" <<'STUB_SHA'
#!/usr/bin/env bash
status=0
"$R8_REAL_SHA256SUM" "$@" || status=$?
if [ "${1:-}" = "${R8_TOCTOU_FILE:-}" ]; then
  case "${R8_TOCTOU_ACTION:-}" in
    append) echo "commit;" >>"$1" ;;
    move) mv "$1" "$1.retirado" ;;
  esac
fi
exit "$status"
STUB_SHA
chmod +x "$TOCTOU/sha256sum"
# psql de verdad con tres ganchos, solo en las llamadas que leen el flujo por la
# entrada estándar (la guarda usa -c y pasa directa):
#   R8_HOOK_CUT=<línea>: la entrada se corta justo antes de esa línea;
#   R8_HOOK_AFTER_ROLLBACK="<archivos>": después de la pasada de ensayo, esos
#     archivos se retiran del árbol;
#   R8_HOOK_PASS=<rollback|commit>: solo en esa pasada, R8_HOOK_PREPEND va al
#     principio de la entrada y R8_HOOK_INSERT, justo antes de la línea
#     R8_HOOK_INSERT_BEFORE (simula un flujo que desactiva ON_ERROR_STOP sin
#     que la herramienta lo haya generado).
HOOK="$WORK/hook-bin"
mkdir -p "$HOOK"
cat >"$HOOK/psql" <<'HOOK_PSQL'
#!/usr/bin/env bash
for arg in "$@"; do
  [ "$arg" = -c ] && exec "$R8_REAL_PSQL" "$@"
done
input="$(mktemp -p "$R8_HOOK_TMP" hook-input.XXXXXX)"
cat >"$input"
if [ -n "${R8_HOOK_CUT:-}" ]; then
  awk -v cut="$R8_HOOK_CUT" '$0 == cut { exit } { print }' "$input" >"$input.cut"
  mv "$input.cut" "$input"
fi
if [ -n "${R8_HOOK_PASS:-}" ] && grep -qx "${R8_HOOK_PASS};" "$input"; then
  awk 'BEGIN { pre = ENVIRON["R8_HOOK_PREPEND"]; if (pre != "") print pre }
       ENVIRON["R8_HOOK_INSERT_BEFORE"] != "" && $0 == ENVIRON["R8_HOOK_INSERT_BEFORE"] { print ENVIRON["R8_HOOK_INSERT"] }
       { print }' "$input" >"$input.mod"
  mv "$input.mod" "$input"
fi
status=0
"$R8_REAL_PSQL" "$@" <"$input" || status=$?
if [ -n "${R8_HOOK_AFTER_ROLLBACK:-}" ] && grep -qx 'rollback;' "$input"; then
  for file in $R8_HOOK_AFTER_ROLLBACK; do mv "$file" "$file.retirado"; done
fi
exit "$status"
HOOK_PSQL
chmod +x "$HOOK/psql"
hooked() { # hooked <árbol> <bd> <modo> <log> [VAR=valor ...]
  local tree="$1" db="$2" mode="$3" log="$4"
  shift 4
  PATH="$HOOK:$PATH" upgrade "$tree" "$db" "$mode" "$log" "$@"
}
# upgrade_signal <árbol> <bd> <modo> <log> <señal> <condición SQL> [VAR=valor ...]:
# lanza la herramienta en su propio grupo de procesos, como un job de Actions,
# espera a que la condición se cumpla y envía la señal a todo el grupo.
# Después termina lo que el cliente dejó a medias en el servidor (con SIGTERM,
# la sesión puede seguir viva un rato) y devuelve el código de la herramienta.
# Un proceso en segundo plano de un script arranca con SIGINT ignorado, y bash
# no deja capturar una señal ignorada al arrancar: env --default-signal=INT la
# devuelve a su comportamiento normal, como en un job de Actions.
upgrade_signal() {
  local tree="$1" db="$2" mode="$3" log="$4" sig="$5" cond="$6" pid rc=0 i
  shift 6
  setsid -w env --default-signal=INT bash -c 'echo $$ >"$0"; exec "$@"' "$WORK/${log%.log}.pgid" \
    env -u PHASE4_UPGRADE_CONFIRM -u APPLY_MIGRATIONS -u RUN_E2E_REAL "$@" \
    SUPABASE_VALIDATION_PROJECT_REF="$REF" SUPABASE_VALIDATION_DB_URL="$(url "$db")" \
    bash "$tree/tests/supabase/phase4-upgrade.sh" "$mode" >"$WORK/$log" 2>&1 &
  pid=$!
  for i in $(seq 1 150); do
    [ "$("${ADMIN[@]}" -At -c "$cond")" = t ] && break
    sleep 0.2
  done
  kill "-$sig" -- "-$(cat "$WORK/${log%.log}.pgid")"
  wait "$pid" || rc=$?
  "${ADMIN[@]}" -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db}'" >/dev/null
  return "$rc"
}
# result_of <log>: la clase de su única línea RESULTADO («varias» si hay más de
# una o ninguna).
result_of() {
  [ "$(grep -c '^RESULTADO:' "$WORK/$1")" = 1 ] || { echo varias; return; }
  case "$(grep '^RESULTADO:' "$WORK/$1")" in
    "RESULTADO: apply correcto"*) echo correcto ;;
    "RESULTADO: dry_run correcto"*) echo dry_run_correcto ;;
    "RESULTADO: apply NO VÁLIDO"*) echo no_valido ;;
    "RESULTADO: apply NO CONFIRMADO"*) echo no_confirmado ;;
    "RESULTADO: apply INTERRUMPIDO"*) echo interrumpido_incierto ;;
    "RESULTADO: INTERRUMPIDO"*) echo interrumpido_sin_commit ;;
    "RESULTADO: ensayo FALLIDO"*) echo ensayo_fallido ;;
    "RESULTADO: actualización de la Fase 4 NO ejecutada"*) echo no_ejecutada ;;
    *) echo desconocido ;;
  esac
}
# Copia del árbol que usa la herramienta, para cambiar un archivo sin tocar el
# repositorio. repin <árbol> <ruta>: actualiza su SHA-256 en el script copiado.
tree_copy() {
  local tree="$WORK/tree-$1"
  mkdir -p "$tree/tests" "$tree/supabase"
  cp -r "$ROOT/tests/supabase" "$tree/tests/"
  cp -r "$ROOT/supabase/migrations" "$tree/supabase/"
  echo "$tree"
}
repin() {
  local tree="$1" rel="$2" name new
  name="$(basename "$rel")"
  new="$(sha256sum "$tree/$rel" | cut -c1-64)"
  # Solo la entrada de ese archivo: el nombre va precedido de " o de /, así que
  # preflight.sql no toca la de phase3-baseline-preflight.sql.
  [ "$(grep -cE "[\"/]${name} [0-9a-f]{64}\"" "$tree/tests/supabase/phase4-upgrade.sh")" = 1 ] \
    || { echo "   FALLO: repin no encuentra una sola entrada fijada para ${name}"; exit 1; }
  sed -i -E "s|([\"/])${name} [0-9a-f]{64}\"|\\1${name} ${new}\"|" "$tree/tests/supabase/phase4-upgrade.sh"
}

M1="20261013120000_rooms_deleted_account_writes.sql"
M2="20261015120000_rooms_integrity_publication.sql"
M3="20261016120000_barcelona_neighborhoods.sql"

echo "== A. combinaciones de entradas (sin conectar)"
inputs() {
  env -u PHASE4_UPGRADE_CONFIRM "$@" bash "$ROOT/tests/supabase/phase4-upgrade.sh" --check-inputs >/dev/null 2>&1
}
check "dry_run con apply_migrations=true se rechaza" \
  "! inputs PHASE4_UPGRADE=dry_run APPLY_MIGRATIONS=true RUN_E2E_REAL=false"
check "dry_run con run_e2e_real=true se rechaza" \
  "! inputs PHASE4_UPGRADE=dry_run APPLY_MIGRATIONS=false RUN_E2E_REAL=true"
check "apply con run_e2e_real=true se rechaza aunque lleve la confirmación" \
  "! inputs PHASE4_UPGRADE=apply RUN_E2E_REAL=true PHASE4_UPGRADE_CONFIRM='$PHRASE'"
check "apply sin confirmación se rechaza" "! inputs PHASE4_UPGRADE=apply"
check "apply con otra confirmación se rechaza" \
  "! inputs PHASE4_UPGRADE=apply PHASE4_UPGRADE_CONFIRM='${PHRASE} '"
check "un modo desconocido se rechaza" "! inputs PHASE4_UPGRADE=true"
check "una confirmación sin apply se rechaza" \
  "! inputs PHASE4_UPGRADE=dry_run PHASE4_UPGRADE_CONFIRM='$PHRASE'"
check "none, dry_run y apply con su confirmación se aceptan" \
  "inputs PHASE4_UPGRADE=none && inputs PHASE4_UPGRADE=dry_run APPLY_MIGRATIONS=false RUN_E2E_REAL=false \
   && inputs PHASE4_UPGRADE=apply PHASE4_UPGRADE_CONFIRM='$PHRASE'"
clone
before="$(fp "$db")"
upgrade "$ROOT" "$db" dry_run a1.log APPLY_MIGRATIONS=true || true
upgrade "$ROOT" "$db" dry_run a2.log RUN_E2E_REAL=true || true
upgrade "$ROOT" "$db" apply a3.log || true
check "el script rechaza esas combinaciones antes de la guarda (no conecta) y no cambia nada" \
  "logged a1.log 'apply_migrations=true' && logged a2.log 'run_e2e_real=true' && logged a3.log 'exactamente igual' \
   && ! logged a1.log 'guard:' && ! logged a2.log 'guard:' && ! logged a3.log 'guard:' && [ \"\$(fp \"$db\")\" = '$before' ]"
# Control del psql falso: con entradas y archivos correctos, la guarda sí lo llama.
offline "$ROOT" dry_run a-control.log || true
check "control: el psql falso deja constancia cuando el script llega a la guarda" "psql_called"
offline "$ROOT" dry_run a4.log APPLY_MIGRATIONS=true || true
check "con el psql falso, una combinación rechazada no llega a llamar a psql" \
  "logged a4.log 'apply_migrations=true' && ! psql_called"

echo "== B. dry_run sobre el esquema de la Fase 3"
clone
before="$(fp "$db")"
check "dry_run termina bien" "upgrade '$ROOT' '$db' dry_run b.log"
check "dentro de la transacción: preflight de la Fase 3, R8-BASE, las 3 migraciones y P0–P6 vigentes" \
  "logged b.log 'ok - R8-BASE' && logged b.log 'migración ${M3}' && [ \"\$(grep -c 'ok - P6:' '$WORK/b.log')\" = 2 ] \
   && logged b.log 'rollback hecho' && logged b.log 'dry_run correcto'"
check "R8-MSG al empezar y antes del ROLLBACK: client_min_messages = notice" \
  "logged b.log 'ok - R8-MSG: client_min_messages = notice al empezar' \
   && logged b.log 'ok - R8-MSG: client_min_messages = notice antes de rollback'"
check "no deja nada: misma huella y sin barrios" \
  "[ \"\$(fp \"$db\")\" = '$before' ] && [ \"\$(q \"$db\" 'select count(*) from public.neighborhoods')\" = 0 ]"
check "y el preflight congelado de la Fase 3 sigue pasando" \
  "psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d '$(url "$db")' -f '$ROOT/tests/supabase/phase3-baseline-preflight.sql' >/dev/null 2>&1"

echo "== C. apply sobre el esquema de la Fase 3"
clone
db_applied="$db"
before="$(fp "$db_applied")"
check "apply con la confirmación termina bien, en dos pasadas" \
  "upgrade '$ROOT' '$db_applied' apply c.log PHASE4_UPGRADE_CONFIRM='$PHRASE' \
   && logged c.log 'rollback hecho' && logged c.log 'commit hecho' && logged c.log 'apply correcto'"
check "el esquema cambia y tiene los 73 barrios" \
  "[ \"\$(fp \"$db_applied\")\" != '$before' ] && [ \"\$(q \"$db_applied\" 'select count(*) from public.neighborhoods')\" = 73 ]"
check "y pasa el preflight vigente (run-preflight.sh) fuera de la transacción" \
  "SUPABASE_VALIDATION_PROJECT_REF='$REF' SUPABASE_VALIDATION_DB_URL='$(url "$db_applied")' \
   bash '$ROOT/tests/supabase/run-preflight.sh' >'$WORK/c-preflight.log' 2>&1"

echo "== D. segunda aplicación"
after="$(fp "$db_applied")"
upgrade "$ROOT" "$db_applied" apply d.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "se rechaza en el estado de partida (P3 de la Fase 3) y no cambia nada" \
  "logged d.log 'FALLO P3' && logged d.log 'ensayo FALLIDO' && ! logged d.log 'commit hecho' \
   && [ \"\$(fp \"$db_applied\")\" = '$after' ]"

echo "== E. identidad del proyecto"
for marker in roomly-validation-2 ""; do
  clone "$marker"
  before="$(fp "$db")"
  upgrade "$ROOT" "$db" dry_run "e.log" || true
  check "marca '${marker:-(ninguna)}': la guarda la rechaza y no cambia nada" \
    "logged e.log 'NO está reconocido' && ! logged e.log 'transacción abierta' && [ \"\$(fp \"$db\")\" = '$before' ]"
done

echo "== F. esquema de partida inesperado"
unexpected() { # <descripción> <texto esperado> <SQL que lo prepara>
  local before
  clone
  q "$db" "$3" >/dev/null
  before="$(fp "$db")"
  upgrade "$ROOT" "$db" dry_run f.log || true
  check "$1: se rechaza (${2}) y no cambia nada" \
    "logged f.log '$2' && ! logged f.log 'migración ${M1}' && [ \"\$(fp \"$db\")\" = '$before' ]"
}
unexpected "una política de más" "FALLO P3" \
  "create policy zz_inesperada on public.cities for select using (true)"
unexpected "un barrio ya cargado" "FALLO R8-BASE" \
  "insert into public.neighborhoods (city_id, name, slug) select id, 'el Raval', 'el-raval' from public.cities where slug = 'barcelona'"
unexpected "una restricción de la 4.1 ya creada" "restricciones de la Fase 4.1" \
  "alter table public.rooms add constraint chk_rooms_total_rooms check (total_rooms is null or total_rooms >= 1)"
unexpected "una tabla de otro rol" "tablas que no son del rol que conecta" \
  "alter table public.neighborhoods owner to ${OTHER}"
unexpected "un usuario de prueba que quedó" "usuarios de prueba" \
  "insert into auth.users (id, email) values ('99999999-0000-0000-0000-000000000001', 'resto@test')"
clone
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$(url "$db")" -f "$ROOT/supabase/migrations/$M1" >/dev/null
before="$(fp "$db")"
upgrade "$ROOT" "$db" dry_run f-40.log || true
check "la 4.0 ya aplicada: se rechaza (FALLO P3) y no cambia nada" \
  "logged f-40.log 'FALLO P3' && [ \"\$(fp \"$db\")\" = '$before' ]"

echo "== G. SHA-256"
clone
before="$(fp "$db")"
tree="$(tree_copy sha-mig)"
echo "-- cambio" >>"$tree/supabase/migrations/$M3"
upgrade "$tree" "$db" dry_run g1.log || true
check "una migración cambiada se rechaza antes de conectar" \
  "logged g1.log 'SHA-256 de supabase/migrations/${M3} no es el fijado' && ! logged g1.log 'guard:' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"
tree="$(tree_copy sha-base)"
echo "-- cambio" >>"$tree/tests/supabase/phase3-baseline-preflight.sql"
upgrade "$tree" "$db" apply g2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "el preflight congelado cambiado se rechaza antes de conectar" \
  "logged g2.log 'phase3-baseline-preflight.sql no es el fijado' && ! logged g2.log 'guard:' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"
tree="$(tree_copy sha-final)"
echo "-- cambio" >>"$tree/tests/supabase/preflight.sql"
upgrade "$tree" "$db" apply g3.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "el preflight vigente cambiado se rechaza antes de conectar" \
  "logged g3.log 'SHA-256 de tests/supabase/preflight.sql no es el fijado' && ! logged g3.log 'guard:' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"
offline "$tree" apply g4.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "con el psql falso: el preflight vigente cambiado no llega a llamar a psql" \
  "logged g4.log 'tests/supabase/preflight.sql no es el fijado' && ! psql_called"
offline "$WORK/tree-sha-mig" dry_run g5.log || true
check "con el psql falso: la migración cambiada tampoco llega a llamar a psql" \
  "logged g5.log 'supabase/migrations/${M3} no es el fijado' && ! psql_called"
# El flujo se copia y se vuelve a comprobar antes de conectar: un archivo que
# desaparece o cambia justo después de su comprobación no llega a psql.
tree="$(tree_copy toctou-move)"
PATH="$TOCTOU:$PATH" offline "$tree" apply g6.log PHASE4_UPGRADE_CONFIRM="$PHRASE" \
  R8_TOCTOU_FILE="$tree/tests/supabase/preflight.sql" R8_TOCTOU_ACTION=move || true
check "el preflight vigente retirado justo después de su SHA-256: se rechaza sin llamar a psql" \
  "logged g6.log 'no se pudo copiar tests/supabase/preflight.sql' && [ -e '$tree/tests/supabase/preflight.sql.retirado' ] \
   && ! psql_called"
tree="$(tree_copy toctou-append)"
PATH="$TOCTOU:$PATH" offline "$tree" apply g7.log PHASE4_UPGRADE_CONFIRM="$PHRASE" \
  R8_TOCTOU_FILE="$tree/supabase/migrations/$M3" R8_TOCTOU_ACTION=append || true
check "una migración con «commit;» añadido justo después de su SHA-256: se rechaza sin llamar a psql" \
  "logged g7.log 'la copia de supabase/migrations/${M3} no tiene el SHA-256 fijado' \
   && [ \"\$(tail -n 1 '$tree/supabase/migrations/$M3')\" = 'commit;' ] && ! psql_called"
# Con el SHA-256 al día, roomly_sql_transform rechaza el control de
# transacciones y los meta-comandos antes de conectar.
validator_case() { # <log> <archivo del árbol> <texto añadido> <motivo esperado>
  local tree
  tree="$(tree_copy "validator-$1")"
  printf '%b' "$3" >>"$tree/$2"
  repin "$tree" "$2"
  offline "$tree" apply "$1" PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
  check "$2 con $(printf '%b' "$3" | head -n 1) (SHA-256 al día): se rechaza sin llamar a psql" \
    "logged '$1' '$4' && ! logged '$1' 'guard:' && ! psql_called"
}
validator_case g8.log "supabase/migrations/$M3" 'commit;\n' 'no supera roomly_sql_transform'
validator_case g9.log "supabase/migrations/$M2" 'begin;\nselect 1;\nrollback;\n' 'bloque begin;/rollback;'
validator_case g10.log "tests/supabase/preflight.sql" '\\connect postgres\n' 'no supera roomly_sql_transform'
# Un cat que, al juntar varias partes, omite la última sin dar error: el flujo
# incompleto se detecta al comprobarlo byte a byte, antes de conectar.
SHORT_CAT="$WORK/short-cat-bin"
mkdir -p "$SHORT_CAT"
cat >"$SHORT_CAT/cat" <<SHORT
#!/usr/bin/env bash
[ "\$#" -gt 1 ] && set -- "\${@:1:\$((\$# - 1))}"
exec "$(command -v cat)" "\$@"
SHORT
chmod +x "$SHORT_CAT/cat"
PATH="$SHORT_CAT:$PATH" offline "$ROOT" apply g11.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "un cat que omite la última parte sin error: el flujo incompleto se rechaza sin llamar a psql" \
  "logged g11.log 'el cuerpo del flujo no se ha construido completo' && ! psql_called"
# Una línea «commit;» dentro de un cuerpo $$ pasa roomly_sql_transform, pero el
# flujo de cada pasada solo puede tener un ROLLBACK o un COMMIT: el del final.
tree="$(tree_copy inner-commit)"
printf 'do $$\nbegin\ncommit;\nend $$;\n' >>"$tree/supabase/migrations/$M3"
repin "$tree" "supabase/migrations/$M3"
offline "$tree" apply g12.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "un «commit;» dentro de un cuerpo \$\$ (pasa el validador): el flujo se rechaza sin llamar a psql" \
  "logged g12.log 'no termina en un único rollback seguido de su última línea' && ! psql_called"
# Meta-comandos a mitad de línea (psql los ejecuta igual) y $$ pegado a un
# nombre (para psql, parte del identificador): rechazados sin llamar a psql.
validator_case g13.log "supabase/migrations/$M3" 'select 1; \\connect postgres\nselect 2;\n' 'meta-comando de psql no permitido'
validator_case g14.log "tests/supabase/preflight.sql" 'select 1; \\set ON_ERROR_STOP 0\nselect 2;\n' 'meta-comando de psql no permitido'
validator_case g15.log "tests/supabase/phase4-upgrade-baseline.sql" 'select 1; \\! echo r8-selftest;\n' 'meta-comando de psql no permitido'
validator_case g16.log "supabase/migrations/$M2" 'select 1 as x$$;\ncommit;\nselect 2 as y$$;\n' '$$ pegado a un nombre'
# Control: barras invertidas en un comentario, una cadena, un identificador y
# un cuerpo $$ (con el SHA-256 al día) no se rechazan: el script llega a la
# guarda.
tree="$(tree_copy literal-backslashes)"
cat >>"$tree/supabase/migrations/$M3" <<'SQL'
-- comentario con \connect y \set ON_ERROR_STOP 0
select regexp_replace('public.x', '^public\.', '') as sin_esquema, 1 as "con\barra";
do $$ begin perform '\echo dentro de un cuerpo'; end $$;
SQL
repin "$tree" "supabase/migrations/$M3"
offline "$tree" apply g17.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "control: barras invertidas en comentario, cadena, identificador y cuerpo \$\$ se aceptan (llega a la guarda)" \
  "logged g17.log 'flujo construido y comprobado antes de conectar' && psql_called"

echo "== H. error a mitad de la transacción"
tree="$(tree_copy mid-error)"
echo "select 1 / 0;" >>"$tree/supabase/migrations/$M2"
repin "$tree" "supabase/migrations/$M2"
clone
before="$(fp "$db")"
upgrade "$tree" "$db" dry_run h1.log || true
upgrade "$tree" "$db" apply h2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "un error en la segunda migración revierte también la primera (dry_run y apply)" \
  "logged h1.log 'division by zero' && logged h2.log 'division by zero' && ! logged h2.log 'commit hecho' \
   && ! logged h1.log 'migración ${M3}' && [ \"\$(fp \"$db\")\" = '$before' ]"

echo "== I. el preflight vigente falla"
tree="$(tree_copy final-preflight)"
echo "do \$\$ begin raise exception 'FALLO P9: selftest'; end \$\$;" >>"$tree/tests/supabase/preflight.sql"
repin "$tree" "tests/supabase/preflight.sql"
clone
before="$(fp "$db")"
upgrade "$tree" "$db" apply i.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "apply no confirma: las 3 migraciones se aplicaron dentro y se revierten" \
  "logged i.log 'migración ${M3}' && logged i.log 'FALLO P9' && ! logged i.log 'commit hecho' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"

echo "== J. WARNING"
tree="$(tree_copy warning)"
echo "do \$\$ begin raise warning 'r8 selftest'; end \$\$;" >>"$tree/supabase/migrations/$M3"
repin "$tree" "supabase/migrations/$M3"
clone
before="$(fp "$db")"
upgrade "$tree" "$db" dry_run j1.log || true
upgrade "$tree" "$db" apply j2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "un WARNING hace fallar el ensayo, y apply no llega a la pasada con COMMIT" \
  "logged j1.log 'WARNING: r8 selftest' && logged j1.log 'ensayo FALLIDO' \
   && logged j2.log 'ensayo FALLIDO' && ! logged j2.log 'commit hecho' && [ \"\$(fp \"$db\")\" = '$before' ]"
# Con client_min_messages = error en la base de datos, sin el `set local` del
# script el WARNING no llegaría a psql y la pasada parecería limpia.
clone
"${ADMIN[@]}" -c "alter database ${db} set client_min_messages = error" >/dev/null
before="$(fp "$db")"
upgrade "$tree" "$db" dry_run j3.log || true
upgrade "$tree" "$db" apply j4.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "con client_min_messages = error en la base de datos, el WARNING llega igual y apply no confirma" \
  "logged j3.log 'WARNING: r8 selftest' && logged j3.log 'ensayo FALLIDO' \
   && logged j4.log 'WARNING: r8 selftest' && ! logged j4.log 'commit hecho' && [ \"\$(fp \"$db\")\" = '$before' ]"
check "y sin WARNING, el dry_run pasa en esa base de datos, con R8-MSG = notice" \
  "upgrade '$ROOT' '$db' dry_run j5.log && logged j5.log 'ok - R8-MSG: client_min_messages = notice antes de rollback' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"
tree="$(tree_copy hide-warnings)"
echo "set client_min_messages = error;" >>"$tree/supabase/migrations/$M2"
repin "$tree" "supabase/migrations/$M2"
clone
before="$(fp "$db")"
upgrade "$tree" "$db" apply j6.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "una migración que sube client_min_messages se rechaza (FALLO R8-MSG) y apply no confirma" \
  "logged j6.log 'FALLO R8-MSG (antes de rollback): client_min_messages = error' && logged j6.log 'ensayo FALLIDO' \
   && ! logged j6.log 'commit hecho' && [ \"\$(fp \"$db\")\" = '$before' ]"

echo "== L. avisos de éxito esperados"
tree="$(tree_copy no-p6)"
[ "$(grep -c "raise notice 'ok - P6:" "$tree/tests/supabase/preflight.sql")" = 1 ] \
  || { echo "   FALLO: el preflight vigente no tiene exactamente un aviso P6"; exit 1; }
sed -i "s/raise notice 'ok - P6:/raise notice 'P6 sin aviso:/" "$tree/tests/supabase/preflight.sql"
repin "$tree" "tests/supabase/preflight.sql"
clone
before="$(fp "$db")"
upgrade "$tree" "$db" dry_run l1.log || true
upgrade "$tree" "$db" apply l2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "sin el P6 del preflight vigente, la pasada falla aunque psql termine bien, y apply no confirma" \
  "logged l1.log 'rollback hecho' && logged l1.log 'faltan avisos de éxito' && logged l1.log 'ensayo FALLIDO' \
   && ! logged l1.log 'dry_run correcto' && logged l2.log 'ensayo FALLIDO' && ! logged l2.log 'commit hecho' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"

echo "== M. fallo solo en la pasada con COMMIT"
# Ningún caso anterior llega a la segunda pasada. Aquí la primera sale limpia y
# la segunda falla: una secuencia (no se revierte) distingue las pasadas, y un
# trigger diferido corta la propia conexión al ejecutarse el COMMIT. Todo en el
# schema r8_selftest, que los preflights y R8-BASE no miran.
pass2_message() { # <log>: los mensajes de un resultado sin confirmar
  logged "$1" 'rollback hecho' && logged "$1" 'ensayo limpio' && ! logged "$1" 'commit hecho' \
    && logged "$1" 'apply NO CONFIRMADO' && logged "$1" 'incierto' && logged "$1" 'run-preflight.sh' \
    && ! logged "$1" 'nada aplicado' && ! logged "$1" 'se ha revertido' && ! logged "$1" 'apply correcto'
}
tree="$(tree_copy pass2-error)"
echo "do \$\$ begin if nextval('r8_selftest.pass') > 1 then raise exception 'r8 selftest: falla en la segunda pasada'; end if; end \$\$;" \
  >>"$tree/supabase/migrations/$M2"
repin "$tree" "supabase/migrations/$M2"
clone
q "$db" "create schema r8_selftest; create sequence r8_selftest.pass" >/dev/null
before="$(fp "$db")"
upgrade "$tree" "$db" apply m1.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "un error solo en la pasada con COMMIT: NO CONFIRMADO, incierto y preflight antes de repetir" \
  "pass2_message m1.log && logged m1.log 'falla en la segunda pasada' && logged m1.log 'código 3'"
check "(en local se ve que no se aplicó: misma huella)" "[ \"\$(fp \"$db\")\" = '$before' ]"
tree="$(tree_copy commit-drop)"
echo "insert into r8_selftest.commit_drop values (1);" >>"$tree/supabase/migrations/$M3"
repin "$tree" "supabase/migrations/$M3"
clone
q "$db" "create schema r8_selftest;
  create table r8_selftest.commit_drop (x int);
  create function r8_selftest.drop_connection() returns trigger language plpgsql as
    \$\$ begin perform pg_terminate_backend(pg_backend_pid()); return null; end \$\$;
  create constraint trigger commit_drop after insert on r8_selftest.commit_drop
    deferrable initially deferred for each row execute function r8_selftest.drop_connection()" >/dev/null
before="$(fp "$db")"
upgrade "$tree" "$db" apply m2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || true
check "la conexión perdida durante el COMMIT: NO CONFIRMADO, incierto y preflight antes de repetir" \
  "pass2_message m2.log && logged m2.log 'código 2' && ! logged m2.log 'FATAL' && ! logged m2.log 'server closed'"
check "(en local se ve que no se aplicó: misma huella)" "[ \"\$(fp \"$db\")\" = '$before' ]"

echo "== N. el flujo se construye entero antes de conectar"
# Retirar el preflight vigente y la tercera migración después de la pasada de
# ensayo no cambia la pasada con COMMIT: lee el flujo ya construido.
tree="$(tree_copy between-passes)"
clone
before="$(fp "$db")"
check "archivos retirados entre las dos pasadas: apply correcto con el mismo flujo completo" \
  "hooked '$tree' '$db' apply n1.log PHASE4_UPGRADE_CONFIRM='$PHRASE' \
     R8_HOOK_AFTER_ROLLBACK='$tree/tests/supabase/preflight.sql $tree/supabase/migrations/$M3' \
   && [ -e '$tree/tests/supabase/preflight.sql.retirado' ] && [ -e '$tree/supabase/migrations/$M3.retirado' ] \
   && [ \"\$(grep -c 'ok - P6:' '$WORK/n1.log')\" = 4 ] && [ \"\$(grep -c 'migración ${M3}' '$WORK/n1.log')\" = 2 ] \
   && logged n1.log 'commit hecho' && logged n1.log 'apply correcto' \
   && [ \"\$(q \"$db\" 'select count(*) from public.neighborhoods')\" = 73 ]"
# Una entrada cortada justo antes del COMMIT (o del ROLLBACK): psql termina
# bien, pero no llega a la última línea del flujo.
clone
before="$(fp "$db")"
hooked "$ROOT" "$db" apply n2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" R8_HOOK_CUT="commit;" || true
check "entrada cortada antes del COMMIT: NO CONFIRMADO e incierto, nunca NO VÁLIDO ni correcto" \
  "logged n2.log 'rollback hecho' && logged n2.log 'falta «== R8 · commit hecho»' && logged n2.log 'apply NO CONFIRMADO' \
   && logged n2.log 'incierto' && ! logged n2.log 'NO VÁLIDO' && ! logged n2.log 'apply correcto' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"
hooked "$ROOT" "$db" apply n3.log PHASE4_UPGRADE_CONFIRM="$PHRASE" R8_HOOK_CUT="rollback;" || true
check "entrada cortada antes del ROLLBACK: ensayo FALLIDO, sin pasada con COMMIT" \
  "logged n3.log 'falta «== R8 · rollback hecho»' && logged n3.log 'ensayo FALLIDO' && ! logged n3.log 'ensayo limpio' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"

echo "== V. apply NO VÁLIDO: el COMMIT se ejecutó, pero la segunda pasada no vale"
tree="$(tree_copy pass2-warning)"
echo "do \$\$ begin if nextval('r8_selftest.pass') > 1 then raise warning 'r8 selftest: solo en la segunda pasada'; end if; end \$\$;" \
  >>"$tree/supabase/migrations/$M3"
repin "$tree" "supabase/migrations/$M3"
clone
q "$db" "create schema r8_selftest; create sequence r8_selftest.pass" >/dev/null
rc=0
upgrade "$tree" "$db" apply v1.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || rc=$?
check "un WARNING solo en la pasada con COMMIT: NO VÁLIDO, con error, y el COMMIT sí se ejecutó (73 barrios)" \
  "[ $rc -ne 0 ] && logged v1.log 'WARNING: r8 selftest: solo en la segunda pasada' && logged v1.log 'commit hecho' \
   && logged v1.log 'apply NO VÁLIDO' && logged v1.log 'el COMMIT se ejecutó' && ! logged v1.log 'NO CONFIRMADO' \
   && ! logged v1.log 'apply correcto' && [ \"\$(q \"$db\" 'select count(*) from public.neighborhoods')\" = 73 ]"
# Sin WARNING: en la segunda pasada, el preflight vigente corre con los NOTICE
# ocultos y vuelve a notice al final, así que R8-MSG pasa pero falta su P6.
tree="$(tree_copy pass2-missing-notice)"
echo "do \$\$ begin if nextval('r8_selftest.pass') > 1 then perform set_config('client_min_messages', 'warning', true); end if; end \$\$;" \
  >>"$tree/supabase/migrations/$M3"
echo "set local client_min_messages = notice;" >>"$tree/tests/supabase/preflight.sql"
repin "$tree" "supabase/migrations/$M3"
repin "$tree" "tests/supabase/preflight.sql"
clone
q "$db" "create schema r8_selftest; create sequence r8_selftest.pass" >/dev/null
rc=0
upgrade "$tree" "$db" apply v2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" || rc=$?
check "un aviso de éxito que falta solo en la pasada con COMMIT: NO VÁLIDO, con error, y el COMMIT sí se ejecutó" \
  "[ $rc -ne 0 ] && ! logged v2.log 'WARNING: ' && logged v2.log 'faltan avisos de éxito en la pasada (commit)' \
   && logged v2.log 'commit hecho' && logged v2.log 'apply NO VÁLIDO' && ! logged v2.log 'NO CONFIRMADO' \
   && ! logged v2.log 'apply correcto' && [ \"\$(q \"$db\" 'select count(*) from public.neighborhoods')\" = 73 ]"

echo "== S. interrupciones (señal al grupo de procesos)"
sleeping() { echo "select exists (select 1 from pg_stat_activity where datname = '$1' and wait_event = 'PgSleep')"; }
tree="$(tree_copy signal-pass2)"
echo "do \$\$ begin if nextval('r8_selftest.pass') > 1 then perform pg_sleep(30); end if; end \$\$;" \
  >>"$tree/supabase/migrations/$M3"
repin "$tree" "supabase/migrations/$M3"
clone
q "$db" "create schema r8_selftest; create sequence r8_selftest.pass" >/dev/null
before="$(fp "$db")"
rc=0
upgrade_signal "$tree" "$db" apply s1.log INT "$(sleeping "$db")" PHASE4_UPGRADE_CONFIRM="$PHRASE" || rc=$?
check "SIGINT durante la pasada con COMMIT: INTERRUMPIDO e incierto, nunca «nada confirmado»" \
  "[ $rc -eq 130 ] && logged s1.log 'ensayo limpio' && logged s1.log 'apply INTERRUMPIDO (señal INT) durante la pasada con COMMIT' \
   && logged s1.log 'incierto' && logged s1.log 'Recuperación' && ! logged s1.log 'nada confirmado' \
   && ! logged s1.log 'nada aplicado' && ! logged s1.log 'commit hecho'"
check "(en local, cancelada la consulta, no se aplicó: misma huella)" "[ \"\$(fp \"$db\")\" = '$before' ]"
tree="$(tree_copy signal-pass1)"
echo "do \$\$ begin if nextval('r8_selftest.pass') = 1 then perform pg_sleep(30); end if; end \$\$;" \
  >>"$tree/supabase/migrations/$M3"
repin "$tree" "supabase/migrations/$M3"
clone
q "$db" "create schema r8_selftest; create sequence r8_selftest.pass" >/dev/null
before="$(fp "$db")"
rc=0
upgrade_signal "$tree" "$db" apply s2.log TERM "$(sleeping "$db")" PHASE4_UPGRADE_CONFIRM="$PHRASE" || rc=$?
check "SIGTERM durante la pasada de ensayo: INTERRUMPIDO y nada confirmado, sin pasada con COMMIT" \
  "[ $rc -eq 143 ] && logged s2.log 'INTERRUMPIDO (señal TERM) durante la pasada de ensayo (ROLLBACK): nada confirmado' \
   && ! logged s2.log 'ensayo limpio' && ! logged s2.log 'incierto' && [ \"\$(fp \"$db\")\" = '$before' ]"

echo "== O. un ERROR con psql terminado en 0 no vale"
# El psql envoltorio desactiva ON_ERROR_STOP en una pasada e inserta un error
# justo antes de su ROLLBACK o COMMIT: psql sigue, imprime la línea final y
# termina con 0. Sin la comprobación de ERROR, la pasada parecería válida
# aunque el COMMIT sobre la transacción abortada sea en realidad un ROLLBACK.
clone
before="$(fp "$db")"
hooked "$ROOT" "$db" apply o1.log PHASE4_UPGRADE_CONFIRM="$PHRASE" R8_HOOK_PASS=commit \
  R8_HOOK_PREPEND='\set ON_ERROR_STOP 0' R8_HOOK_INSERT_BEFORE='commit;' R8_HOOK_INSERT='select 1 / 0;' || true
check "ERROR en la pasada con COMMIT y psql en 0: NO CONFIRMADO e incierto, nunca correcto ni NO VÁLIDO" \
  "logged o1.log 'ERROR: division by zero' && logged o1.log 'commit hecho' \
   && logged o1.log 'aunque psql terminó con código 0' && logged o1.log 'apply NO CONFIRMADO' && logged o1.log 'incierto' \
   && ! logged o1.log 'NO VÁLIDO' && ! logged o1.log 'apply correcto'"
check "(en local, el COMMIT sobre la transacción abortada no aplicó nada: misma huella)" "[ \"\$(fp \"$db\")\" = '$before' ]"
hooked "$ROOT" "$db" apply o2.log PHASE4_UPGRADE_CONFIRM="$PHRASE" R8_HOOK_PASS=rollback \
  R8_HOOK_PREPEND='\set ON_ERROR_STOP 0' R8_HOOK_INSERT_BEFORE='rollback;' R8_HOOK_INSERT='select 1 / 0;' || true
check "ERROR en la pasada de ensayo y psql en 0: ensayo FALLIDO, sin pasada con COMMIT" \
  "logged o2.log 'ERROR: division by zero' && logged o2.log 'rollback hecho' \
   && logged o2.log 'aunque psql terminó con código 0' && logged o2.log 'ensayo FALLIDO' && ! logged o2.log 'ensayo limpio' \
   && [ \"\$(fp \"$db\")\" = '$before' ]"
# Control: el texto «ERROR:» dentro de un aviso o en el resultado de una
# consulta no es un error del servidor y no hace fallar la pasada.
tree="$(tree_copy error-text)"
cat >>"$tree/supabase/migrations/$M3" <<'SQL'
do $$ begin raise notice 'ERROR:  solo es el texto de un aviso'; end $$;
select 'ERROR:  solo es un valor' as texto;
SQL
repin "$tree" "supabase/migrations/$M3"
clone
check "control: «ERROR:» en un aviso o en un resultado no es un error: apply correcto (73 barrios)" \
  "upgrade '$tree' '$db' apply o3.log PHASE4_UPGRADE_CONFIRM='$PHRASE' && logged o3.log 'solo es el texto de un aviso' \
   && ! logged o3.log 'aunque psql terminó con código 0' && logged o3.log 'apply correcto' \
   && [ \"\$(q \"$db\" 'select count(*) from public.neighborhoods')\" = 73 ]"

echo "== R. cada resultado tiene una sola línea RESULTADO, la suya"
outcome() { # <clase> <log>...
  local class="$1" log
  shift
  for log in "$@"; do [ "$(result_of "$log")" = "$class" ] || return 1; done
}
check "correcto: solo el apply válido (c, n1, o3)" "outcome correcto c.log n1.log o3.log"
check "dry_run correcto (b)" "outcome dry_run_correcto b.log"
check "NO VÁLIDO: COMMIT ejecutado y segunda pasada sin validar (v1, v2)" "outcome no_valido v1.log v2.log"
check "NO CONFIRMADO: incierto tras la pasada con COMMIT (m1, m2, n2, o1)" "outcome no_confirmado m1.log m2.log n2.log o1.log"
check "ensayo FALLIDO: antes de cualquier COMMIT (d, h2, i, j2, j4, j6, l2, n3, o2)" \
  "outcome ensayo_fallido d.log h2.log i.log j2.log j4.log j6.log l2.log n3.log o2.log"
check "NO ejecutada: antes de conectar (a3, g2, g3, g6–g16)" \
  "outcome no_ejecutada a3.log g2.log g3.log g6.log g7.log g8.log g9.log g10.log g11.log g12.log g13.log g14.log g15.log g16.log"
check "INTERRUMPIDO: incierto en la pasada con COMMIT (s1), sin COMMIT en el ensayo (s2)" \
  "outcome interrumpido_incierto s1.log && outcome interrumpido_sin_commit s2.log"

echo "== K. sin secretos en la salida"
# Solo las salidas (*.log): las copias del árbol contienen, como texto, la
# plantilla de cadena de conexión de los selftests.
grep -rlF --include='*.log' -- "$SELFTEST_PW" "$WORK" >"$WORK/leaks.txt" || true
grep -rlF --include='*.log' -- 'postgresql://' "$WORK" >>"$WORK/leaks.txt" || true
check "ninguna salida ($(find "$WORK" -maxdepth 1 -name '*.log' | wc -l) logs) contiene la contraseña ni la cadena de conexión" \
  "[ ! -s '$WORK/leaks.txt' ]"
[ -s "$WORK/leaks.txt" ] && sed 's|^|     en: |' "$WORK/leaks.txt"

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: la herramienta de actualización de la Fase 4 tiene fallos"
  exit 1
fi
echo "RESULTADO: phase4-upgrade.sh: entradas, identidad, estado de partida, SHA-256, transacción única, dry_run sin efectos y apply con preflight antes del COMMIT"
