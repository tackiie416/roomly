#!/usr/bin/env bash
# Auto-test de la guarda F1 contra un PostgreSQL LOCAL (nunca contra Supabase).
#
# Simula dos "proyectos" con el usuario de pooler postgres.<ref> y comprueba
# que la guarda y cada punto de entrada abortan salvo en el proyecto que lleva
# la marca exacta 'roomly-validation':
#   1. proyecto ficticio (inexistente / ref inválido)
#   2. URL de otro proyecto
#   3. secrets coherentes pero de otro proyecto (sin marca)
#   4. proyecto con una marca incorrecta o ausente
# y el caso positivo. También verifica que P0, la suite SQL y la aplicación
# de migraciones abortan ANTES de hacer nada sin la marca.
#
# Conexión: variables estándar de libpq con un usuario que pueda crear roles
# y bases de datos (igual que tests/db/run.sh). Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"

VAL_REF="aaaaaaaaaaaaaaaaaaaa"   # "roomly-validation" simulado
OTHER_REF="bbbbbbbbbbbbbbbbbbbb" # otro proyecto (p. ej. producción)
SUFFIX="$$"
VAL_DB="guard_val_${SUFFIX}"
OTHER_DB="guard_other_${SUFFIX}"

cleanup() {
  "${ADMIN[@]}" -c "drop database if exists ${VAL_DB}" -c "drop database if exists ${OTHER_DB}" \
    -c "drop role if exists \"postgres.${VAL_REF}\"" -c "drop role if exists \"postgres.${OTHER_REF}\"" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

"${ADMIN[@]}" \
  -c "create role \"postgres.${VAL_REF}\" login superuser" \
  -c "create role \"postgres.${OTHER_REF}\" login superuser" \
  -c "create database ${VAL_DB} owner \"postgres.${VAL_REF}\"" \
  -c "create database ${OTHER_DB} owner \"postgres.${OTHER_REF}\"" \
  -c "comment on database ${VAL_DB} is 'roomly-validation'" >/dev/null

db_url() { echo "postgresql://postgres.$1:unused@${HOST}:${PORT}/$2"; }

failed=0
# expect <pass|fail> <descripción> <comando...> (con las variables ya exportadas)
expect() {
  local want="$1" label="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then
    echo "   ok - ${label} (${got})"
  else
    echo "   FALLO: ${label} (esperado ${want}, obtenido ${got})"
    failed=1
  fi
}

run_guard() { bash "$ROOT/tests/supabase/guard.sh"; }
set_target() { # <ref> <url> <db_url>
  export SUPABASE_VALIDATION_PROJECT_REF="$1" SUPABASE_VALIDATION_URL="$2" SUPABASE_VALIDATION_DB_URL="$3"
}
export PGSSLMODE=disable

echo "== guard.sh"
set_target "$VAL_REF" "https://${VAL_REF}.supabase.co" "$(db_url "$VAL_REF" "$VAL_DB")"
expect pass "positivo: proyecto con la marca exacta" run_guard

set_target "$VAL_REF" "https://${VAL_REF}.supabase.co" "postgresql://postgres.${VAL_REF}:unused@${HOST}:1/${VAL_DB}"
expect fail "1a: proyecto ficticio (destino inexistente)" run_guard
set_target "no-es-un-ref" "https://no-es-un-ref.supabase.co" "$(db_url "$VAL_REF" "$VAL_DB")"
expect fail "1b: proyecto ficticio (ref inválido)" run_guard

set_target "$VAL_REF" "https://${OTHER_REF}.supabase.co" "$(db_url "$VAL_REF" "$VAL_DB")"
expect fail "2: URL de otro proyecto" run_guard

set_target "$OTHER_REF" "https://${OTHER_REF}.supabase.co" "$(db_url "$OTHER_REF" "$OTHER_DB")"
expect fail "3: secrets coherentes de otro proyecto (sin marca)" run_guard

for bad in "roomly-validation " "Roomly-Validation" "roomly-validation-old" "produccion"; do
  "${ADMIN[@]}" -c "comment on database ${OTHER_DB} is '${bad}'" >/dev/null
  expect fail "4: marca incorrecta '${bad}'" run_guard
done
"${ADMIN[@]}" -c "comment on database ${OTHER_DB} is null" >/dev/null
expect fail "4: marca ausente" run_guard

env -u SUPABASE_VALIDATION_DB_URL bash -c "bash '$ROOT/tests/supabase/guard.sh'" >/dev/null 2>&1 \
  && { echo "   FALLO: sin DB_URL la guarda pasó"; failed=1; } || echo "   ok - sin SUPABASE_VALIDATION_DB_URL (fail)"

echo "== puntos de entrada contra el proyecto SIN marca"
set_target "$OTHER_REF" "https://${OTHER_REF}.supabase.co" "$(db_url "$OTHER_REF" "$OTHER_DB")"
expect fail "apply-migrations aborta" bash "$ROOT/tests/supabase/apply-migrations.sh"
if [ "$(psql -X -At --no-psqlrc -d "$(db_url "$OTHER_REF" "$OTHER_DB")" -c "select to_regclass('public.profiles') is null")" = "t" ]; then
  echo "   ok - apply-migrations no creó nada en el proyecto sin marca"
else
  echo "   FALLO: apply-migrations llegó a crear el esquema"
  failed=1
fi
expect fail "run-preflight aborta" bash "$ROOT/tests/supabase/run-preflight.sh"
expect fail "run-sql-suite aborta" bash "$ROOT/tests/supabase/run-sql-suite.sh"
expect fail "preflight.sql (P0) aborta aunque se ejecute sin la guarda" \
  psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$(db_url "$OTHER_REF" "$OTHER_DB")" -f "$ROOT/tests/supabase/preflight.sql"

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: la guarda F1 tiene fallos"
  exit 1
fi
echo "RESULTADO: la guarda F1 rechaza todo destino que no sea roomly-validation"
