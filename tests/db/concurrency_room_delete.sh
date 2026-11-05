#!/usr/bin/env bash
# Fase 4.2 (sesión 65) — borrar una habitación mientras se sube una foto, con
# dos sesiones de verdad (20261030120000_rooms_delete_server_only.sql).
#
# Lo lanza tests/db/run.sh sobre su base de datos temporal, después de los
# tests SQL: uso, concurrency_room_delete.sh <base de datos>. Solo local: la
# suite SQL remota ejecuta un archivo por sesión y no puede abrir dos.
#
# Debe fallar si una foto subida a la vez que se borra la habitación puede
# quedarse fuera de las rutas que devuelve delete_own_room (su objeto quedaría
# huérfano sin que el servidor lo supiera). La función bloquea la habitación
# (FOR UPDATE) antes de leer las fotos:
#   - CD1: si la subida va primero (su trigger tiene la habitación bloqueada
#     con FOR NO KEY UPDATE), el borrado espera, y al confirmarse la subida
#     devuelve también su ruta;
#   - CD2: si el borrado va primero, la subida espera y, al confirmarse el
#     borrado, se rechaza (room_not_writable: la habitación ya no existe), así
#     que no queda ninguna fila sin su ruta en la lista;
#   - CD3-control: sin el FOR UPDATE de la función (cambiada de forma
#     temporal y restaurada), la ruta de la foto de CD1 se queda fuera de la
#     lista aunque su fila se borre en cascada: el resultado depende del
#     bloqueo, no del orden;
#   - CD0: fuera de READ COMMITTED, la función se niega a borrar.
set -euo pipefail

DB="${1:?uso: concurrency_room_delete.sh <base de datos>}"
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
wait_until() { # <consulta que devuelve t> <segundos>
  local i
  for ((i = 0; i < $2 * 10; i++)); do
    [ "$(q "$1")" = "t" ] && return 0
    sleep 0.1
  done
  return 1
}
# waits_for_lock <application_name> <archivo de estado>: la sesión espera un
# bloqueo (antes de que termine). Como mucho 10 s.
waits_for_lock() {
  local i
  for ((i = 0; i < 100; i++)); do
    [ -e "$2" ] && return 1
    [ "$(q "select exists (select 1 from pg_stat_activity
                           where application_name = '$1' and wait_event_type = 'Lock')")" = t ] && return 0
    sleep 0.1
  done
  return 1
}

OWNER="cd000000-0000-0000-0000-00000000000a"
room() { echo "cd100000-0000-0000-0000-0000000000$1"; }
image_id() { echo "cd200000-0000-0000-0000-000000000$1$2"; }
path() { echo "$(room "$1")/$(image_id "$1" "$2").webp"; }
insert_image() { # <habitación> <n>
  printf "insert into public.room_images (id, room_id, storage_path, position) values ('%s', '%s', '%s', %s);" \
    "$(image_id "$1" "$2")" "$(room "$1")" "$(path "$1" "$2")" "$2"
}
delete_call() { # <habitación>: devuelve las rutas separadas por comas
  echo "select array_to_string(public.delete_own_room('$(room "$1")', '$OWNER'), ',');"
}
images_of() { q "select count(*) from public.room_images where room_id = '$(room "$1")'"; }
room_exists() { q "select exists (select 1 from public.rooms where id = '$(room "$1")')"; }

"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email) values ('$OWNER', 'delete-concurrency@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  values ('$OWNER', 'Borrado concurrente', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
  select v.id::uuid, '$OWNER', v.title, c.id, 500, '2026-11-01'
  from public.cities c,
       (values ('$(room 00)', 'CD0'), ('$(room 01)', 'CD1'), ('$(room 02)', 'CD2'),
               ('$(room 03)', 'CD3 (control)')) as v(id, title)
  where c.slug = 'barcelona';
set role service_role;
$(insert_image 00 1)
$(insert_image 01 1)
$(insert_image 02 1)
$(insert_image 03 1)
SQL
for r in 00 01 02 03; do
  [ "$(images_of $r)" = 1 ] || fail "preparación: la habitación $r debía empezar con 1 foto"
