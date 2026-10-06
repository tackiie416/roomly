#!/usr/bin/env bash
# Auto-test del runner SQL remoto (Fase 2.8) contra un PostgreSQL LOCAL
# (nunca contra Supabase). Simula el proyecto de validación con el usuario de
# pooler postgres.<ref> y la marca exacta, y comprueba:
#   A. run-sql-suite.sh completo (con guard.sh) pasa los 13 archivos, con las
#      mismas aserciones que tests/db/run.sh, y no deja restos.
#   B. El ROLLBACK propio de un test deshace solo su bloque: lo anterior del
#      mismo archivo y roomly_test siguen vivos, y los demás archivos no se
#      ven afectados.
#   C. Un test que deja rol, request.jwt.claims u otro GUC puestos no los
#      pasa al siguiente (y en una sola sesión, como antes, sí pasaban).
#   D. Control de transacciones inesperado → aborta ANTES de conectar; el
#      contenido legítimo (comentarios, cadenas, plpgsql) se acepta.
#   D2. Identificadores "..." y cadenas E'...' no desincronizan el análisis
#      (regresión de la auditoría final de 2.8: `select 1 as "it's";` ocultaba
#      un COMMIT posterior); los identificadores legítimos se aceptan.
#   E. WARNING → la suite falla.
#   F. Un test que falla a mitad no deja nada.
#   G. Mutación: el test 11 sin la reescritura a SAVEPOINT rompe la suite.
#   H. Identidad: la marca antigua roomly-validation no pasa (guard.sh ni la
#      P0 de cada sesión).
#
# Conexión: variables estándar de libpq con un usuario que pueda crear roles
# y bases de datos (igual que tests/db/run.sh). Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
HOST="${PGHOST:-localhost}"
# Los roles simulados postgres.<ref> entran por TCP; si PGHOST es un socket
# (p. ej. /var/run/postgresql), se usa 127.0.0.1.
case "$HOST" in /*) HOST=127.0.0.1 ;; esac
# Contraseña aleatoria de los roles temporales: nunca se escribe en ningún
# archivo ni se imprime, y los roles se borran al terminar.
SELFTEST_PW="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
PORT="${PGPORT:-5432}"
REF="cccccccccccccccccccc"
DB="sqlsuite_selftest_$$"
ROLE="postgres.${REF}"
WORK="$(mktemp -d)"

MARKER="$(sed -n 's/^ROOMLY_VALIDATION_MARKER="\(.*\)"$/\1/p' "$ROOT/tests/supabase/guard.sh")"
export ROOMLY_VALIDATION_MARKER="$MARKER"
# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"

cleanup() {
  "${ADMIN[@]}" -c "drop database if exists ${DB}" -c "drop role if exists \"${ROLE}\"" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup
WORK="$(mktemp -d)"

"${ADMIN[@]}" -c "create role \"${ROLE}\" login superuser password '${SELFTEST_PW}'" \
  -c "create database ${DB} owner \"${ROLE}\"" \
  -c "comment on database ${DB} is '${MARKER}'" >/dev/null
DB_URL="postgresql://${ROLE}:${SELFTEST_PW}@${HOST}:${PORT}/${DB}"
export PGSSLMODE=disable
Q=(psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_URL")

"${Q[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${Q[@]}" -f "$migration" >/dev/null
done
"${Q[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null

failed=0
ok() { echo "   ok - $1"; }
ko() { echo "   FALLO: $1"; failed=1; }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }
suite() { roomly_sql_run_suite "$DB_URL" "$@" >"$WORK/last.log" 2>&1; }
leftovers() {
  "${Q[@]}" -c "select (select count(*) from auth.users where email like '%@test')
    + (select count(*) from pg_namespace where nspname = 'roomly_test')
    + (select count(*) from pg_policies where policyname like 'zz_test%')"
}

echo "== A. run-sql-suite.sh completo (guard.sh + 01–13)"
export SUPABASE_VALIDATION_PROJECT_REF="$REF" SUPABASE_VALIDATION_URL="https://${REF}.supabase.co" \
  SUPABASE_VALIDATION_DB_URL="$DB_URL"
if bash "$ROOT/tests/supabase/run-sql-suite.sh" >"$WORK/full.log" 2>&1; then
  ok "la suite completa pasa"
else
  ko "la suite completa falla"
  sed -n '1,400p' "$WORK/full.log"
fi
check "se ejecutan los 13 archivos, cada uno en su sesión" \
  '[ "$(grep -c "^== [0-9][0-9]_" "$WORK/full.log")" -eq 13 ]'
check "13 comprobaciones de aislamiento tras ROLLBACK" \
  '[ "$(grep -c "ok - aislamiento: ROLLBACK completo" "$WORK/full.log")" -eq 13 ]'
check "comprobación final de restos superada" 'grep -q "ok - tras la suite" "$WORK/full.log"'
check "ningún WARNING" '! grep -q "WARNING" "$WORK/full.log"'
remote_asserts="$(grep -c "^   ok - " "$WORK/full.log" || true)"
remote_asserts=$((remote_asserts - 14))
local_asserts="$(bash "$ROOT/tests/db/run.sh" 2>&1 | grep -c "^   ok - " || true)"
check "mismas aserciones que tests/db/run.sh (${remote_asserts} = ${local_asserts})" \
  '[ "$remote_asserts" -eq "$local_asserts" ] && [ "$remote_asserts" -gt 0 ]'
check "11 recorre sus dos bloques y OWN4" \
  '[ "$(grep -c "ok - OWN" "$WORK/full.log")" -ge 10 ] && grep -q "OWN4: housing_preferences sigue con sus 4 políticas" "$WORK/full.log"'
check "sin restos: usuarios @test, roomly_test, políticas zz_test" '[ "$(leftovers)" = "0" ]'
check "siguen las 37 políticas" \
  '[ "$("${Q[@]}" -c "select count(*) from pg_policies where schemaname = '"'"'public'"'"'")" = "37" ]'
if bash "$ROOT/tests/supabase/run-preflight.sh" >"$WORK/preflight.log" 2>&1; then
  ok "preflight completo sigue pasando después de la suite"
else
  ko "preflight falla después de la suite"
  cat "$WORK/preflight.log"
fi

echo "== B. el ROLLBACK de un test solo deshace su bloque"
cat >"$WORK/b1.sql" <<'SQL'
insert into auth.users (id, email) values ('e0000000-0000-0000-0000-00000000000a', 'b-antes@test');
begin;
insert into auth.users (id, email) values ('e0000000-0000-0000-0000-00000000000b', 'b-dentro@test');
set role authenticated;
select roomly_test.login('e0000000-0000-0000-0000-00000000000b');
rollback;
select roomly_test.ok(current_user = session_user, 'B: el rol puesto dentro del bloque se deshace');
select roomly_test.ok(coalesce(current_setting('request.jwt.claims', true), '') in ('', '{}'),
  'B: los claims puestos dentro del bloque se deshacen');
select roomly_test.ok(exists (select 1 from auth.users where email = 'b-antes@test'),
  'B: lo insertado antes del bloque sigue (la transacción del runner no se cerró)');
select roomly_test.ok(not exists (select 1 from auth.users where email = 'b-dentro@test'),
  'B: lo insertado dentro del bloque se deshizo');
select roomly_test.ok(to_regnamespace('roomly_test') is not null, 'B: roomly_test sigue vivo');
SQL
cat >"$WORK/b2.sql" <<'SQL'
select roomly_test.ok(not exists (select 1 from auth.users where email like 'b-%@test'),
  'B: el archivo siguiente no ve nada del anterior');
SQL
if suite "$WORK/b1.sql" "$WORK/b2.sql"; then ok "B pasa"; else ko "B falla"; cat "$WORK/last.log"; fi
check "B: las 6 aserciones se ejecutaron" '[ "$(grep -c "ok - B:" "$WORK/last.log")" -eq 6 ]'
check "B: sin restos" '[ "$(leftovers)" = "0" ]'

echo "== C. ningún rol ni GUC pasa de un test al siguiente"
cat >"$WORK/c1.sql" <<'SQL'
set role authenticated;
select roomly_test.login('e0000000-0000-0000-0000-0000000000c1');
select set_config('roomly.leak', 'si', false);
SQL
cat >"$WORK/c2.sql" <<'SQL'
select roomly_test.ok(current_user = session_user, 'C: el test siguiente empieza con el rol de la sesión');
select roomly_test.ok(coalesce(current_setting('request.jwt.claims', true), '') in ('', '{}'),
  'C: el test siguiente empieza sin request.jwt.claims');
select roomly_test.ok(coalesce(current_setting('roomly.leak', true), '') = '',
  'C: el test siguiente no hereda otros GUC');
SQL
if suite "$WORK/c1.sql" "$WORK/c2.sql"; then ok "C pasa"; else ko "C falla"; cat "$WORK/last.log"; fi
check "C: las 3 aserciones se ejecutaron" '[ "$(grep -c "ok - C:" "$WORK/last.log")" -eq 3 ]'
# Control: en una sola sesión (el diseño anterior) el rol sí se heredaba.
{
  echo "begin;"
  cat "$ROOT/tests/db/helpers.sql" "$WORK/c1.sql" "$WORK/c2.sql"
  echo "rollback;"
} | psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_URL" >"$WORK/single.log" 2>&1 && single=pass || single=fail
check "C-control: en una sola sesión c2 falla (la comprobación detecta la fuga)" '[ "$single" = "fail" ]'

echo "== D. control de transacciones inesperado → aborta antes de conectar"
UNREACHABLE="postgresql://${ROLE}:${SELFTEST_PW}@${HOST}:1/${DB}"
d=0
while IFS= read -r stmt; do
  d=$((d + 1))
  printf 'select 1;\n%b\nselect 2;\n' "$stmt" >"$WORK/d$d.sql"
  if roomly_sql_run_suite "$UNREACHABLE" "$WORK/d$d.sql" >"$WORK/d.log" 2>&1; then
    ko "D: '$stmt' fue aceptado"
  elif grep -q "no supera la validación" "$WORK/d.log"; then
    ok "D: rechazado antes de conectar: $(printf '%b' "$stmt" | head -1)"
  else
    ko "D: '$stmt' falló, pero no en la validación"
    cat "$WORK/d.log"
  fi
done <<'CASES'
commit;
end;
abort;
start transaction;
begin transaction;
BEGIN;
Begin;
  begin;  select 1;
savepoint x;
release x;
rollback to x;
rollback to savepoint roomly_file;
prepare transaction 'x';
commit prepared 'x';
select 1; commit;
select 1;commit;
begin;
rollback;
begin;\nbegin;\nrollback;\nrollback;
\\c postgres
\\connect postgres
\\! echo x
\\i otro.sql
set session authorization default;
reset session authorization;
set transaction isolation level serializable;
select $t$x$t$;
/* commit; */ select 1;
select 'sin cerrar;
select $$ sin cerrar;
CASES
printf 'select 1;\nselect 3\n' >"$WORK/d-final.sql"
if roomly_sql_run_suite "$UNREACHABLE" "$WORK/d-final.sql" >"$WORK/d.log" 2>&1; then
  ko "D: una sentencia final sin ; fue aceptada"
