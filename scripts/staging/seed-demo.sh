#!/usr/bin/env bash
# Carga (o borra, con --cleanup) los datos ficticios de staging, en una
# transacción y después de la guarda de staging (sesión 88).
#   bash scripts/staging/seed-demo.sh            # carga
#   bash scripts/staging/seed-demo.sh --cleanup  # borra
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
file="$ROOT/scripts/staging/seed-demo.sql"
case "${1:-}" in
  "") ;;
  --cleanup) file="$ROOT/scripts/staging/cleanup-demo.sql" ;;
  *) echo "uso: $0 [--cleanup]" >&2; exit 2 ;;
esac
# shellcheck source=scripts/staging/guard.sh
source "$ROOT/scripts/staging/guard.sh"
export PGSSLMODE="${PGSSLMODE:-require}"
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$STAGING_DB_URL" --single-transaction -f "$file"
echo "hecho: $(basename "$file")"