done

# CD0: en REPEATABLE READ la lectura de las fotos usaría la instantánea del
# principio de la transacción, aunque se esperara al bloqueo.
if "${PSQL[@]}" -At >"$WORK/cd0.log" 2>&1 <<SQL; then
begin isolation level repeatable read;
set local role service_role;
$(delete_call 00)
commit;
SQL
  fail "CD0: en REPEATABLE READ la función borró ($(cat "$WORK/cd0.log"))"
fi
grep -q "room_delete_isolation:" "$WORK/cd0.log" || fail "CD0: rechazo por otro motivo ($(cat "$WORK/cd0.log"))"
[ "$(room_exists 00)" = t ] && [ "$(images_of 00)" = 1 ] || fail "CD0: el rechazo borró algo"
ok "CD0: fuera de READ COMMITTED la función se niega a borrar (room_delete_isolation) y no borra nada"

# upload_first <habitación>: A sube la segunda foto y se queda abierta; B
# borra la habitación. Resultado en $WORK/{a,b}.{status,log} y $WORK/b.waited.
upload_first() {
  local r="$1" status
  rm -f "$WORK"/a.* "$WORK"/b.*
  mkfifo "$WORK/a.fifo"
  (
    status=0
    PGAPPNAME=cd_a_$$ "${PSQL[@]}" <"$WORK/a.fifo" >"$WORK/a.log" 2>&1 || status=$?
    echo "$status" >"$WORK/a.status"
  ) &
  pid_a=$!
  exec 3>"$WORK/a.fifo"
  printf '%s\n' "begin;" "set local role service_role;" "$(insert_image "$r" 2)" >&3
  wait_until "select exists (select 1 from pg_stat_activity
                              where application_name = 'cd_a_$$' and state = 'idle in transaction')" 10 \
    || fail "la sesión A no llegó a quedarse abierta tras su INSERT ($(cat "$WORK/a.log"))"
  (
    status=0
    PGAPPNAME=cd_b_$$ "${PSQL[@]}" -At -c "set lock_timeout = '20s'; set role service_role; $(delete_call "$r")" \
      >"$WORK/b.log" 2>&1 || status=$?
    echo "$status" >"$WORK/b.status"
  ) &
  pid_b=$!
  if waits_for_lock "cd_b_$$" "$WORK/b.status" && [ ! -e "$WORK/a.status" ]; then
    touch "$WORK/b.waited"
  fi
  printf '%s\n' "commit;" >&3
  exec 3>&-
  wait "$pid_a" || true
  wait "$pid_b" || true
  pid_a=""
  pid_b=""
}

upload_first 01
[ -e "$WORK/b.waited" ] || fail "CD1: el borrado no esperó a la subida ($(cat "$WORK/b.log"))"
ok "CD1: con la subida abierta, el borrado espera el bloqueo de la habitación"
[ "$(cat "$WORK/a.status")" = 0 ] || fail "CD1: la subida no pudo confirmar ($(cat "$WORK/a.log"))"
[ "$(cat "$WORK/b.status")" = 0 ] || fail "CD1: el borrado falló ($(cat "$WORK/b.log"))"
expected="$(path 01 1),$(path 01 2)"
[ "$(cat "$WORK/b.log")" = "$expected" ] \
  || fail "CD1: rutas devueltas «$(cat "$WORK/b.log")», se esperaban «$expected»"
ok "CD1: al confirmarse la subida, el borrado devuelve también la ruta de la foto nueva"
[ "$(room_exists 01)" = f ] && [ "$(images_of 01)" = 0 ] || fail "CD1: quedó la habitación o alguna foto"
ok "CD1: y no queda la habitación ni ninguna fila de sus fotos"

