#!/usr/bin/env bash
# Aplica las migraciones existentes + seed al proyecto de VALIDACIÓN, una sola
# vez y en una sola transacción (si algo falla, no queda nada a medias).
# Se niega a ejecutarse si el esquema ya existe: no es idempotente a propósito.
#
# Requiere SUPABASE_VALIDATION_DB_URL (Session pooler) y
# SUPABASE_VALIDATION_PROJECT_REF. No imprime ninguno de los dos.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tests/supabase/guard.sh
source "$ROOT/tests/supabase/guard.sh" SUPABASE_VALIDATION_DB_URL
export PGSSLMODE="${PGSSLMODE:-require}"

PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$SUPABASE_VALIDATION_DB_URL")

if [ "$("${PSQL[@]}" -At -c "select to_regclass('public.profiles') is not null")" = "t" ]; then
  echo "ERROR: el esquema ya existe en el proyecto de validación; no se reaplica." >&2
  echo "       Ejecuta el workflow con apply_migrations=false." >&2
  exit 1
fi

args=()
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "migración: $(basename "$migration")"
  args+=(-f "$migration")
done
echo "seed: supabase/seed.sql"
args+=(-f "$ROOT/supabase/seed.sql")

"${PSQL[@]}" --single-transaction "${args[@]}"
echo "migraciones y seed aplicados en una sola transacción"
