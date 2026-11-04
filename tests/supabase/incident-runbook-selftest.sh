#!/usr/bin/env bash
# Auto-test LOCAL del runbook docs/INCIDENT_PUBLIC_PROFILE_PREVIEWS.md (sesión
# 73): ejecuta las consultas de tests/supabase/incident-*.sql contra bases de datos
# locales efímeras (shim de Supabase + migraciones). No se conecta a Supabase
# ni a ningún proyecto real. Comprueba:
#   1. la captura (Q0–Q7, Q9, Q10, Q12) funciona sin errores y sin escribir
#      nada (también con default_transaction_read_only = on) en tres esquemas:
#      Fase 1 (roomly-validation), el estado real más avanzado sin el hotfix
#      (roomly-validation-3, hasta 20261016120000) y todas las migraciones;
#   2. detecta la vulnerabilidad (Q1, Q3, V1, V2) antes del hotfix y nada
#      después;
#   3. el paso de contención documentado (psql --single-transaction con el
#      archivo del hotfix) deja V1 y V2 en OK, y repetirlo no cambia nada;
#   4. si otro rol concedió privilegios sobre la vista (Q2), el hotfix aborta
#      sin cambiar nada;
#   5. privilegios: con un rol NO superusuario como el `postgres` de Supabase
#      (BYPASSRLS) todo funciona y shared_preload_libraries sale oculta (y
#      current_setting() daría error); sin BYPASSRLS, Q9a avisa de que los
#      recuentos no valen;
#   6. Q8 (opcional): se omite sin la extensión; con ella instalada y sin
#      precargar, falla sola sin abortar; con un clúster temporal que la
#      precarga, encuentra el UPDATE de anon por la vista, salvo para un rol
#      sin pg_read_all_stats (resultado vacío: por eso lo indica la columna
#      lee_todas_las_consultas);
#   7. Q11: se omite sin las columnas de Supabase y, con ellas, encuentra la
#      cuenta sin perfil.
# Conexión: variables estándar de libpq con un usuario que pueda crear bases de
# datos y roles (como tests/db/run.sh). Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INC="$ROOT/tests/supabase/incident"
HOTFIX="$ROOT/supabase/migrations/20261014120000_public_profile_previews_write_lockdown.sql"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
SUFFIX="$$"
DB_F1="incident_f1_${SUFFIX}"
DB_BEFORE="incident_before_${SUFFIX}"
DB_AFTER="incident_after_${SUFFIX}"
DB_GRANTOR="incident_grantor_${SUFFIX}"
READER="roomly_rb_reader_${SUFFIX}"
NORLS="roomly_rb_norls_${SUFFIX}"
GRANTOR="roomly_rb_grantor_${SUFFIX}"
WORK="$(mktemp -d)"
TMP_CLUSTER=""
# Estados de partida que imitan a los proyectos reales (sin el hotfix):
#   - roomly-validation (Fase 1): hasta 20260926120000;
#   - roomly-validation-3, el que más migraciones tiene: hasta 20261016120000
#     (Fase 3 + 4.0 y 4.1 con R8, run 21). Las migraciones posteriores (4.2–4.4)
#     no están en ningún proyecto real; 20261031120100 ya retira la escritura
#     de la vista, así que «todas menos el hotfix» no sería un estado real.
UPTO_PHASE1="20260926999999"
UPTO_REAL="20261016999999"

