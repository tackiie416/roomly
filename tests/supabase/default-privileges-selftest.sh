#!/usr/bin/env bash
# Auto-test LOCAL de la PROPUESTA tests/supabase/default-privileges-proposal.sql
# (sesión 73). No es una migración y nada la aplica en un proyecto real. Contra
# un PostgreSQL local con el shim de Supabase comprueba:
#   A. aplicada DESPUÉS de las migraciones (como lo sería una migración nueva):
#      - ningún objeto existente cambia de privilegios (instantánea completa);
#      - los privilegios por defecto de OTRO rol creador no cambian;
#      - lo que crea `postgres` después (tabla, vista, secuencia, función) no
#        da nada a PUBLIC, anon ni authenticated; service_role conserva lo
#        suyo; un GRANT explícito sigue funcionando;
#      - lo que crea el otro rol sigue recibiendo sus privilegios por defecto;
#      - aplicarla otra vez no cambia nada;
#      - la suite tests/db completa pasa encima sin ningún ajuste: los helpers
#        (roomly_test) ya conceden EXECUTE explícito (tests/db/helpers.sql) y no
#        dependen del EXECUTE de PUBLIC; se comprueba;
#   B. precondiciones: cualquier estado distinto del esperado (entrada global,
#      destinatario de más, revocación parcial, sin service_role, otro rol)
#      aborta sin cambiar nada;
#   C. instalación limpia con la propuesta DELANTE de las migraciones: lista
#      los privilegios que hoy solo existen gracias a los privilegios por
#      defecto (dependencias implícitas). Comprueba que la lista no está vacía:
#      por eso la propuesta solo vale aplicada después de las migraciones
#      existentes, y cada objeto nuevo necesitará GRANT explícito.
#
# Conexión: variables estándar de libpq con un usuario que pueda crear bases de
# datos y roles (igual que tests/db/run.sh). Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROPOSAL="$ROOT/tests/supabase/default-privileges-proposal.sql"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
DB="defprivs_after_$$"
DB_FIRST="defprivs_first_$$"
DB_PLAIN="defprivs_plain_$$"
OTHER="roomly_dp_other_$$"
WORK="$(mktemp -d)"

cleanup() {
  for db in "$DB" "$DB_FIRST" "$DB_PLAIN"; do
    "${ADMIN[@]}" -c "drop database if exists ${db}" >/dev/null 2>&1 || true
  done
  "${ADMIN[@]}" -c "drop role if exists ${OTHER}" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

failed=0
check() {
  local label="$1"; shift
  if "$@"; then echo "   ok - ${label}"; else echo "   FALLO: ${label}"; failed=1; fi
}
q() { psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d "$1" -c "$2"; }

# build <bd> [sql que se aplica entre el shim y las migraciones]
build() {
  local db="$1" before="${2:-}"
  "${ADMIN[@]}" -c "create database ${db}" >/dev/null
  local P=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$db")
  "${P[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
  if [ -n "$before" ]; then "${P[@]}" -f "$before" >/dev/null 2>&1; fi
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    "${P[@]}" -f "$migration" >/dev/null
  done
  "${P[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
}

# Privilegios de TODOS los objetos propios (relaciones, columnas, funciones,
# secuencias) de public y auth, sin los privilegios por defecto.
SNAPSHOT_SQL="
select 'rel ' || n.nspname || '.' || c.relname || ' ' || coalesce(c.relacl::text, '(default)')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'auth') and c.relkind in ('r', 'v', 'm', 'S', 'p')
union all
select 'col ' || c.relname || '.' || a.attname || ' ' || a.attacl::text
from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'auth') and a.attnum > 0 and not a.attisdropped and a.attacl is not null
union all
select 'fn ' || p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, '(default)')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'auth')
order by 1;"

DEFACL_SQL="
select pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '(global)') || ' '
       || d.defaclobjtype::text || ' ' || d.defaclacl::text
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
order by 1;"

echo "== A. aplicada después de las migraciones"
build "$DB"
P=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB")
"${ADMIN[@]}" -c "create role ${OTHER} nologin" >/dev/null
"${P[@]}" -c "grant create, usage on schema public to ${OTHER}" \
  -c "grant select on public.cities to ${OTHER}" \
  -c "alter default privileges for role ${OTHER} in schema public grant all on tables to anon, authenticated" >/dev/null
