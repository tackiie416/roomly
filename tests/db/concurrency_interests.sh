#!/usr/bin/env bash
# Fase 5.1 — dos personas se envían «Me interesa» a la vez, con dos sesiones de
# verdad (20261126120000_interests_matches_server_only.sql).
#
# Lo lanza tests/db/run.sh sobre su base de datos temporal, después de los
# tests SQL: uso, concurrency_interests.sh <base de datos>. Solo local: la
# suite SQL remota ejecuta un archivo por sesión y no puede abrir dos.
#
# Debe fallar si el match mutuo puede perderse: cada una comprobaría el
# interés de la otra antes de que se confirme, y las dos se quedarían en
# 'sent' sin match. record_interest bloquea la pareja (pg_advisory_xact_lock)
# antes de mirar:
#   - CI1: con el interés A→B abierto, B→A espera el bloqueo y, al confirmarse
#     A→B, devuelve 'matched' y crea el match (uno solo);
#   - CI2-control: sin el bloqueo (función cambiada de forma temporal y
#     restaurada), la misma carrera deja los dos intereses sin match: el
#     resultado depende del bloqueo, no del orden;
#   - CI0: fuera de READ COMMITTED, la función se niega (interest_isolation).
set -euo pipefail

DB="${1:?uso: concurrency_interests.sh <base de datos>}"
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

user() { echo "c1000000-0000-0000-0000-0000000000$1"; }
call() { echo "select public.record_interest('$(user "$1")', '$(user "$2")', 80);"; }
pair_state() { # <a> <b>: intereses de la pareja y matches
  q "select (select count(*) from public.interests
              where from_user_id in ('$(user "$1")', '$(user "$2")')
                and to_user_id in ('$(user "$1")', '$(user "$2")'))
         || ',' ||
         (select count(*) from public.matches
              where user_a_id = least('$(user "$1")'::uuid, '$(user "$2")'::uuid)
                and user_b_id = greatest('$(user "$1")'::uuid, '$(user "$2")'::uuid))"
}

# Seis cuentas activas con el onboarding completo (tres parejas).
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email)
  select ('c1000000-0000-0000-0000-0000000000' || n)::uuid, 'interest-concurrency-' || n || '@test'
  from unnest(array['01','02','03','04','05','06']) n;
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  select ('c1000000-0000-0000-0000-0000000000' || n)::uuid, 'Interés ' || n, '2000-01-01', 'looking_for_room'
  from unnest(array['01','02','03','04','05','06']) n;
insert into public.housing_preferences (profile_id, city_id)
  select ('c1000000-0000-0000-0000-0000000000' || n)::uuid, c.id
  from unnest(array['01','02','03','04','05','06']) n, public.cities c where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
  where id::text like 'c1000000-0000-0000-0000-0000000000%';
SQL
[ "$(q "select count(*) from public.profiles
        where id::text like 'c1000000-%' and onboarding_completed_at is not null")" = 6 ] \
  || fail "preparación: las seis cuentas debían tener el onboarding completo"

# CI0: en REPEATABLE READ la instantánea no vería el interés de la otra persona.
if "${PSQL[@]}" -At >"$WORK/ci0.log" 2>&1 <<SQL; then
begin isolation level repeatable read;
set local role service_role;
$(call 05 06)
commit;
SQL
  fail "CI0: en REPEATABLE READ la función registró el interés ($(cat "$WORK/ci0.log"))"
fi
grep -q "interest_isolation:" "$WORK/ci0.log" || fail "CI0: rechazo por otro motivo ($(cat "$WORK/ci0.log"))"
[ "$(pair_state 05 06)" = "0,0" ] || fail "CI0: el rechazo dejó filas"
ok "CI0: fuera de READ COMMITTED la función se niega (interest_isolation) sin escribir nada"

