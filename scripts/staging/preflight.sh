#!/usr/bin/env bash
# Preflight de staging (sesión 88): tests/supabase/preflight.sql (P0–P6) contra
# el proyecto de staging, después de la guarda. Solo lee el catálogo. P0 exige
# la marca exacta roomly-staging.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/staging/guard.sh
source "$ROOT/scripts/staging/guard.sh"
export PGSSLMODE="${PGSSLMODE:-require}"
# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
status=0
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -v expected_marker="$ROOMLY_STAGING_MARKER" \
  -d "$STAGING_DB_URL" <"$ROOT/tests/supabase/preflight.sql" >"$out" 2>&1 || status=$?
roomly_sql_filter_output "$out" || status=1
if [ "$status" -ne 0 ]; then
  echo "RESULTADO: preflight de staging FALLIDO" >&2
  exit 1
fi
echo "RESULTADO: P0–P6 superadas en staging"
