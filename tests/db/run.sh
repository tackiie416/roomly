#!/usr/bin/env bash
# Tests de seguridad/RLS contra un PostgreSQL local (sin Supabase real).
#
# Crea una base de datos temporal, aplica el shim de Supabase, TODAS las
# migraciones de supabase/migrations en orden, el seed, y ejecuta cada
# tests/db/[0-9]*.sql. Cualquier aserción fallida corta con exit != 0.
#
# Conexión: variables estándar de libpq (PGHOST, PGPORT, PGUSER,
# PGPASSWORD). El usuario debe poder crear bases de datos y roles.
#   Ejemplo local:  PGHOST=/var/run/postgresql PGUSER=postgres npm run test:db
#   En CI: servicio postgres:16 (ver .github/workflows/ci.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="roomly_rls_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

cleanup() { "${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${PSQL[@]}" -d postgres -c "create database ${DB}" >/dev/null

echo "== Preparando ${DB}"
"${PSQL[@]}" -d "$DB" -f "$ROOT/tests/db/supabase_shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "   migración: $(basename "$migration")"
  "${PSQL[@]}" -d "$DB" -f "$migration"
done
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$ROOT/tests/db/helpers.sql"

failed=0
for test_file in "$ROOT"/tests/db/[0-9]*.sql; do
  name="$(basename "$test_file")"
  echo "== ${name}"
  # pipefail: si psql falla (aserción o error SQL), el pipeline falla.
  if ! "${PSQL[@]}" -d "$DB" -f "$test_file" 2>&1 \
    | sed -n 's/^psql:[^:]*:[0-9]*: //; s/^NOTICE:  /   /p; s/^ERROR:  /   ERROR: /p'; then
    failed=1
    echo "   >> ${name} FALLÓ"
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: hay tests de seguridad fallidos"
  exit 1
fi
echo "RESULTADO: todos los tests de seguridad pasan"