elif grep -q "no supera la validación" "$WORK/d.log"; then
  ok "D: rechazado antes de conectar: sentencia final sin ;"
else
  ko "D: sentencia final sin ; falló, pero no en la validación"
fi
# Falsos positivos: lo que los tests legítimos contienen no se rechaza.
cat >"$WORK/d-ok.sql" <<'SQL'
-- comentario con commit; rollback; begin; dentro
select 'commit; end; begin;' as texto;
do $$
begin
  perform 1;
end $$;
select roomly_test.ok(true, 'D-ok: begin/end de plpgsql, cadenas y comentarios no cuentan');
SQL
if suite "$WORK/d-ok.sql"; then ok "D-ok: contenido legítimo aceptado"; else ko "D-ok: falso positivo"; cat "$WORK/last.log"; fi

echo "== D2. identificadores \"...\" y cadenas E'...' no ocultan controles"
# <descripción>|<contenido con \n>: todos deben rechazarse antes de conectar.
while IFS='|' read -r label body; do
  [ -z "$label" ] && continue
  printf '%b\n' "$body" >"$WORK/d2.sql"
  if roomly_sql_run_suite "$UNREACHABLE" "$WORK/d2.sql" >"$WORK/d.log" 2>&1; then
    ko "D2: aceptado (bug de análisis): $label"
  elif grep -q "no supera la validación" "$WORK/d.log"; then
    ok "D2: rechazado antes de conectar: $label"
  else
    ko "D2: $label falló, pero no en la validación"
  fi
