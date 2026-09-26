#!/usr/bin/env bash
# Ejecuta la suite SQL de tests/db (C1, C2, C3, H5, M2) contra el Supabase de
# VALIDACIÓN, con los roles, auth.uid() y dueños REALES de Supabase (sin shim).
#
# Todo va dentro de BEGIN ... ROLLBACK: los usuarios de prueba insertados en
# auth.users, los datos y el schema auxiliar roomly_test no persisten.
#
# Requiere SUPABASE_VALIDATION_DB_URL y SUPABASE_VALIDATION_PROJECT_REF.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tests/supabase/guard.sh
source "$ROOT/tests/supabase/guard.sh" SUPABASE_VALIDATION_DB_URL
export PGSSLMODE="${PGSSLMODE:-require}"

{
  echo "begin;"
  cat "$ROOT/tests/db/helpers.sql"
  for test_file in "$ROOT"/tests/db/[0-9]*.sql; do
    printf "\\\\echo '== %s'\n" "$(basename "$test_file")"
    cat "$test_file"
  done
  echo "rollback;"
} | psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$SUPABASE_VALIDATION_DB_URL" 2>&1 \
  | sed -n 's/^psql:[^:]*:[0-9]*: //; s/^== /== /p; s/^NOTICE:  /   /p; s/^ERROR:  /   ERROR: /p'

echo "RESULTADO: suite SQL completa en Supabase real (y revertida con ROLLBACK)"