# CD2: B borra primero y se queda abierta; A sube después.
rm -f "$WORK"/a.* "$WORK"/b.*
mkfifo "$WORK/b.fifo"
(
  status=0
  PGAPPNAME=cd_b_$$ "${PSQL[@]}" -At <"$WORK/b.fifo" >"$WORK/b.log" 2>&1 || status=$?
  echo "$status" >"$WORK/b.status"
) &
pid_b=$!
exec 3>"$WORK/b.fifo"
printf '%s\n' "begin;" "set local role service_role;" "$(delete_call 02)" >&3
wait_until "select exists (select 1 from pg_stat_activity
                            where application_name = 'cd_b_$$' and state = 'idle in transaction')" 10 \
  || fail "CD2: el borrado no llegó a quedarse abierto ($(cat "$WORK/b.log"))"
(
  status=0
  PGAPPNAME=cd_a_$$ "${PSQL[@]}" -c "set lock_timeout = '20s'; set role service_role; $(insert_image 02 2)" \
    >"$WORK/a.log" 2>&1 || status=$?
  echo "$status" >"$WORK/a.status"
) &
pid_a=$!
waits_for_lock "cd_a_$$" "$WORK/a.status" && [ ! -e "$WORK/b.status" ] && touch "$WORK/a.waited"
printf '%s\n' "commit;" >&3
exec 3>&-
wait "$pid_a" || true
wait "$pid_b" || true
pid_a=""
pid_b=""
[ -e "$WORK/a.waited" ] || fail "CD2: la subida no esperó al borrado ($(cat "$WORK/a.log"))"
ok "CD2: con el borrado abierto, la subida espera el bloqueo de la habitación"
[ "$(cat "$WORK/b.status")" = 0 ] && grep -qx "$(path 02 1)" "$WORK/b.log" \
  || fail "CD2: el borrado no confirmó con la ruta de su foto ($(cat "$WORK/b.log"))"
if [ "$(cat "$WORK/a.status")" != 0 ] && grep -q "room_not_writable:" "$WORK/a.log"; then
  ok "CD2: al confirmarse el borrado, la subida se rechaza (room_not_writable), sin fila que quede fuera de la lista"
else
  fail "CD2: la subida no se rechazó por la habitación borrada ($(cat "$WORK/a.log"))"
fi
[ "$(room_exists 02)" = f ] && [ "$(images_of 02)" = 0 ] || fail "CD2: quedó la habitación o alguna foto"

# CD3-control: la carrera de CD1 sin el FOR UPDATE de la función. Se cambia
# y se restaura con su definición exacta, comprobada después.
before="$(q "select md5(prosrc) from pg_proc where oid = 'public.delete_own_room(uuid, uuid)'::regprocedure")"
q "select pg_get_functiondef('public.delete_own_room(uuid, uuid)'::regprocedure)" >"$WORK/function.sql"
[ "$(grep -c "for update;" "$WORK/function.sql")" = 1 ] \
  || fail "CD3: la función no tiene el FOR UPDATE que se quiere quitar"
sed 's/^  for update;$/  ;/' "$WORK/function.sql" >"$WORK/function-sin-bloqueo.sql"
"${PSQL[@]}" -f "$WORK/function-sin-bloqueo.sql" >/dev/null
upload_first 03
"${PSQL[@]}" -f "$WORK/function.sql" >/dev/null
after="$(q "select md5(prosrc) from pg_proc where oid = 'public.delete_own_room(uuid, uuid)'::regprocedure")"
[ "$after" = "$before" ] || fail "CD3: la función no se restauró tal cual"
if [ "$(cat "$WORK/b.status")" = 0 ] && [ "$(cat "$WORK/b.log")" = "$(path 03 1)" ] \
  && [ "$(room_exists 03)" = f ] && [ "$(images_of 03)" = 0 ]; then
  ok "CD3-control: sin el bloqueo, la foto nueva se borra en cascada pero su ruta no se devuelve (función restaurada)"
else
  fail "CD3-control: sin el bloqueo se esperaba perder la ruta de la foto nueva; devolvió «$(cat "$WORK/b.log")» ($(cat "$WORK/a.log"))"
fi
