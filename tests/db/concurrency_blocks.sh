#!/usr/bin/env bash
# Fase 6 (sesión 83) — bloquear mientras se crea un match, con dos sesiones de
# verdad (20261128120000_blocks_reports_abuse_limits.sql).
#
# Lo lanza tests/db/run.sh sobre su base de datos temporal, después de los
# tests SQL: uso, concurrency_blocks.sh <base de datos>. Solo local.
#
# Debe fallar si un bloqueo y un match simultáneos pueden dejar un match (o
# un chat abierto) entre dos personas bloqueadas:
#   - CB1: con block_user abierto, el «Me interesa» que completaría el match
#     espera el bloqueo de la pareja y, al confirmarse el bloqueo, se rechaza;
#   - CB2: con el match abierto, block_user espera y, al confirmarse el match,
#     lo borra y cierra su conversación.
set -euo pipefail

DB="${1:?uso: concurrency_blocks.sh <base de datos>}"
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
waits_for_lock() { # <application_name> <archivo de estado>
  local i
  for ((i = 0; i < 100; i++)); do
    [ -e "$2" ] && return 1
    [ "$(q "select exists (select 1 from pg_stat_activity
                           where application_name = '$1' and wait_event_type = 'Lock')")" = t ] && return 0
    sleep 0.1
  done
  return 1
}

user() { echo "c7000000-0000-0000-0000-0000000000$1"; }

interest() { echo "select public.record_interest('$(user "$1")', '$(user "$2")', 80);"; }
block() { echo "select public.block_user('$(user "$1")', '$(user "$2")');"; }
has_match() {
  q "select exists (select 1 from public.matches m
                    where m.user_a_id = least('$(user "$1")'::uuid, '$(user "$2")'::uuid)
                      and m.user_b_id = greatest('$(user "$1")'::uuid, '$(user "$2")'::uuid))"
}

# Cuatro cuentas activas con el onboarding completo; 02 → 01 y 04 → 03 ya
# enviaron su interés.
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email)
  select ('c7000000-0000-0000-0000-0000000000' || n)::uuid, 'block-concurrency-' || n || '@test'
  from unnest(array['01','02','03','04']) n;
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  select ('c7000000-0000-0000-0000-0000000000' || n)::uuid, 'Bloqueo ' || n, '2000-01-01', 'looking_for_room'
  from unnest(array['01','02','03','04']) n;
insert into public.housing_preferences (profile_id, city_id)
  select ('c7000000-0000-0000-0000-0000000000' || n)::uuid, c.id
  from unnest(array['01','02','03','04']) n, public.cities c where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
  where id::text like 'c7000000-0000-0000-0000-0000000000%';
set role service_role;
select public.record_interest('$(user 02)', '$(user 01)', 80);
select public.record_interest('$(user 04)', '$(user 03)', 80);
SQL

# race <sql A, que se queda abierta> <sql B>: resultado en $WORK/{a,b}.{status,log}
# y $WORK/b.waited.
race() {
  rm -f "$WORK"/a.* "$WORK"/b.*
  mkfifo "$WORK/a.fifo"
  (
    status=0
    PGAPPNAME=cc_a_$$ "${PSQL[@]}" -At <"$WORK/a.fifo" >"$WORK/a.log" 2>&1 || status=$?
    echo "$status" >"$WORK/a.status"
  ) &
  pid_a=$!
  exec 3>"$WORK/a.fifo"
  printf '%s\n' "begin;" "set local role service_role;" "$1" >&3
  wait_until "select exists (select 1 from pg_stat_activity
                              where application_name = 'cc_a_$$' and state = 'idle in transaction')" 10 \
    || fail "la sesión A no llegó a quedarse abierta ($(cat "$WORK/a.log"))"
  (
    status=0
    PGAPPNAME=cc_b_$$ "${PSQL[@]}" -At -c "set lock_timeout = '20s'; set role service_role; $2" \
      >"$WORK/b.log" 2>&1 || status=$?
    echo "$status" >"$WORK/b.status"
  ) &
  pid_b=$!
  if waits_for_lock "cc_b_$$" "$WORK/b.status" && [ ! -e "$WORK/a.status" ]; then
    touch "$WORK/b.waited"
  fi
  [ -e "$WORK/b.waited" ] || wait "$pid_b" || true
  printf '%s\n' "commit;" >&3
  exec 3>&-
  wait "$pid_a" || true
  wait "$pid_b" || true
  pid_a=""
  pid_b=""
}

# CB1: el bloqueo va primero.
race "$(block 02 01)" "$(interest 01 02)"
[ -e "$WORK/b.waited" ] || fail "CB1: el interés no esperó al bloqueo abierto ($(cat "$WORK/b.log"))"
ok "CB1: con block_user abierto, el interés espera el bloqueo de la pareja"
[ "$(cat "$WORK/a.status")" = 0 ] && [ "$(cat "$WORK/a.log")" = blocked ] \
  || fail "CB1: block_user no confirmó con 'blocked' ($(cat "$WORK/a.log"))"
[ "$(cat "$WORK/b.status")" != 0 ] && grep -q "interest_party_invalid:" "$WORK/b.log" \
  || fail "CB1: el interés no se rechazó ($(cat "$WORK/b.log"))"
[ "$(has_match 01 02)" = f ] || fail "CB1: hay match entre dos personas bloqueadas"
ok "CB1: al confirmarse el bloqueo, el interés se rechaza y no hay match"

# CB2: el match va primero.
race "$(interest 03 04)" "$(block 04 03)"
[ -e "$WORK/b.waited" ] || fail "CB2: block_user no esperó al match abierto ($(cat "$WORK/b.log"))"
ok "CB2: con el match abierto, block_user espera"
[ "$(cat "$WORK/a.status")" = 0 ] && [ "$(cat "$WORK/a.log")" = matched ] \
  || fail "CB2: el match no se confirmó ($(cat "$WORK/a.log"))"
[ "$(cat "$WORK/b.status")" = 0 ] && [ "$(cat "$WORK/b.log")" = blocked ] \
  || fail "CB2: block_user no devolvió 'blocked' ($(cat "$WORK/b.log"))"
[ "$(has_match 03 04)" = f ] || fail "CB2: el match sobrevivió al bloqueo"
[ "$(q "select count(*) = 0 from public.conversations c
        join public.conversation_participants p on p.conversation_id = c.id
        where p.user_id = '$(user 03)' and c.closed_at is null")" = t ] \
  || fail "CB2: la conversación del match sigue abierta"
ok "CB2: el bloqueo borra el match recién creado y cierra su conversación"

echo "RESULTADO: concurrency_blocks.sh: ningún match ni chat abierto entre personas bloqueadas"
