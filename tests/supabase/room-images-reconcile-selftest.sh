#!/usr/bin/env bash
# Auto-test del informe de conciliación de las fotos (Fase 4.2, D3), contra
# PostgreSQL local (shim de Supabase, todas las migraciones y el seed).
#
# Comprueba que tests/supabase/room-images-reconcile.sh:
#   - clasifica cada caso: objeto sin fila antiguo (candidato) o reciente (no
#     concluyente), sin fecha (no verificable), ruta no canónica, fila sin
#     objeto, e ignora los pares correctos y los objetos de otros buckets;
#   - da un informe idéntico con la misma fecha de referencia, y el umbral
#     cambia la clasificación;
#   - NO ESCRIBE NADA: la huella de los datos es la misma antes y después, y
#     una escritura añadida al SQL falla por la transacción de solo lectura;
#   - distingue «sin inconsistencias» (0), «inconsistencias» (1) y «no se pudo
#     inspeccionar» (2): sin Storage, con una RLS que podría ocultar filas al
#     rol, sin conexión, o con una entrada no válida (sin llegar a conectar);
#   - no muestra la URL de la base de datos (ni su contraseña, tampoco cuando
#     la conexión falla).
#
# Conexión: variables estándar de libpq, como tests/db/run.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
DB="reconcile_selftest_$$"
WORK="$(mktemp -d)"
TOOL="$ROOT/tests/supabase/room-images-reconcile.sh"
AS_OF="2026-10-25T12:00:00Z"
failed=0

cleanup() {
  for suffix in "" _limpia _sin_storage; do
    "${ADMIN[@]}" -c "drop database if exists ${DB}${suffix}" >/dev/null 2>&1 || true
  done
  "${ADMIN[@]}" -c "drop role if exists zz_reconcile_reader_$$" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

ok() { echo "   ok - $1"; }
check() { # <descripción> <condición>
  if eval "$2"; then ok "$1"; else echo "   FALLO: $1"; failed=1; fi
}
url() { echo "postgresql:///$1?host=${PGHOST:-/var/run/postgresql}"; }
# PGSSLMODE=disable: socket local; la herramienta exige TLS por defecto.
reconcile() { # <base de datos> <salida> [argumentos...]
  local db="$1" out="$2"
  shift 2
  ROOMLY_RECONCILE_DB_URL="$(url "$db")" PGSSLMODE=disable bash "${RECONCILE_TOOL:-$TOOL}" "$@" >"$out" 2>&1
}
fingerprint() { # huella de todos los datos que el informe lee
  psql -X -q -At --no-psqlrc -d "$1" -c "select md5(
      coalesce((select string_agg(o.bucket_id || '|' || o.name || '|' || coalesce(o.created_at::text, '-') || '|' || o.updated_at::text,
                                  ',' order by o.bucket_id, o.name) from storage.objects o), '') || '#' ||
      coalesce((select string_agg(i.id || '|' || i.storage_path || '|' || i.position, ',' order by i.id) from public.room_images i), '') || '#' ||
      coalesce((select string_agg(b.id || '|' || b.public, ',' order by b.id) from storage.buckets b), ''))"
}