cleanup() {
  if [ -n "$TMP_CLUSTER" ]; then
    "$PG_BIN/pg_ctl" -D "$TMP_CLUSTER" -m immediate stop >/dev/null 2>&1 || true
  fi
  for db in "$DB_F1" "$DB_BEFORE" "$DB_AFTER" "$DB_GRANTOR"; do
    "${ADMIN[@]}" -c "drop database if exists ${db}" >/dev/null 2>&1 || true
  done
  for role in "$READER" "$NORLS" "$GRANTOR"; do
    "${ADMIN[@]}" -c "drop role if exists ${role}" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

failed=0
check() {
  local label="$1"; shift
  if "$@"; then echo "   ok - ${label}"; else echo "   FALLO: ${label}"; failed=1; fi
}
# run <bd> <archivo> [rol]: ejecuta un archivo del runbook (salida sin
# alinear, separador |), opcionalmente con SET ROLE previo vía PGOPTIONS.
run() {
  local db="$1" file="$2" role="${3:-}" opts="-c default_transaction_read_only=on"
  if [ -n "$role" ]; then opts="$opts -c role=${role}"; fi
  PGOPTIONS="$opts" psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d "$db" -f "$file"
}
sq() { psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d "$1" -c "$2"; }

# build <bd> <migraciones que se OMITEN (regex sobre el nombre) | ""> [última migración incluida]
build() {
  local db="$1" skip="$2" upto="${3:-}"
  "${ADMIN[@]}" -c "create database ${db}" >/dev/null
  local P=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$db")
  "${P[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    local name; name="$(basename "$migration")"
    if [ -n "$skip" ] && [[ "$name" =~ $skip ]]; then continue; fi
    if [ -n "$upto" ] && [[ "$name" > "$upto" ]]; then continue; fi
    "${P[@]}" -f "$migration" >/dev/null
  done
  "${P[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
  # Datos de prueba: dos usuarios, un admin y una cuenta de Auth sin perfil.
  "${P[@]}" >/dev/null <<'SQL'
insert into auth.users (id, email) values
  ('73000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('73000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('73000000-0000-0000-0000-00000000000c', 'c@test.local'),
  ('73000000-0000-0000-0000-0000000000dd', 'sin-perfil@test.local');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('73000000-0000-0000-0000-00000000000a', 'Runbook A', '2001-01-01', 'flexible', 'user'),
  ('73000000-0000-0000-0000-00000000000b', 'Runbook B', '2001-01-01', 'flexible', 'user'),
  ('73000000-0000-0000-0000-00000000000c', 'Runbook C', '2001-01-01', 'flexible', 'admin');
SQL
}

"${ADMIN[@]}" >/dev/null <<SQL
create role ${READER} nologin nosuperuser bypassrls;
grant pg_read_all_data to ${READER};
create role ${NORLS} nologin nosuperuser;
grant pg_read_all_data to ${NORLS};
create role ${GRANTOR} nologin nosuperuser;
SQL

echo "== 1. la captura funciona y no escribe (Fase 1, sin hotfix, con hotfix)"
build "$DB_F1" "" "$UPTO_PHASE1"
build "$DB_BEFORE" "^20261014120000_" "$UPTO_REAL"
build "$DB_AFTER" ""
for db in "$DB_F1" "$DB_BEFORE" "$DB_AFTER"; do
  sq "$db" "select count(*) || ' ' || sum(n_tup_ins + n_tup_upd + n_tup_del) from pg_stat_user_tables" >"$WORK/writes.before"
  check "capture.sql sin errores en ${db%_${SUFFIX}} (superusuario, transacción de solo lectura)" \
    sh -c "PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d '$db' -f '$INC-capture.sql' >'$WORK/capture.$db' 2>&1"
  check "verify-after.sql sin errores en ${db%_${SUFFIX}}" \
    sh -c "PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d '$db' -f '$INC-verify-after.sql' >'$WORK/verify.$db' 2>&1"
done
check "los archivos de lectura no contienen DML ni DDL (fuera de comentarios y literales)" \
  sh -c "! sed \"s/--.*//; s/'[^']*'//g\" '$INC-capture.sql' '$INC-verify-after.sql' '$INC-optional-pg-stat-statements.sql' '$INC-optional-auth-users.sql' | grep -qiE '\\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|comment|vacuum|analyze|copy|do)\\b[^_]'"

echo "== 2. detección antes y después del hotfix"
check "Fase 1: Q1 la vista existe, sin hotfix y actualizable (28)" \
  grep -q "^public_profile_previews|postgres|{security_invoker=false}|28|f|$" "$WORK/capture.$DB_F1"
check "Fase 1: Q3 anon puede UPDATE y authenticated DELETE (vulnerable)" \
  sh -c "grep -q '^anon|UPDATE|t|t$' '$WORK/capture.$DB_F1' && grep -q '^authenticated|DELETE|t|$' '$WORK/capture.$DB_F1'"
check "Fase 1: V1 y V2 dicen FALLO" \
  sh -c "grep -q '^FALLO: V1 la vista sigue dando privilegios' '$WORK/verify.$DB_F1' && grep -q '^FALLO: V2' '$WORK/verify.$DB_F1'"
check "sin hotfix: Q3 PUBLIC no tiene nada, anon y authenticated escriben (vulnerable)" \
  sh -c "grep -q '^public|UPDATE|f|f$' '$WORK/capture.$DB_BEFORE' && grep -q '^anon|INSERT|t|t$' '$WORK/capture.$DB_BEFORE' && grep -q '^authenticated|UPDATE|t|t$' '$WORK/capture.$DB_BEFORE'"
check "sin hotfix: V1 y V2 dicen FALLO" \
  sh -c "grep -q '^FALLO: V1' '$WORK/verify.$DB_BEFORE' && grep -q '^FALLO: V2' '$WORK/verify.$DB_BEFORE'"
check "con hotfix: Q1 hotfix_aplicado = t; Q3 nada para public, anon ni authenticated" \
  sh -c "grep -q '^public_profile_previews|postgres|{security_invoker=false}|28|t|' '$WORK/capture.$DB_AFTER' && ! grep -qE '^(public|anon|authenticated)\\|[A-Z]+\\|(t|f)\\|t$|^(public|anon|authenticated)\\|[A-Z]+\\|t\\|' '$WORK/capture.$DB_AFTER'"
check "con hotfix: service_role conserva sus privilegios (Q3)" \
  grep -q "^service_role|UPDATE|t|t$" "$WORK/capture.$DB_AFTER"
check "con hotfix: V1 y V2 dicen OK" \
  sh -c "grep -q '^OK: V1' '$WORK/verify.$DB_AFTER' && grep -q '^OK: V2' '$WORK/verify.$DB_AFTER'"

echo "== 3. contención: el archivo del hotfix con --single-transaction"
check "aplicar el hotfix a la base sin él (estado de roomly-validation-3, hasta 20261016120000)" \
  sh -c "psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc --single-transaction -d '$DB_BEFORE' -f '$HOTFIX' >/dev/null 2>&1"
check "después, V1 y V2 dicen OK" \
  sh -c "run_out=\$(PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At --no-psqlrc -d '$DB_BEFORE' -f '$INC-verify-after.sql'); echo \"\$run_out\" | grep -q '^OK: V1' && echo \"\$run_out\" | grep -q '^OK: V2'"
check "aplicar el hotfix a la base de la Fase 1 también la deja en OK" \
  sh -c "psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc --single-transaction -d '$DB_F1' -f '$HOTFIX' >/dev/null 2>&1 && PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At --no-psqlrc -d '$DB_F1' -f '$INC-verify-after.sql' | grep -q '^OK: V1'"
sq "$DB_BEFORE" "select relacl::text || coalesce(obj_description(oid, 'pg_class'), '') from pg_class where oid = 'public.public_profile_previews'::regclass" >"$WORK/acl.once"
check "repetirlo no falla y no cambia nada" \
  sh -c "psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc --single-transaction -d '$DB_BEFORE' -f '$HOTFIX' >/dev/null 2>&1"
sq "$DB_BEFORE" "select relacl::text || coalesce(obj_description(oid, 'pg_class'), '') from pg_class where oid = 'public.public_profile_previews'::regclass" >"$WORK/acl.twice"
check "(ACL y comentario idénticos)" cmp -s "$WORK/acl.once" "$WORK/acl.twice"

echo "== 4. otro concedente: el hotfix aborta sin cambiar nada"
build "$DB_GRANTOR" "^20261014120000_" "$UPTO_REAL"
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_GRANTOR" >/dev/null <<SQL
grant all on public.public_profile_previews to ${GRANTOR} with grant option;
set role ${GRANTOR};
grant update on public.public_profile_previews to anon;
reset role;
SQL
run "$DB_GRANTOR" "$INC-capture.sql" >"$WORK/capture.grantor"
check "Q2 muestra la concesión de UPDATE a anon hecha por el otro rol" \
  grep -q "^anon|${GRANTOR}|UPDATE|f$" "$WORK/capture.grantor"
sq "$DB_GRANTOR" "select relacl::text from pg_class where oid = 'public.public_profile_previews'::regclass" >"$WORK/grantor.before"
if psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc --single-transaction -d "$DB_GRANTOR" -f "$HOTFIX" >"$WORK/grantor.out" 2>&1; then
  echo "   FALLO: el hotfix se aplicó aunque otro rol mantiene un privilegio de anon"
  failed=1
else
  sq "$DB_GRANTOR" "select relacl::text from pg_class where oid = 'public.public_profile_previews'::regclass" >"$WORK/grantor.after"
  check "el hotfix aborta (su comprobación final) y la ACL no cambia" \
    sh -c "grep -q 'ERROR' '$WORK/grantor.out' && cmp -s '$WORK/grantor.before' '$WORK/grantor.after'"
fi

echo "== 5. privilegios que necesita cada consulta"
check "capture.sql como rol NO superusuario con BYPASSRLS (como postgres en Supabase)" \
  sh -c "PGOPTIONS='-c default_transaction_read_only=on -c role=${READER}' psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d '$DB_AFTER' -f '$INC-capture.sql' >'$WORK/capture.reader' 2>&1"
check "  Q7: shared_preload_libraries oculta para ese rol (sin error)" \
  grep -q "^shared_preload_libraries||t$" "$WORK/capture.reader"
check "  current_setting('shared_preload_libraries') sí daría error para ese rol" \
  sh -c "! PGOPTIONS='-c role=${READER}' psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d '$DB_AFTER' -c \"select current_setting('shared_preload_libraries')\" >/dev/null 2>&1"
check "  Q9a: ve todas las filas; Q9 cuenta lo mismo que el superusuario" \
  sh -c "grep -q '^${READER}|t$' '$WORK/capture.reader' && grep -q '^admin|f|1$' '$WORK/capture.reader' && grep -q '^user|f|2$' '$WORK/capture.reader' && grep -q '^admin|f|1$' '$WORK/capture.$DB_AFTER'"
check "capture.sql como rol sin BYPASSRLS: funciona, pero Q9a avisa (f) y la RLS vacía Q9" \
  sh -c "PGOPTIONS='-c default_transaction_read_only=on -c role=${NORLS}' psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d '$DB_AFTER' -f '$INC-capture.sql' >'$WORK/capture.norls' 2>&1 && grep -q '^${NORLS}|f$' '$WORK/capture.norls' && ! grep -q '^admin|f|1$' '$WORK/capture.norls'"
check "  Q3 y Q5 (catálogo, incluido PUBLIC) dan lo mismo con cualquier rol" \
  sh -c "grep -E '^(public|anon|authenticated|service_role)\\|[A-Z]+\\|' '$WORK/capture.$DB_AFTER' >'$WORK/q3.su'; grep -E '^(public|anon|authenticated|service_role)\\|[A-Z]+\\|' '$WORK/capture.norls' >'$WORK/q3.norls'; test -s '$WORK/q3.su' && cmp -s '$WORK/q3.su' '$WORK/q3.norls'"

echo "== 6. Q8 (opcional): pg_stat_statements"
check "sin la extensión: se omite y termina bien" \
  sh -c "run_out=\$(psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d '$DB_AFTER' -f '$INC-optional-pg-stat-statements.sql' 2>&1) && echo \"\$run_out\" | grep -q 'Q8 omitida'"
if sq "$DB_AFTER" "select 1 from pg_available_extensions where name = 'pg_stat_statements'" | grep -q 1; then
  sq "$DB_AFTER" "create schema if not exists extensions; create extension pg_stat_statements schema extensions" >/dev/null
  preload="$(sq "$DB_AFTER" "select setting from pg_settings where name = 'shared_preload_libraries'")"
  if [[ "$preload" != *pg_stat_statements* ]]; then
    check "instalada pero sin precargar: Q8b falla sola, el archivo termina bien" \
      sh -c "run_out=\$(psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d '$DB_AFTER' -f '$INC-optional-pg-stat-statements.sql' 2>&1) && echo \"\$run_out\" | grep -q 'instalada=t esquema=extensions' && echo \"\$run_out\" | grep -q 'shared_preload_libraries'"
  fi
  sq "$DB_AFTER" "drop extension pg_stat_statements; drop schema extensions" >/dev/null
else
  echo "   omitido - pg_stat_statements no está disponible en este PostgreSQL"
fi

PG_BIN="$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1 || true)")"
if [ "$(id -u)" -ne 0 ] && [ -x "$PG_BIN/initdb" ] && [ -x "$PG_BIN/pg_ctl" ] \
    && [ -f "$("$PG_BIN/pg_config" --sharedir 2>/dev/null)/extension/pg_stat_statements.control" ]; then
  TMP_CLUSTER="$WORK/cluster"
  SOCK="$WORK/sock"; mkdir -p "$SOCK"
  PORT=$((55000 + SUFFIX % 1000))
  if ! "$PG_BIN/initdb" -D "$TMP_CLUSTER" -U postgres --auth=trust >/dev/null 2>&1 \
      || ! "$PG_BIN/pg_ctl" -D "$TMP_CLUSTER" -l "$WORK/cluster.log" -w \
        -o "-p $PORT -k $SOCK -c listen_addresses='' -c shared_preload_libraries=pg_stat_statements" start >/dev/null 2>&1; then
    echo "   omitido - no se pudo arrancar el clúster temporal (entorno); Q8 precargada sin probar aquí"
    PRELOAD_OK=0
  else
    PRELOAD_OK=1
  fi
fi
if [ "${PRELOAD_OK:-0}" -eq 1 ]; then
  T=(env PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres PGPASSWORD=)
  "${T[@]}" psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres -c "create database pss" >/dev/null
  "${T[@]}" psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d pss -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    [[ "$(basename "$migration")" == 20261014120000_* ]] && continue
    [[ "$(basename "$migration")" > "$UPTO_REAL" ]] && continue
    "${T[@]}" psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d pss -f "$migration" >/dev/null
  done
  "${T[@]}" psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d pss >/dev/null <<SQL
create schema extensions;
create extension pg_stat_statements schema extensions;
insert into auth.users (id, email) values ('73000000-0000-0000-0000-00000000000a', 'a@test.local');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role)
  values ('73000000-0000-0000-0000-00000000000a', 'Runbook A', '2001-01-01', 'flexible', 'user');
