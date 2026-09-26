#!/usr/bin/env bash
# P1–P5: comprobaciones de infraestructura (solo lectura de catálogo).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tests/supabase/guard.sh
source "$ROOT/tests/supabase/guard.sh" SUPABASE_VALIDATION_DB_URL
export PGSSLMODE="${PGSSLMODE:-require}"

psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$SUPABASE_VALIDATION_DB_URL" \
  -f "$ROOT/tests/supabase/preflight.sql" 2>&1 \
  | sed -n 's/^psql:[^:]*:[0-9]*: //; s/^NOTICE:  /   /p; s/^ERROR:  /   ERROR: /p'

echo "RESULTADO: P1–P5 superadas"