prepare() { # <base de datos>
  "${ADMIN[@]}" -c "create database $1" >/dev/null
  local P=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$1")
  "${P[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    "${P[@]}" -f "$migration" >/dev/null
  done
  "${P[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
  "${P[@]}" <<'SQL' >/dev/null
insert into auth.users (id, email) values ('e0000000-0000-4000-8000-00000000000a', 'reconcile@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  values ('e0000000-0000-4000-8000-00000000000a', 'Conciliación', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, total_roommates, total_rooms)
  select 'e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 'Conciliación',
         c.id, 400, '2026-11-01', 1, 2
  from public.cities c where c.slug = 'barcelona';
-- Par correcto: fila y objeto.
insert into public.room_images (id, room_id, storage_path, position) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001.webp', 0);
insert into storage.objects (bucket_id, name, created_at) values
  ('room-images', 'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001.webp',
   '2026-10-22T12:00:00Z');
SQL
}

echo "== informe sobre un estado con cada caso"
prepare "$DB"
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB" <<'SQL' >/dev/null
-- Objetos sin fila: 48 h (candidato), 2 h (reciente) y sin fecha.
alter table storage.objects alter column created_at drop not null;
insert into storage.objects (bucket_id, name, created_at) values
  ('room-images', 'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000a1.webp', '2026-10-23T12:00:00Z'),
  ('room-images', 'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000b2.webp', '2026-10-25T10:00:00Z'),
  ('room-images', 'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000c3.webp', null),
  -- Rutas no canónicas (ajenas o restos de una prueba).
  ('room-images', 'roomly-test-19/objeto.webp', '2026-10-01T00:00:00Z'),
  ('room-images', 'E1000000-0000-4000-8000-000000000001/MAYUSCULAS.webp', '2026-10-01T00:00:00Z');
-- Otro bucket: el informe no lo mira.
insert into storage.buckets (id, name, public) values ('otro', 'otro', false);
insert into storage.objects (bucket_id, name, created_at) values
  ('otro', 'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000d4.webp', '2026-10-01T00:00:00Z');
-- Fila sin objeto.
insert into public.room_images (id, room_id, storage_path, position) values
  ('e2000000-0000-4000-8000-0000000000e5', 'e1000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000e5.webp', 1);
SQL

before="$(fingerprint "$DB")"
rc=0
reconcile "$DB" "$WORK/r1.out" --as-of "$AS_OF" --min-age-hours 24 || rc=$?
cat >"$WORK/expected.out" <<'OUT'
== Conciliación de room-images (solo lectura)
referencia: 2026-10-25T12:00:00Z · antigüedad mínima de un candidato: 24 h
objeto_sin_fila (candidato a huérfano): 1
objeto_sin_fila_reciente (no concluyente): 1
objeto_sin_fila_sin_fecha (no verificable): 1
fila_sin_objeto: 1
ruta_no_canonica (ajena a las fotos de la app): 2
-- detalle: categoría, ruta, horas hasta la referencia
fila_sin_objeto	e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000e5.webp	-
objeto_sin_fila	e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000a1.webp	48
objeto_sin_fila_reciente	e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000b2.webp	2
objeto_sin_fila_sin_fecha	e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-0000000000c3.webp	-
ruta_no_canonica	E1000000-0000-4000-8000-000000000001/MAYUSCULAS.webp	588
ruta_no_canonica	roomly-test-19/objeto.webp	588
-- límite: compara metadatos (storage.objects) con room_images; no comprueba que el archivo exista en el almacenamiento de Storage
RESULTADO: INCONSISTENCIAS: 1 objeto(s) sin fila y 1 fila(s) sin objeto. Solo informe: no se ha cambiado nada.
OUT
check "clasifica cada caso y termina con 1 (inconsistencias)" \
  "[ $rc -eq 1 ] && diff -u '$WORK/expected.out' '$WORK/r1.out' >'$WORK/r1.diff'"
[ -s "$WORK/r1.diff" ] && cat "$WORK/r1.diff"
check "el par correcto y el objeto de otro bucket no aparecen" \
  "! grep -q 'e2000000-0000-4000-8000-000000000001.webp\|0000000000d4' '$WORK/r1.out'"
reconcile "$DB" "$WORK/r2.out" --as-of "$AS_OF" --min-age-hours 24 || true
check "con la misma referencia, el informe es idéntico" "cmp -s '$WORK/r1.out' '$WORK/r2.out'"
reconcile "$DB" "$WORK/r3.out" --as-of "$AS_OF" --min-age-hours 1 || true
check "con un umbral de 1 h, el objeto de 2 h también es candidato" \
  "grep -q 'objeto_sin_fila (candidato a huérfano): 2' '$WORK/r3.out' && grep -q 'objeto_sin_fila_reciente (no concluyente): 0' '$WORK/r3.out'"
check "no escribe nada: la huella de los datos no cambia" "[ \"\$(fingerprint '$DB')\" = '$before' ]"
check "no muestra la URL de la base de datos" \
  "! grep -q 'postgresql://\|host=' '$WORK/r1.out' '$WORK/r3.out'"

echo "== solo lectura de verdad: una escritura añadida al SQL falla"
TREE="$WORK/tree"
mkdir -p "$TREE/tests/supabase"
cp "$ROOT/tests/supabase/room-images-reconcile.sh" "$ROOT/tests/supabase/sql-suite-lib.sh" "$TREE/tests/supabase/"
for change in \
  "delete from storage.objects where bucket_id = 'room-images';" \
  "delete from public.room_images;" \
  "update storage.buckets set public = true where id = 'room-images';"; do
  { cat "$ROOT/tests/supabase/room-images-reconcile.sql"; echo "$change"; } >"$TREE/tests/supabase/room-images-reconcile.sql"
  rc=0
  RECONCILE_TOOL="$TREE/tests/supabase/room-images-reconcile.sh" reconcile "$DB" "$WORK/rw.out" --as-of "$AS_OF" || rc=$?
  check "«${change%% where*}…» falla (read-only transaction), con 2 y sin cambiar nada" \
    "[ $rc -eq 2 ] && grep -q 'read-only transaction' '$WORK/rw.out' && grep -q 'NO VERIFICABLE' '$WORK/rw.out' \
     && [ \"\$(fingerprint '$DB')\" = '$before' ]"
done

echo "== sin inconsistencias y sin poder inspeccionar"
prepare "${DB}_limpia"
rc=0
reconcile "${DB}_limpia" "$WORK/clean.out" --as-of "$AS_OF" || rc=$?
check "solo pares correctos: 0 y «sin inconsistencias confirmadas»" \
  "[ $rc -eq 0 ] && grep -q '^RESULTADO: sin inconsistencias confirmadas (0 reciente(s) y 0 sin fecha sin concluir)' '$WORK/clean.out'"
"${ADMIN[@]}" -c "create database ${DB}_sin_storage" >/dev/null
rc=0
reconcile "${DB}_sin_storage" "$WORK/nostorage.out" --as-of "$AS_OF" || rc=$?
check "sin Storage: 2, NO VERIFICABLE" \
  "[ $rc -eq 2 ] && grep -q 'faltan storage.objects o public.room_images' '$WORK/nostorage.out'"
"${ADMIN[@]}" -c "create role zz_reconcile_reader_$$ nologin" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "${DB}_limpia" \
  -c "grant usage on schema storage to zz_reconcile_reader_$$; grant select on storage.objects, public.room_images to zz_reconcile_reader_$$;" >/dev/null
rc=0
PGOPTIONS="-c role=zz_reconcile_reader_$$" reconcile "${DB}_limpia" "$WORK/rls.out" --as-of "$AS_OF" || rc=$?
check "un rol al que la RLS podría ocultar filas: 2, NO VERIFICABLE (no «sin inconsistencias»)" \
  "[ $rc -eq 2 ] && grep -q 'tiene la RLS activa y el rol zz_reconcile_reader_$$' '$WORK/rls.out' && ! grep -q 'sin inconsistencias' '$WORK/rls.out'"
rc=0
ROOMLY_RECONCILE_DB_URL="postgresql://zz_nadie:zz-secreto-$$@/${DB}_no_existe?host=${PGHOST:-/var/run/postgresql}" \
  PGSSLMODE=disable bash "$TOOL" --as-of "$AS_OF" >"$WORK/noconn.out" 2>&1 || rc=$?
check "sin conexión: 2, NO VERIFICABLE, sin la URL ni la contraseña" \
  "[ $rc -eq 2 ] && grep -q '^RESULTADO: NO VERIFICABLE: no se pudo inspeccionar' '$WORK/noconn.out' && ! grep -q 'zz-secreto\|postgresql://\|${DB}_no_existe' '$WORK/noconn.out'"
for args in "--min-age-hours 0" "--min-age-hours abc" "--as-of ayer" "--modo apply"; do
  rc=0
  # shellcheck disable=SC2086
  ROOMLY_RECONCILE_DB_URL="postgresql://reconcile.invalid/x" bash "$TOOL" $args >"$WORK/bad.out" 2>&1 || rc=$?
  check "entrada no válida (${args}): 2 sin conectar" \
    "[ $rc -eq 2 ] && grep -q 'entrada no válida' '$WORK/bad.out' && ! grep -q 'reconcile.invalid' '$WORK/bad.out'"
done

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: el informe de conciliación NO supera su auto-test"
  exit 1
fi
echo "RESULTADO: room-images-reconcile.sh: clasificación estable, solo lectura comprobada y «no verificable» distinto de «sin inconsistencias»"