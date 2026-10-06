#!/usr/bin/env bash
# Ejecuta la suite SQL de tests/db (01–13) contra el Supabase de VALIDACIÓN,
# con los roles, auth.uid() y dueños REALES de Supabase (sin shim).
#
# Aislamiento (Fase 2.8, ver tests/supabase/sql-suite-lib.sh): una sesión de
# psql por archivo, cada una dentro de BEGIN ... ROLLBACK, con la identidad
# comprobada dentro de la propia sesión. El BEGIN/ROLLBACK propio de un test
# (tests/db/11 y 12) se convierte en SAVEPOINT, así que no puede deshacer ni
# cerrar la transacción del runner. Los usuarios de prueba insertados en
# auth.users, los datos y el schema auxiliar roomly_test no persisten; al
# final se comprueba en otra sesión que no queda nada.
#
# Requiere SUPABASE_VALIDATION_DB_URL y SUPABASE_VALIDATION_PROJECT_REF.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tests/supabase/guard.sh
source "$ROOT/tests/supabase/guard.sh" SUPABASE_VALIDATION_DB_URL
# shellcheck source=tests/supabase/sql-suite-lib.sh
source "$ROOT/tests/supabase/sql-suite-lib.sh"
export PGSSLMODE="${PGSSLMODE:-require}"

roomly_sql_run_suite "$SUPABASE_VALIDATION_DB_URL" "$ROOT"/tests/db/[0-9]*.sql

echo "RESULTADO: suite SQL completa en Supabase real (cada archivo revertido con ROLLBACK)"
