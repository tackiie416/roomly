#!/usr/bin/env bash
# P0–P6: comprobaciones de infraestructura (solo lectura de catálogo).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tests/supabase/guard.sh
source "$ROOT/tests/supabase/guard.sh" SUPABASE_VALIDATION_DB_URL
export PGSSLMODE="${PGSSLMODE:-require}"

# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
status=0
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$SUPABASE_VALIDATION_DB_URL" \
  <"$ROOT/tests/supabase/preflight.sql" >"$out" 2>&1 || status=$?
# NOTICE/WARNING/ERROR visibles (nunca datos de conexión); un WARNING falla.
roomly_sql_filter_output "$out" || status=1
if [ "$status" -ne 0 ]; then
  echo "RESULTADO: preflight FALLIDO; no se ejecuta ninguna suite" >&2
  exit 1
fi

echo "RESULTADO: P0–P6 superadas"