done <<'CASES'
caso exacto de la auditoría: "it's" + COMMIT + "z'"|select 1 as "it's";\ncommit;\nselect 1 as "z'";
"it's" + ROLLBACK suelto|select 1 as "it's";\nrollback;\nselect 1 as "z'";
"it's" + BEGIN sin cerrar|select 1 as "it's";\nbegin;\nselect 1 as "z'";
"it's" + SAVEPOINT|select 1 as "it's";\nsavepoint x;\nselect 1 as "z'";
"it's" + RELEASE|select 1 as "it's";\nrelease x;\nselect 1 as "z'";
"it's" + START TRANSACTION|select 1 as "it's";\nstart transaction;\nselect 1 as "z'";
"it's" + meta-comando|select 1 as "it's";\n\\c postgres\nselect 1 as "z'";
"" escapada con ' + COMMIT|select 1 as "a""b'";\ncommit;\nselect 1 as "c'";
identificador con -- + COMMIT en la misma línea|select 1 as "x--"; commit;
identificador con $$ + COMMIT|select 1 as "x$$";\ncommit;\nselect 1 as "y$$";
identificador sin cerrar|select 1 as "abierto;\nselect 2;
cadena E'...' simple|select E'x';
cadena e'...' en minúscula|select e'x';
cadena E con \' que ocultaría un COMMIT|select E'a\\';\ncommit;\nselect E'b\\';
cadena E tras un paréntesis|select (E'x');
cadena E tras una coma|select 1,E'x';
CASES
# Identificadores y cadenas legítimos: se aceptan y se ejecutan.
cat >"$WORK/d2-ok.sql" <<'SQL'
select 1 as "it's", 2 as "a--b", 3 as "x$$y", 4 as "dq""q'", 'cadena "con" comillas' as texto;
select 'e' as e, 'type' as tipo, 'E' as "E";
select roomly_test.ok(true, 'D2-ok: identificadores con comillas, guiones y $$ aceptados');
SQL
if suite "$WORK/d2-ok.sql"; then ok "D2-ok: identificadores legítimos aceptados y ejecutados"; else ko "D2-ok: falso positivo"; cat "$WORK/last.log"; fi