q "$DB" "$SNAPSHOT_SQL" >"$WORK/objects.before"
q "$DB" "$DEFACL_SQL" | grep "^${OTHER} " >"$WORK/other.before"

"${P[@]}" -f "$PROPOSAL" >"$WORK/apply.out" 2>&1 || true
check "la propuesta se aplica (estado de partida esperado)" grep -q "default_privileges_hardening: aplicada" "$WORK/apply.out"
q "$DB" "$SNAPSHOT_SQL" >"$WORK/objects.after"
check "ningún objeto existente cambia de privilegios ($(wc -l <"$WORK/objects.before") entradas)" \
  cmp -s "$WORK/objects.before" "$WORK/objects.after"
q "$DB" "$DEFACL_SQL" | grep "^${OTHER} " >"$WORK/other.after"
check "los privilegios por defecto de otro rol creador no cambian" cmp -s "$WORK/other.before" "$WORK/other.after"
check "postgres: sin anon ni authenticated en public y sin EXECUTE global de PUBLIC" \
  test "$(q "$DB" "$DEFACL_SQL" | grep '^postgres ' | tr '\n' ';')" = \
  "postgres (global) f {postgres=X/postgres};postgres public S {service_role=rwU/postgres};postgres public f {service_role=X/postgres};postgres public r {service_role=arwdDxt/postgres};"

PROBE="begin;
create table public.zz_dp_table (id int primary key);
create view public.zz_dp_view with (security_invoker = true) as select id from public.zz_dp_table;
create sequence public.zz_dp_seq;
create function public.zz_dp_fn() returns int language sql set search_path = '' as 'select 1';
select string_agg(r || ':' || o, ' ' order by r, o) from (
  select r, 'table' o from unnest(array['public','anon','authenticated']) r where has_table_privilege(r, 'public.zz_dp_table', 'SELECT') or has_table_privilege(r, 'public.zz_dp_table', 'UPDATE')
  union all select r, 'view' from unnest(array['public','anon','authenticated']) r where has_table_privilege(r, 'public.zz_dp_view', 'SELECT') or has_table_privilege(r, 'public.zz_dp_view', 'INSERT')
  union all select r, 'seq' from unnest(array['public','anon','authenticated']) r where has_sequence_privilege(r, 'public.zz_dp_seq', 'USAGE')
  union all select r, 'fn' from unnest(array['public','anon','authenticated']) r where has_function_privilege(r, 'public.zz_dp_fn()', 'EXECUTE')
) x;
select has_table_privilege('service_role', 'public.zz_dp_table', 'UPDATE')
   and has_table_privilege('service_role', 'public.zz_dp_view', 'SELECT')
   and has_sequence_privilege('service_role', 'public.zz_dp_seq', 'USAGE')
   and has_function_privilege('service_role', 'public.zz_dp_fn()', 'EXECUTE');
grant select on public.zz_dp_table to authenticated;
grant execute on function public.zz_dp_fn() to authenticated;
select has_table_privilege('authenticated', 'public.zz_dp_table', 'SELECT')
   and not has_table_privilege('authenticated', 'public.zz_dp_table', 'UPDATE')
   and has_function_privilege('authenticated', 'public.zz_dp_fn()', 'EXECUTE');
