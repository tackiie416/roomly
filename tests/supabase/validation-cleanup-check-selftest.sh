#!/usr/bin/env bash
# Auto-test de la verificación de la limpieza (paso 8 del procedimiento D2 de
# la 4.2), contra PostgreSQL local (shim de Supabase, todas las migraciones y
# el seed).
#
# Comprueba que tests/supabase/validation-cleanup-check.sh:
#   - da 0 en un proyecto recién instalado (solo seed);
#   - da 1 si quedan usuarios de prueba, filas de usuario, objetos de Storage,
#     el esquema roomly_test o políticas zz_test;
#   - NO ESCRIBE NADA: la huella de los datos no cambia, y una escritura
#     añadida al SQL falla por la transacción de solo lectura;
#   - da 2 (no verificable) con una marca distinta o ausente, con un rol al que
#     la RLS podría ocultar filas, sin conexión o con una entrada no válida
#     (sin llegar a conectar);
#   - no muestra la URL, los emails ni los ids.
#
# Conexión: variables estándar de libpq, como tests/db/run.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
DB="cleanup_selftest_$$"
WORK="$(mktemp -d)"
TOOL="$ROOT/tests/supabase/validation-cleanup-check.sh"
MARKER="roomly-validation-4"
failed=0

cleanup() {
  for suffix in "" _sucia; do
    "${ADMIN[@]}" -c "drop database if exists ${DB}${suffix}" >/dev/null 2>&1 || true
  done
  "${ADMIN[@]}" -c "drop role if exists zz_cleanup_reader_$$" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

ok() { echo "   ok - $1"; }
check() { # <descripción> <condición>
  if eval "$2"; then ok "$1"; else echo "   FALLO: $1"; failed=1; fi
}
url() { echo "postgresql:///$1?host=${PGHOST:-/var/run/postgresql}"; }
# PGSSLMODE=disable: socket local; la herramienta exige TLS por defecto.
run_check() { # <base de datos> <salida> [argumentos...]
  local db="$1" out="$2"
  shift 2
  ROOMLY_CLEANUP_DB_URL="$(url "$db")" PGSSLMODE=disable bash "${CLEANUP_TOOL:-$TOOL}" "$@" >"$out" 2>&1
}
fingerprint() {
  psql -X -q -At --no-psqlrc -d "$1" -c "select md5(
      coalesce((select string_agg(u.id || '|' || coalesce(u.email, '-'), ',' order by u.id) from auth.users u), '') || '#' ||
      coalesce((select string_agg(p.id::text, ',' order by p.id) from public.profiles p), '') || '#' ||
      coalesce((select string_agg(r.id::text, ',' order by r.id) from public.rooms r), '') || '#' ||
      coalesce((select string_agg(o.bucket_id || '|' || o.name, ',' order by o.bucket_id, o.name) from storage.objects o), ''))"
}
prepare() { # <base de datos>
  "${ADMIN[@]}" -c "create database $1" >/dev/null
  local P=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$1")
  "${P[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    "${P[@]}" -f "$migration" >/dev/null
  done
  "${P[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
  "${P[@]}" -c "comment on database $1 is '${MARKER}'" >/dev/null
}

echo "== proyecto recién instalado (solo seed): limpio"
prepare "$DB"
rc=0
run_check "$DB" "$WORK/clean.out" --expect-marker "$MARKER" || rc=$?
check "0 y «limpio», con la marca confirmada" \
  "[ $rc -eq 0 ] && grep -q '^marca: ${MARKER}$' '$WORK/clean.out' && grep -q '^RESULTADO: limpio' '$WORK/clean.out'"
check "cuenta usuarios, filas de usuario y objetos (todo a 0)" \
  "grep -q '^usuarios_de_prueba: 0$' '$WORK/clean.out' && grep -q '^auth_users: 0$' '$WORK/clean.out' \
   && grep -q '^objetos_room_images: 0$' '$WORK/clean.out' && grep -q '^rooms: 0$' '$WORK/clean.out' \
   && grep -q '^compatibility_responses: 0$' '$WORK/clean.out' && grep -q '^messages: 0$' '$WORK/clean.out'"

echo "== restos de las pruebas"
prepare "${DB}_sucia"
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "${DB}_sucia" <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-00000000000a', 'suite@test'),
  ('f0000000-0000-4000-8000-00000000000b', 'roomly-val-123-a@example.com');
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  values ('f0000000-0000-4000-8000-00000000000a', 'Resto', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, total_roommates, total_rooms)
  select 'f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-00000000000a', 'Resto',
         c.id, 400, '2026-11-01', 1, 2
  from public.cities c where c.slug = 'barcelona';
insert into storage.objects (bucket_id, name, created_at) values
  ('room-images', 'f1000000-0000-4000-8000-000000000001/f2000000-0000-4000-8000-000000000001.webp', '2026-11-21T00:20:00Z');