echo "== E. WARNING → la suite falla"
cat >"$WORK/e.sql" <<'SQL'
do $$ begin raise warning 'aviso de prueba'; end $$;
SQL
if suite "$WORK/e.sql"; then ko "E: un WARNING no hizo fallar la suite"; else ok "E: WARNING → fallo"; fi
check "E: el WARNING se muestra" 'grep -q "WARNING: aviso de prueba" "$WORK/last.log"'

echo "== F. un test que falla a mitad no deja nada"
cat >"$WORK/f.sql" <<'SQL'
insert into auth.users (id, email) values ('e0000000-0000-0000-0000-0000000000f1', 'f-resto@test');
select roomly_test.ok(false, 'F: fallo deliberado');
SQL
if suite "$WORK/f.sql"; then ko "F: el fallo no se detectó"; else ok "F: el fallo se detecta"; fi
check "F: el usuario insertado antes del fallo no persiste" '[ "$(leftovers)" = "0" ]'

echo "== G. mutación: 11 sin reescritura rompe la suite"
{
  echo "begin;"
  cat "$ROOT/tests/db/helpers.sql" "$ROOT/tests/db/11_housing_preferences_ownership.sql"
  echo "rollback;"
} | psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_URL" >"$WORK/g.log" 2>&1 && raw=pass || raw=fail
check "G: 11 en crudo dentro de la transacción del runner falla" '[ "$raw" = "fail" ]'
check "G: y avisa de la transacción anidada (WARNING que antes se ocultaba)" \
  'grep -q "WARNING:  there is already a transaction in progress" "$WORK/g.log"'
check "G: sin restos tras la mutación" '[ "$(leftovers)" = "0" ]'

echo "== H. identidad: la marca antigua no pasa"
"${ADMIN[@]}" -c "comment on database ${DB} is 'roomly-validation'" >/dev/null
if bash "$ROOT/tests/supabase/run-sql-suite.sh" >"$WORK/h.log" 2>&1; then
  ko "H: la suite corrió contra la marca antigua"
else
  ok "H: run-sql-suite.sh aborta con la marca roomly-validation"
fi
if suite "$ROOT/tests/db/01_profiles_role.sql"; then
  ko "H: la P0 de sesión aceptó la marca antigua"
else
  check "H: la P0 dentro de cada sesión aborta con la marca antigua" \
    'grep -q "NO está reconocido como ${MARKER}" "$WORK/last.log"'
fi
check "H: sin restos" '[ "$(leftovers)" = "0" ]'

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: el runner SQL tiene fallos"
  exit 1
fi
echo "RESULTADO: runner SQL aislado por archivo, sin restos y con fallo cerrado"
