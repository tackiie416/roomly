#!/usr/bin/env bash
# Fase 6 — deshacer un match mientras se envía un mensaje, con dos sesiones de
# verdad (20261127120000_chat_between_matches.sql).
#
# Lo lanza tests/db/run.sh sobre su base de datos temporal, después de los
# tests SQL: uso, concurrency_chat.sh <base de datos>. Solo local.
#
# Debe fallar si un mensaje puede entrar en un chat que se está cerrando:
#   - CC1: con undo_match abierto (la conversación ya marcada como cerrada,
#     sin confirmar), el mensaje espera el bloqueo de la conversación y, al
#     confirmarse el cierre, se rechaza (message_conversation_closed);
#   - CC2: con el mensaje abierto, undo_match espera y, al confirmarse el
#     mensaje, cierra el chat: el mensaje queda antes del cierre, nunca
#     después.
set -euo pipefail

DB="${1:?uso: concurrency_chat.sh <base de datos>}"
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

user() { echo "c6000000-0000-0000-0000-0000000000$1"; }
conv() { # <a> <b>: conversación del match (abierta o cerrada) de la pareja
  q "select c.id from public.conversations c
     join public.matches m on m.id = c.match_id
     where m.user_a_id = least('$(user "$1")'::uuid, '$(user "$2")'::uuid)
       and m.user_b_id = greatest('$(user "$1")'::uuid, '$(user "$2")'::uuid)"
}
send() { echo "insert into public.messages (conversation_id, sender_id, content) values ('$1', '$(user "$2")', 'a la vez');"; }
undo() { echo "select public.undo_match('$(user "$1")', '$(user "$2")');"; }

# Cuatro cuentas activas con el onboarding completo y dos matches.
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email)
  select ('c6000000-0000-0000-0000-0000000000' || n)::uuid, 'chat-concurrency-' || n || '@test'
  from unnest(array['01','02','03','04']) n;
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  select ('c6000000-0000-0000-0000-0000000000' || n)::uuid, 'Chat ' || n, '2000-01-01', 'looking_for_room'
  from unnest(array['01','02','03','04']) n;
insert into public.housing_preferences (profile_id, city_id)
  select ('c6000000-0000-0000-0000-0000000000' || n)::uuid, c.id
  from unnest(array['01','02','03','04']) n, public.cities c where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
  where id::text like 'c6000000-0000-0000-0000-0000000000%';
set role service_role;
select public.record_interest('$(user 01)', '$(user 02)', 80);
select public.record_interest('$(user 02)', '$(user 01)', 80);
select public.record_interest('$(user 03)', '$(user 04)', 80);
select public.record_interest('$(user 04)', '$(user 03)', 80);
SQL
CONV_12="$(conv 01 02)"
CONV_34="$(conv 03 04)"
[ -n "$CONV_12" ] && [ -n "$CONV_34" ] || fail "preparación: los dos matches debían abrir su conversación"

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

count_messages() { q "select count(*) from public.messages where conversation_id = '$1'"; }

# CC1: el cierre va primero.
race "$(undo 01 02)" "$(send "$CONV_12" 02)"
[ -e "$WORK/b.waited" ] || fail "CC1: el mensaje no esperó al cierre abierto ($(cat "$WORK/b.log"))"
ok "CC1: con undo_match abierto, el mensaje espera el bloqueo de la conversación"
[ "$(cat "$WORK/a.status")" = 0 ] && [ "$(cat "$WORK/a.log")" = undone ] \
  || fail "CC1: undo_match no confirmó con 'undone' ($(cat "$WORK/a.log"))"
[ "$(cat "$WORK/b.status")" != 0 ] && grep -q "message_conversation_closed:" "$WORK/b.log" \
  || fail "CC1: el mensaje no se rechazó por el chat cerrado ($(cat "$WORK/b.log"))"
[ "$(count_messages "$CONV_12")" = 0 ] || fail "CC1: el mensaje entró en el chat cerrado"
ok "CC1: al confirmarse el cierre, el mensaje se rechaza (message_conversation_closed) y no entra"

# CC2: el mensaje va primero.
race "$(send "$CONV_34" 03)" "$(undo 03 04)"
[ -e "$WORK/b.waited" ] || fail "CC2: undo_match no esperó al mensaje abierto ($(cat "$WORK/b.log"))"
ok "CC2: con el mensaje abierto, undo_match espera"
[ "$(cat "$WORK/a.status")" = 0 ] || fail "CC2: el mensaje no se confirmó ($(cat "$WORK/a.log"))"
[ "$(cat "$WORK/b.status")" = 0 ] && [ "$(cat "$WORK/b.log")" = undone ] \
  || fail "CC2: undo_match no devolvió 'undone' ($(cat "$WORK/b.log"))"
[ "$(q "select (select count(*) from public.messages m where m.conversation_id = c.id
                and m.created_at <= c.closed_at) = 1 and c.match_id is null
        from public.conversations c where c.id = '$CONV_34'")" = t ] \
  || fail "CC2: se esperaba un mensaje anterior al cierre y el chat cerrado"
ok "CC2: el mensaje queda antes del cierre y el chat se cierra después"

echo "RESULTADO: concurrency_chat.sh: ningún mensaje entra en un chat que se está cerrando"