create schema roomly_test;
SQL
before="$(fingerprint "${DB}_sucia")"
rc=0
run_check "${DB}_sucia" "$WORK/dirty.out" --expect-marker "$MARKER" || rc=$?
check "1 y «QUEDAN RESTOS»" "[ $rc -eq 1 ] && grep -q '^RESULTADO: QUEDAN RESTOS' '$WORK/dirty.out'"
check "detecta los dos patrones de usuarios de prueba, el perfil, la habitación, el objeto y el esquema" \
  "grep -q '^usuarios_de_prueba: 2$' '$WORK/dirty.out' && grep -q '^auth_users: 2$' '$WORK/dirty.out' \
   && grep -q '^profiles: 1$' '$WORK/dirty.out' && grep -q '^rooms: 1$' '$WORK/dirty.out' \
   && grep -q '^objetos_room_images: 1$' '$WORK/dirty.out' && grep -q '^esquema_roomly_test: 1$' '$WORK/dirty.out'"
check "no muestra emails, ids, rutas ni la URL" \
  "! grep -q '@\|f0000000\|f1000000\|postgresql://\|host=' '$WORK/dirty.out'"
check "no escribe nada: la huella de los datos no cambia" "[ \"\$(fingerprint '${DB}_sucia')\" = '$before' ]"

echo "== solo lectura de verdad: una escritura añadida al SQL falla"
TREE="$WORK/tree"
mkdir -p "$TREE/tests/supabase"
cp "$ROOT/tests/supabase/validation-cleanup-check.sh" "$ROOT/tests/supabase/sql-suite-lib.sh" "$TREE/tests/supabase/"
for change in "delete from auth.users;" "delete from storage.objects;" "drop schema roomly_test;"; do
  { cat "$ROOT/tests/supabase/validation-cleanup-check.sql"; echo "$change"; } >"$TREE/tests/supabase/validation-cleanup-check.sql"
  rc=0
  CLEANUP_TOOL="$TREE/tests/supabase/validation-cleanup-check.sh" run_check "${DB}_sucia" "$WORK/rw.out" --expect-marker "$MARKER" || rc=$?
  check "«${change}» falla (read-only transaction), con 2 y sin cambiar nada" \
    "[ $rc -eq 2 ] && grep -q 'read-only transaction' '$WORK/rw.out' && grep -q 'NO VERIFICABLE' '$WORK/rw.out' \
     && [ \"\$(fingerprint '${DB}_sucia')\" = '$before' ]"
done

echo "== no verificable"
rc=0
run_check "$DB" "$WORK/othermarker.out" --expect-marker roomly-validation-3 || rc=$?
check "marca distinta de la esperada: 2, sin contadores" \
  "[ $rc -eq 2 ] && grep -q 'la marca de la base de datos no es la esperada' '$WORK/othermarker.out' && ! grep -q '^auth_users' '$WORK/othermarker.out'"
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB" -c "comment on database ${DB} is null" >/dev/null
rc=0
run_check "$DB" "$WORK/nomarker.out" --expect-marker "$MARKER" || rc=$?
check "marca ausente: 2" "[ $rc -eq 2 ] && grep -q 'NO VERIFICABLE' '$WORK/nomarker.out'"
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB" -c "comment on database ${DB} is '${MARKER}'" >/dev/null
"${ADMIN[@]}" -c "create role zz_cleanup_reader_$$ nologin" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB" \
  -c "grant usage on schema auth, storage to zz_cleanup_reader_$$; grant select on all tables in schema public, auth, storage to zz_cleanup_reader_$$;" >/dev/null
rc=0
PGOPTIONS="-c role=zz_cleanup_reader_$$" run_check "$DB" "$WORK/rls.out" --expect-marker "$MARKER" || rc=$?
check "un rol al que la RLS podría ocultar filas: 2 (no «limpio»)" \
  "[ $rc -eq 2 ] && grep -q 'tiene la RLS activa y el rol zz_cleanup_reader_$$' '$WORK/rls.out' && ! grep -q 'limpio' '$WORK/rls.out'"
rc=0
ROOMLY_CLEANUP_DB_URL="postgresql://zz_nadie:zz-secreto-$$@/${DB}_no_existe?host=${PGHOST:-/var/run/postgresql}" \
  PGSSLMODE=disable bash "$TOOL" --expect-marker "$MARKER" >"$WORK/noconn.out" 2>&1 || rc=$?
check "sin conexión: 2, sin la URL ni la contraseña" \
  "[ $rc -eq 2 ] && grep -q 'no se pudo inspeccionar' '$WORK/noconn.out' && ! grep -q 'zz-secreto\|postgresql://\|${DB}_no_existe' '$WORK/noconn.out'"
for args in "" "--expect-marker produccion" "--expect-marker roomly-validation-9" "--expect-marker" "--apply"; do
  rc=0
  # shellcheck disable=SC2086
  ROOMLY_CLEANUP_DB_URL="postgresql://cleanup.invalid/x" bash "$TOOL" $args >"$WORK/bad.out" 2>&1 || rc=$?
  check "entrada no válida («${args}»): 2 sin conectar" \
    "[ $rc -eq 2 ] && grep -q 'entrada no válida' '$WORK/bad.out' && ! grep -q 'cleanup.invalid' '$WORK/bad.out'"
done

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: la verificación de la limpieza NO supera su auto-test"
  exit 1
fi
echo "RESULTADO: validation-cleanup-check.sh: limpio y restos distinguidos, solo lectura comprobada y «no verificable» distinto de «limpio»"