# race <a> <b>: A envía a→b y se queda abierta; B envía b→a. Resultado en
# $WORK/{a,b}.{status,log} y $WORK/b.waited.
race() {
  rm -f "$WORK"/a.* "$WORK"/b.*
  mkfifo "$WORK/a.fifo"
  (
    status=0
    PGAPPNAME=ci_a_$$ "${PSQL[@]}" -At <"$WORK/a.fifo" >"$WORK/a.log" 2>&1 || status=$?
    echo "$status" >"$WORK/a.status"
  ) &
  pid_a=$!
  exec 3>"$WORK/a.fifo"
  printf '%s\n' "begin;" "set local role service_role;" "$(call "$1" "$2")" >&3
  wait_until "select exists (select 1 from pg_stat_activity
                              where application_name = 'ci_a_$$' and state = 'idle in transaction')" 10 \
    || fail "la sesión A no llegó a quedarse abierta ($(cat "$WORK/a.log"))"
  (
    status=0
    PGAPPNAME=ci_b_$$ "${PSQL[@]}" -At -c "set lock_timeout = '20s'; set role service_role; $(call "$2" "$1")" \
      >"$WORK/b.log" 2>&1 || status=$?
    echo "$status" >"$WORK/b.status"
  ) &
  pid_b=$!
  if waits_for_lock "ci_b_$$" "$WORK/b.status" && [ ! -e "$WORK/a.status" ]; then
    touch "$WORK/b.waited"
  fi
  # En el control, B no espera: termina antes de que A confirme.
  [ -e "$WORK/b.waited" ] || wait "$pid_b" || true
  printf '%s\n' "commit;" >&3
  exec 3>&-
  wait "$pid_a" || true
  wait "$pid_b" || true
  pid_a=""
  pid_b=""
}

race 01 02
[ -e "$WORK/b.waited" ] || fail "CI1: B→A no esperó al interés abierto de A→B ($(cat "$WORK/b.log"))"
ok "CI1: con A→B abierto, B→A espera el bloqueo de la pareja"
[ "$(cat "$WORK/a.status")" = 0 ] && [ "$(cat "$WORK/a.log")" = sent ] \
  || fail "CI1: A→B no confirmó con 'sent' ($(cat "$WORK/a.log"))"
[ "$(cat "$WORK/b.status")" = 0 ] && [ "$(cat "$WORK/b.log")" = matched ] \
  || fail "CI1: B→A no devolvió 'matched' ($(cat "$WORK/b.log"))"
[ "$(pair_state 01 02)" = "2,1" ] || fail "CI1: se esperaban 2 intereses y 1 match ($(pair_state 01 02))"
ok "CI1: al confirmarse A→B, B→A crea el match (2 intereses, 1 match)"

# CI2-control: la misma carrera sin el bloqueo.
q "select pg_get_functiondef('public.record_interest(uuid,uuid,integer,uuid)'::regprocedure)" >"$WORK/original.sql"
grep -q "pg_advisory_xact_lock" "$WORK/original.sql" || fail "CI2: la función no tiene el bloqueo que se quería quitar"
sed 's/perform pg_advisory_xact_lock(.*);/null;/' "$WORK/original.sql" >"$WORK/unlocked.sql"
grep -q "pg_advisory_xact_lock" "$WORK/unlocked.sql" && fail "CI2: no se pudo quitar el bloqueo"
"${PSQL[@]}" -f "$WORK/unlocked.sql" >/dev/null
restore() { "${PSQL[@]}" -f "$WORK/original.sql" >/dev/null; }
race 03 04 || { restore; exit 1; }
restore
grep -q "pg_advisory_xact_lock" <<<"$(q "select pg_get_functiondef('public.record_interest(uuid,uuid,integer,uuid)'::regprocedure)")" \
  || fail "CI2: la función no quedó restaurada"
[ ! -e "$WORK/b.waited" ] && [ "$(cat "$WORK/a.log")" = sent ] && [ "$(cat "$WORK/b.log")" = sent ] \
  && [ "$(pair_state 03 04)" = "2,0" ] \
  || fail "CI2: sin el bloqueo se esperaba la carrera (2 intereses, 0 matches); hubo $(pair_state 03 04), A «$(cat "$WORK/a.log")», B «$(cat "$WORK/b.log")»"
ok "CI2-control: sin el bloqueo, los dos se quedan en 'sent' sin match (la carrera existe; restaurada la función)"

echo "RESULTADO: concurrency_interests.sh: el match mutuo no se pierde con envíos simultáneos"