set role ${OTHER};
create view public.zz_dp_other_view as select id from public.cities;
reset role;
select has_table_privilege('anon', 'public.zz_dp_other_view', 'SELECT');
rollback;"
mapfile -t probe < <(psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB" <<<"$PROBE")
check "objetos nuevos de postgres (tabla, vista, secuencia, función): nada para PUBLIC, anon ni authenticated" test -z "${probe[0]}"
check "service_role conserva sus privilegios en los objetos nuevos" test "${probe[1]}" = "t"
check "un GRANT explícito sigue funcionando (y solo da lo concedido)" test "${probe[2]}" = "t"
check "lo que crea otro rol sigue recibiendo SUS privilegios por defecto (no se tocan)" test "${probe[3]}" = "t"

q "$DB" "$DEFACL_SQL" >"$WORK/defacl.once"
"${P[@]}" -f "$PROPOSAL" >"$WORK/apply2.out" 2>&1 || true
q "$DB" "$DEFACL_SQL" >"$WORK/defacl.twice"
check "aplicarla otra vez no cambia nada (ya aplicada)" \
  sh -c "grep -q 'ya aplicada' '$WORK/apply2.out' && cmp -s '$WORK/defacl.once' '$WORK/defacl.twice'"

# La suite tests/db encima. Los helpers (schema roomly_test) son funciones de
# postgres y, con la propuesta, ya no reciben el EXECUTE global de PUBLIC:
# helpers.sql los concede de forma explícita a anon, authenticated y
# service_role, y aquí se comprueba que eso basta (sin ningún GRANT añadido).
"${P[@]}" -f "$ROOT/tests/db/helpers.sql" >/dev/null
check "los helpers de roomly_test no dependen del EXECUTE de PUBLIC (helpers.sql lo concede explícito)" \
  test "$(q "$DB" "select has_function_privilege('public', 'roomly_test.ok(boolean, text)', 'EXECUTE')::text || ' ' || has_function_privilege('anon', 'roomly_test.ok(boolean, text)', 'EXECUTE')::text")" = "false true"
suite_failed=0
for test_file in "$ROOT"/tests/db/[0-9]*.sql; do
  if ! "${P[@]}" -f "$test_file" >"$WORK/suite.out" 2>&1; then
    echo "      tests/db/$(basename "$test_file") falla con la propuesta aplicada:"
    grep -E "ERROR|FALLO" "$WORK/suite.out" | head -2 | sed 's/^/        /'
    suite_failed=1
  fi
done
check "la suite tests/db completa ($(ls "$ROOT"/tests/db/[0-9]*.sql | wc -l) archivos) pasa con la propuesta aplicada, sin ajustes" test "$suite_failed" -eq 0

echo "== B. precondiciones: cualquier otro estado aborta sin cambiar nada"
build "$DB_PLAIN"
while IFS='|' read -r label sql; do
  [ -z "$label" ] && continue
  q "$DB_PLAIN" "$DEFACL_SQL" >"$WORK/pre.before"
  if { echo "begin;"; printf '%s\n' "$sql"; cat "$PROPOSAL"; echo "commit;"; } \
      | psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_PLAIN" >"$WORK/pre.out" 2>&1; then
    echo "   FALLO: ${label}: la propuesta se aplicó"
    failed=1
  elif grep -qE "no son los esperados|hay que ejecutarla como postgres" "$WORK/pre.out" \
      && q "$DB_PLAIN" "$DEFACL_SQL" | cmp -s - "$WORK/pre.before"; then
    echo "   ok - ${label}: aborta y no cambia nada"
  else
    echo "   FALLO: ${label}: no abortó por la precondición"
    grep -E "ERROR" "$WORK/pre.out" | head -2
    failed=1
  fi
done <<CASES
una entrada global de postgres (un REVOKE por esquema no la quitaría)|alter default privileges for role postgres grant select on tables to anon;
un destinatario de más en public|alter default privileges for role postgres in schema public grant select on tables to ${OTHER};
una revocación parcial previa (solo secuencias)|alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
service_role sin sus privilegios por defecto|alter default privileges for role postgres in schema public revoke all on tables from service_role;
ejecutada por otro rol|set role ${OTHER};
CASES

echo "== C. instalación limpia con la propuesta delante: dependencias implícitas"
build "$DB_FIRST" "$PROPOSAL"
q "$DB_PLAIN" "$SNAPSHOT_SQL" >"$WORK/plain.snapshot"
q "$DB_FIRST" "$SNAPSHOT_SQL" >"$WORK/first.snapshot"
diff "$WORK/plain.snapshot" "$WORK/first.snapshot" | grep '^<' | sed 's/^< //' >"$WORK/implicit" || true
echo "   privilegios que hoy solo dan los privilegios por defecto ($(wc -l <"$WORK/implicit") objetos):"
sed 's/^/      /' "$WORK/implicit"
check "hay dependencias implícitas: la propuesta solo vale DESPUÉS de las migraciones existentes" test -s "$WORK/implicit"
check "entre ellas, el SELECT de authenticated en profiles (sin GRANT explícito en las migraciones)" \
  grep -q "^rel public.profiles .*authenticated=" "$WORK/implicit"

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: la propuesta de privilegios por defecto NO cumple lo esperado"
  exit 1
fi
echo "RESULTADO: propuesta de privilegios por defecto: solo objetos nuevos de postgres, segura ante estados inesperados, sin cambiar objetos existentes ni otros roles"
