#!/usr/bin/env bash
# Fase 4.2 — el límite de 8 fotos con subidas simultáneas, con dos sesiones
# de verdad (20261024120000_room_images_storage_visibility.sql).
#
# Lo lanza tests/db/run.sh sobre su base de datos temporal, después de los
# tests SQL: uso, concurrency_room_images.sh <base de datos>. Solo local: la
# suite SQL remota ejecuta un archivo por sesión y no puede abrir dos.
#
# Debe fallar si dos INSERT simultáneos en la misma habitación, cuando tiene
# 7 fotos, pueden dejarla con 9: el trigger bloquea la fila de la habitación
# (FOR NO KEY UPDATE) antes de contar, así que el segundo espera al primero y,
# al confirmarse este, cuenta su foto y se rechaza. El control quita el
# bloqueo de la función, de forma temporal, y comprueba que entonces entran
# las dos: el resultado depende del bloqueo, no del orden de las sesiones.
#
# Sesión A: abre una transacción, inserta la octava foto y se queda abierta.
# Sesión B: inserta otra. Se comprueba en pg_stat_activity que B espera un
# bloqueo antes de confirmar A.
set -euo pipefail

DB="${1:?uso: concurrency_room_images.sh <base de datos>}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB")
WORK="$(mktemp -d)"
pid_a=""
pid_b=""
cleanup() {
  exec 3>&- 2>/dev/null || true
  [ -n "$pid_a" ] && kill "$pid_a" 2>/dev/null || true
  [ -n "$pid_b" ] && kill "$pid_b" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

ok() { echo "   ok - $1"; }
fail() {
  echo "   FALLO: $1"
  exit 1
}
q() { "${PSQL[@]}" -At -c "$1"; }
# wait_until <consulta que devuelve t> <segundos>
wait_until() {
  local i
  for ((i = 0; i < $2 * 10; i++)); do
    [ "$(q "$1")" = "t" ] && return 0
    sleep 0.1
  done
  return 1
}
image() { # <room> <n>: valores de la foto n de una habitación (ruta canónica)
  local id="cc200000-0000-0000-0000-00000000${1: -2}0$2"
  printf "('%s', 'cc100000-0000-0000-0000-0000000000%s', 'cc100000-0000-0000-0000-0000000000%s/%s.webp', %s)" \
    "$id" "${1: -2}" "${1: -2}" "$id" "$2"
}
count_images() { q "select count(*) from public.room_images where room_id = 'cc100000-0000-0000-0000-0000000000$1'"; }

"${PSQL[@]}" >/dev/null <<'SQL'
insert into auth.users (id, email) values ('cc000000-0000-0000-0000-00000000000a', 'concurrency-a@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  values ('cc000000-0000-0000-0000-00000000000a', 'Concurrencia A', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select v.id, 'cc000000-0000-0000-0000-00000000000a', v.title, c.id, n.id, 500, '2026-11-01', 1, 2, 'active'
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval',
       (values ('cc100000-0000-0000-0000-000000000001'::uuid, 'Concurrencia 1'),
               ('cc100000-0000-0000-0000-000000000002'::uuid, 'Concurrencia 2 (control)')) as v(id, title)
  where c.slug = 'barcelona';
set role service_role;
insert into public.room_images (id, room_id, storage_path, position)
  select ('cc200000-0000-0000-0000-00000000' || r || '0' || n)::uuid,
         ('cc100000-0000-0000-0000-0000000000' || r)::uuid,
         'cc100000-0000-0000-0000-0000000000' || r || '/cc200000-0000-0000-0000-00000000' || r || '0' || n || '.webp',
         n
  from (values ('01'), ('02')) as rooms(r), generate_series(1, 7) as n;
SQL
[ "$(count_images 01)" = 7 ] && [ "$(count_images 02)" = 7 ] \
  || fail "preparación: cada habitación debía empezar con 7 fotos"

# race <habitación>: A inserta la octava y se queda abierta; B inserta otra.
# Deja el resultado en $WORK/a.status, $WORK/b.status y $WORK/b.log, y en
# $WORK/b.waited si B llegó a esperar un bloqueo mientras A seguía abierta.
race() {
  local room="$1" status
  rm -f "$WORK"/a.* "$WORK"/b.*
  mkfifo "$WORK/a.fifo"
  (
    status=0
    PGAPPNAME=cc_a_$$ "${PSQL[@]}" <"$WORK/a.fifo" >"$WORK/a.log" 2>&1 || status=$?
    echo "$status" >"$WORK/a.status"
  ) &
  pid_a=$!
  exec 3>"$WORK/a.fifo"
  printf '%s\n' "begin;" "set local role service_role;" \
    "insert into public.room_images (id, room_id, storage_path, position) values $(image "$room" 8);" >&3
  wait_until "select exists (select 1 from pg_stat_activity
                              where application_name = 'cc_a_$$' and state = 'idle in transaction')" 10 \
    || fail "la sesión A no llegó a quedarse abierta tras su INSERT ($(cat "$WORK/a.log"))"
  (
    status=0
    PGAPPNAME=cc_b_$$ "${PSQL[@]}" -c "set lock_timeout = '20s'; set role service_role;
      insert into public.room_images (id, room_id, storage_path, position) values $(image "$room" 9);" \
      >"$WORK/b.log" 2>&1 || status=$?
    echo "$status" >"$WORK/b.status"
  ) &
  pid_b=$!
  # B espera un bloqueo (con A todavía abierta), o termina sin esperar (el
  # control, sin bloqueo). Como mucho 10 s.
  local i
  for ((i = 0; i < 100; i++)); do
    [ -e "$WORK/b.status" ] && break
    if [ "$(q "select exists (select 1 from pg_stat_activity
                              where application_name = 'cc_b_$$' and wait_event_type = 'Lock')")" = t ]; then
      [ -e "$WORK/a.status" ] || touch "$WORK/b.waited"
      break
    fi
    sleep 0.1
  done
  printf '%s\n' "commit;" >&3
  exec 3>&-
  wait "$pid_a" || true
  wait "$pid_b" || true
  pid_a=""
  pid_b=""
}

race 01
[ -e "$WORK/b.waited" ] || fail "CC1: la segunda sesión no esperó a la primera ($(cat "$WORK/b.log"))"
ok "CC1: con el bloqueo, el INSERT de la segunda sesión espera a que se confirme la primera"
[ "$(cat "$WORK/a.status")" = 0 ] || fail "CC2: la primera sesión no pudo confirmar ($(cat "$WORK/a.log"))"
ok "CC2: la primera sesión confirma la octava foto"
if [ "$(cat "$WORK/b.status")" != 0 ] && grep -q "room_images_limit:" "$WORK/b.log"; then
  ok "CC3: la segunda se rechaza con room_images_limit (cuenta la foto de la primera)"
else
  fail "CC3: la segunda sesión no se rechazó por el límite ($(cat "$WORK/b.log"))"
fi
[ "$(count_images 01)" = 8 ] || fail "CC4: la habitación tiene $(count_images 01) fotos, no 8"
ok "CC4: la habitación queda con 8 fotos"

# Control: la misma carrera sin el bloqueo. Se cambia la función y se restaura
# con su definición exacta, comprobada después.
before="$(q "select md5(prosrc) from pg_proc where oid = 'public.enforce_room_images_integrity()'::regprocedure")"
q "select pg_get_functiondef('public.enforce_room_images_integrity()'::regprocedure)" >"$WORK/function.sql"
grep -q "for no key update" "$WORK/function.sql" || fail "CC5: la función no tiene el bloqueo que se quiere quitar"
sed 's/for no key update//' "$WORK/function.sql" >"$WORK/function-sin-bloqueo.sql"
"${PSQL[@]}" -f "$WORK/function-sin-bloqueo.sql" >/dev/null
race 02
"${PSQL[@]}" -f "$WORK/function.sql" >/dev/null
after="$(q "select md5(prosrc) from pg_proc where oid = 'public.enforce_room_images_integrity()'::regprocedure")"
[ "$after" = "$before" ] || fail "CC5: la función no se restauró tal cual"
if [ ! -e "$WORK/b.waited" ] && [ "$(cat "$WORK/a.status")" = 0 ] && [ "$(cat "$WORK/b.status")" = 0 ] \
  && [ "$(count_images 02)" = 9 ]; then
  ok "CC5-control: sin el bloqueo, las dos sesiones entran y la habitación queda con 9 fotos (función restaurada)"
else
  fail "CC5-control: sin el bloqueo se esperaban 9 fotos sin espera, hay $(count_images 02) ($(cat "$WORK/b.log"))"
fi
