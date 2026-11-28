#!/usr/bin/env bash
# Auto-test de las herramientas de staging (sesión 88) contra un PostgreSQL
# LOCAL, nunca contra Supabase. Simula proyectos con el usuario postgres.<ref>
# (como tests/supabase/guard-selftest.sh) y comprueba que:
#   - la guarda rechaza: variables que faltan, STAGING_CONFIRM distinto, ref
#     inválido o prohibido (uwxb… y DEPLOY_FORBIDDEN_SUPABASE_REFS), URL de
#     otro proyecto, base de datos sin marca, con una marca de validación o
#     con otra; y solo acepta la marca exacta roomly-staging;
#   - la guarda de VALIDACIÓN rechaza la marca roomly-staging (los proyectos
#     no se mezclan);
#   - apply-migrations.sh en dry run no deja nada; con --apply instala todo;
#     se niega a reinstalar;
#   - preflight.sh pasa P0–P6 sobre la instalación limpia;
#   - seed-demo.sh carga solo datos ficticios, es idempotente, y --cleanup
#     los borra sin tocar nada más.
# Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
HOST="${PGHOST:-localhost}"
case "$HOST" in /*) HOST=127.0.0.1 ;; esac
PORT="${PGPORT:-5432}"
PW="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
STG_REF="ssssssssssssssssssss"
VAL_REF="vvvvvvvvvvvvvvvvvvvv"
OLD_REF="uwxbaaaaaaaaaaaaaaaa"
SUFFIX="$$"
STG_DB="stg_ok_${SUFFIX}"
VAL_DB="stg_val_${SUFFIX}"
OLD_DB="stg_old_${SUFFIX}"

cleanup() {
  "${ADMIN[@]}" -c "drop database if exists ${STG_DB}" -c "drop database if exists ${VAL_DB}" \
    -c "drop database if exists ${OLD_DB}" \
    -c "drop role if exists \"postgres.${STG_REF}\"" -c "drop role if exists \"postgres.${VAL_REF}\"" \
    -c "drop role if exists \"postgres.${OLD_REF}\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
for ref in "$STG_REF" "$VAL_REF" "$OLD_REF"; do
  "${ADMIN[@]}" -c "create role \"postgres.${ref}\" login superuser password '${PW}'" >/dev/null
done
"${ADMIN[@]}" -c "create database ${STG_DB} owner \"postgres.${STG_REF}\"" \
  -c "create database ${VAL_DB} owner \"postgres.${VAL_REF}\"" \
  -c "create database ${OLD_DB} owner \"postgres.${OLD_REF}\"" \
  -c "comment on database ${VAL_DB} is 'roomly-validation-4'" \
  -c "comment on database ${OLD_DB} is 'roomly-staging'" >/dev/null
# Antes de marcarla: la base de staging sin marca.
db_url() { echo "postgresql://postgres.$1:${PW}@${HOST}:${PORT}/$2"; }
export PGSSLMODE=disable

failed=0
expect() {
  local want="$1" label="$2"
  shift 2
  local got
  if "$@" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then
    echo "   ok - ${label}"
  else
    echo "   FALLO - ${label} (esperado ${want}, obtenido ${got})"
    failed=1
  fi
}
with() { env -u STAGING_PROJECT_REF -u STAGING_DB_URL -u STAGING_CONFIRM -u STAGING_SUPABASE_URL \
  -u DEPLOY_FORBIDDEN_SUPABASE_REFS "$@"; }

echo "== guarda de staging"
STG_URL="$(db_url "$STG_REF" "$STG_DB")"
expect fail "sin variables" with bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "sin STAGING_CONFIRM" with STAGING_PROJECT_REF="$STG_REF" STAGING_DB_URL="$STG_URL" \
  bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "STAGING_CONFIRM distinto" with STAGING_PROJECT_REF="$STG_REF" STAGING_DB_URL="$STG_URL" \
  STAGING_CONFIRM="roomly-validation-4" bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "ref inválido" with STAGING_PROJECT_REF="corto" STAGING_DB_URL="$STG_URL" \
  STAGING_CONFIRM=roomly-staging bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "URL de la BD de otro proyecto" with STAGING_PROJECT_REF="$STG_REF" \
  STAGING_DB_URL="$(db_url "$VAL_REF" "$VAL_DB")" STAGING_CONFIRM=roomly-staging \
  bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "STAGING_SUPABASE_URL de otro proyecto" with STAGING_PROJECT_REF="$STG_REF" \
  STAGING_DB_URL="$STG_URL" STAGING_SUPABASE_URL="https://${VAL_REF}.supabase.co" \
  STAGING_CONFIRM=roomly-staging bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "base de datos sin marca" with STAGING_PROJECT_REF="$STG_REF" STAGING_DB_URL="$STG_URL" \
  STAGING_CONFIRM=roomly-staging bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "proyecto con marca de validación" with STAGING_PROJECT_REF="$VAL_REF" \
  STAGING_DB_URL="$(db_url "$VAL_REF" "$VAL_DB")" STAGING_CONFIRM=roomly-staging \
  bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "ref uwxb… prohibido aunque lleve la marca" with STAGING_PROJECT_REF="$OLD_REF" \
  STAGING_DB_URL="$(db_url "$OLD_REF" "$OLD_DB")" STAGING_CONFIRM=roomly-staging \
  bash -c "source $ROOT/scripts/staging/guard.sh"
"${ADMIN[@]}" -c "comment on database ${STG_DB} is 'roomly-staging-2'" >/dev/null
expect fail "marca parecida pero no exacta" with STAGING_PROJECT_REF="$STG_REF" STAGING_DB_URL="$STG_URL" \
  STAGING_CONFIRM=roomly-staging bash -c "source $ROOT/scripts/staging/guard.sh"
"${ADMIN[@]}" -c "comment on database ${STG_DB} is 'roomly-staging'" >/dev/null
export STAGING_PROJECT_REF="$STG_REF" STAGING_DB_URL="$STG_URL" STAGING_CONFIRM=roomly-staging
expect fail "ref en DEPLOY_FORBIDDEN_SUPABASE_REFS" env DEPLOY_FORBIDDEN_SUPABASE_REFS="otro, ssss" \
  bash -c "source $ROOT/scripts/staging/guard.sh"
expect pass "control: staging con la marca exacta" bash -c "source $ROOT/scripts/staging/guard.sh"
expect fail "la guarda de validación rechaza roomly-staging" env SUPABASE_VALIDATION_PROJECT_REF="$STG_REF" \
  SUPABASE_VALIDATION_DB_URL="$STG_URL" SUPABASE_VALIDATION_MARKER=roomly-staging \
  bash -c "source $ROOT/tests/supabase/guard.sh"

PSQL_STG=(psql -X -q -At -v ON_ERROR_STOP=1 --no-psqlrc -d "$STG_URL")
# El shim de Supabase (auth, storage, roles) hace de proyecto recién creado.
"${PSQL_STG[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1 || true

echo "== migraciones"
expect pass "dry run" bash "$ROOT/scripts/staging/apply-migrations.sh"
expect pass "el dry run no deja nada" test "$("${PSQL_STG[@]}" -c "select to_regclass('public.profiles') is null")" = t
expect fail "un argumento desconocido aborta" bash "$ROOT/scripts/staging/apply-migrations.sh" --yes
expect fail "otro proyecto: aborta antes de conectar a nada" env STAGING_DB_URL="$(db_url "$VAL_REF" "$VAL_DB")" \
  bash "$ROOT/scripts/staging/apply-migrations.sh" --apply
expect pass "la base de validación sigue vacía" test \
  "$(psql -X -q -At --no-psqlrc -d "$(db_url "$VAL_REF" "$VAL_DB")" -c "select count(*) from pg_tables where schemaname = 'public'")" = 0
expect pass "--apply instala todo" bash "$ROOT/scripts/staging/apply-migrations.sh" --apply
expect pass "las migraciones y el seed están" test \
  "$("${PSQL_STG[@]}" -c "select count(*) > 0 from public.cities where slug = 'barcelona'")" = t
expect fail "no reinstala sobre un esquema existente" bash "$ROOT/scripts/staging/apply-migrations.sh" --apply

echo "== preflight"
expect pass "P0–P6 en la instalación limpia" bash "$ROOT/scripts/staging/preflight.sh"

echo "== datos ficticios"
expect pass "seed-demo" bash "$ROOT/scripts/staging/seed-demo.sh"
expect pass "seed-demo es idempotente" bash "$ROOT/scripts/staging/seed-demo.sh"
expect pass "4 perfiles y 3 habitaciones activas, todo ficticio" test "$("${PSQL_STG[@]}" -c "
  select (select count(*) from public.profiles) = 4
     and (select count(*) from public.profiles where id::text not like 'de0000de-%') = 0
     and (select count(*) from auth.users where email not like '%@roomly.invalid') = 0
     and (select count(*) from public.rooms where status = 'active' and id::text like 'de0000de-%') = 3")" = t
"${PSQL_STG[@]}" -c "insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'otra@test')" >/dev/null
expect pass "--cleanup" bash "$ROOT/scripts/staging/seed-demo.sh" --cleanup
expect pass "--cleanup borra solo lo ficticio" test "$("${PSQL_STG[@]}" -c "
  select (select count(*) from public.profiles) = 0
     and (select count(*) from public.rooms) = 0
     and (select count(*) from auth.users) = 1")" = t
expect pass "preflight sigue en verde tras limpiar" bash "$ROOT/scripts/staging/preflight.sh"

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: staging-selftest FALLIDO" >&2
  exit 1
fi
echo "RESULTADO: herramientas de staging verificadas en local"