create role ${READER} nologin nosuperuser bypassrls;
grant pg_read_all_data to ${READER};
SQL
  # El ataque: anon cambia un nombre por la vista (proyecto sin hotfix).
  "${T[@]}" psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d pss \
    -c "set role anon" \
    -c "update public.public_profile_previews set full_name = 'Cambiado' where id = '73000000-0000-0000-0000-00000000000a'" >/dev/null
  "${T[@]}" psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d pss \
    -f "$INC-optional-pg-stat-statements.sql" >"$WORK/q8.su" 2>&1 || true
  check "precargada (clúster temporal): Q8 encuentra el UPDATE de anon por la vista" \
    grep -qi "^anon|1|1|update public.public_profile_previews" "$WORK/q8.su"
  check "  y muestra desde cuándo acumula (pg_stat_statements_info)" \
    grep -qE "^[0-9]{4}-[0-9]{2}-[0-9]{2} " "$WORK/q8.su"
  "${T[@]}" env PGOPTIONS="-c role=${READER}" psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d pss \
    -f "$INC-optional-pg-stat-statements.sql" >"$WORK/q8.reader" 2>&1 || true
  check "  un rol sin pg_read_all_stats NO lo ve (resultado vacío) y la precomprobación lo avisa" \
    sh -c "grep -q 'lee_todas_las_consultas=f' '$WORK/q8.reader' && ! grep -qi '^anon|' '$WORK/q8.reader'"
  "${T[@]}" psql -X -q --no-psqlrc -d pss -c "grant pg_read_all_stats to ${READER}" >/dev/null
  "${T[@]}" env PGOPTIONS="-c role=${READER}" psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d pss \
    -f "$INC-optional-pg-stat-statements.sql" >"$WORK/q8.reader2" 2>&1 || true
  check "  con pg_read_all_stats, sí" \
    sh -c "grep -q 'lee_todas_las_consultas=t' '$WORK/q8.reader2' && grep -qi '^anon|1|1|update public.public_profile_previews' '$WORK/q8.reader2'"
