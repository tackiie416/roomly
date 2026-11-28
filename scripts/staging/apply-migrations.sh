#!/usr/bin/env bash
# Instalación limpia de staging (sesión 88): todas las migraciones de
# supabase/migrations, en orden, y supabase/seed.sql (solo datos de
# referencia), en UNA transacción. Se niega si el esquema ya existe.
#
#   bash scripts/staging/apply-migrations.sh            # dry run: ROLLBACK al final
#   bash scripts/staging/apply-migrations.sh --apply    # COMMIT (con autorización)
#
# Requiere las variables de scripts/staging/guard.sh. Después, el preflight:
#   bash scripts/staging/preflight.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mode="dry-run"
case "${1:-}" in
  "") ;;
  --apply) mode="apply" ;;
  *) echo "uso: $0 [--apply]" >&2; exit 2 ;;
esac

# shellcheck source=scripts/staging/guard.sh
source "$ROOT/scripts/staging/guard.sh"
export PGSSLMODE="${PGSSLMODE:-require}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$STAGING_DB_URL")

if [ "$("${PSQL[@]}" -At -c "select to_regclass('public.profiles') is not null")" = "t" ]; then
  echo "ERROR: el esquema ya existe en staging; esta herramienta solo hace instalaciones limpias." >&2
  echo "       Una migración nueva se aplica con su propia revisión (docs/STAGING.md, «Rollback»)." >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
{
  echo "begin;"
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    echo "\\echo 'migración: $(basename "$migration")'"
    echo "\\ir $migration"
  done
  echo "\\echo 'seed: supabase/seed.sql'"
  echo "\\ir $ROOT/supabase/seed.sql"
  if [ "$mode" = "apply" ]; then echo "commit;"; else echo "rollback;"; fi
} >"$tmp"

"${PSQL[@]}" -f "$tmp"
if [ "$mode" = "apply" ]; then
  echo "migraciones y seed aplicados en una sola transacción"
else
  echo "dry run correcto: todo se aplicó y se deshizo (ROLLBACK). Nada ha cambiado."
fi
