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
#   G. un archivo con otro SHA-256 se rechaza antes de conectar;
#   H. un error a mitad (en la segunda migración) revierte todo;
#   I. si el preflight vigente falla, apply no confirma nada;
#   J. un WARNING hace fallar el ensayo y apply no llega a confirmar;
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
  sed -i -E "s|${name} [0-9a-f]{64}\"|${name} ${new}\"|" "$tree/tests/supabase/phase4-upgrade.sh"
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

echo "== B. dry_run sobre el esquema de la Fase 3"
clone
before="$(fp "$db")"
check "dry_run termina bien" "upgrade '$ROOT' '$db' dry_run b.log"
check "dentro de la transacción: preflight de la Fase 3, R8-BASE, las 3 migraciones y P0–P6 vigentes" \
  "logged b.log 'ok - R8-BASE' && logged b.log 'migración ${M3}' && [ \"\$(grep -c 'ok - P6:' '$WORK/b.log')\" = 2 ] \
   && logged b.log 'rollback hecho' && logged b.log 'dry_run correcto'"
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