elif [ -z "${PRELOAD_OK:-}" ]; then
  echo "   omitido - sin initdb utilizable (o como root): no se prueba Q8 con la extensión precargada"
fi

echo "== 7. Q11: cuentas de Auth sin perfil"
check "sin las columnas de Supabase: se omite y termina bien" \
  sh -c "run_out=\$(psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d '$DB_AFTER' -f '$INC-optional-auth-users.sql' 2>&1) && echo \"\$run_out\" | grep -q 'Q11 omitida'"
sq "$DB_AFTER" "alter table auth.users add column created_at timestamptz not null default now(), add column last_sign_in_at timestamptz" >/dev/null
check "con ellas (como en Supabase): encuentra solo la cuenta sin perfil" \
  sh -c "run_out=\$(PGOPTIONS='-c role=${READER}' psql -X -q -At -F '|' -v ON_ERROR_STOP=1 --no-psqlrc -d '$DB_AFTER' -f '$INC-optional-auth-users.sql' 2>&1) && echo \"\$run_out\" | grep -q '^73000000-0000-0000-0000-0000000000dd|' && echo \"\$run_out\" | grep -qx '1'"

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: el runbook del incidente NO se comporta como dice"
  exit 1
fi
echo "RESULTADO: runbook del incidente: lectura sin escrituras, detección antes y después, contención y opcionales comprobados en local"
