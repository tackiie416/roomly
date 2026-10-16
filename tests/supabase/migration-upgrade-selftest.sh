#!/usr/bin/env bash
# Actualización incremental de la Fase 3.1 contra un PostgreSQL LOCAL (nunca
# contra Supabase). tests/db/run.sh aplica todas las migraciones sobre una
# base vacía; aquí se comprueba el otro camino: un esquema de la Fase 2 que
# YA tiene datos (perfiles, preferencias y filas de compatibility_responses
# creadas con los antiguos DEFAULT) recibe después las migraciones nuevas.
#
#   - las migraciones nuevas se aplican sin error sobre datos existentes;
#   - las filas antiguas se conservan tal cual (versión 1, completed_at con
#     valor), siguen cumpliendo las restricciones nuevas y quedan sujetas al
#     trigger (S4) desde ese momento;
#   - una fila antigua de una cuenta eliminada se conserva (el trigger no se
#     dispara al crearlo), pero ya no se puede escribir.
#   - Fase 4.0: las habitaciones anteriores se conservan; la de una cuenta
#     activa se sigue editando y la de una cuenta desactivada ya no.
#   - Fase 4.1: una habitación activa completa y un borrador incompleto pasan
#     la comprobación previa y se conservan; con una habitación que incumple
#     las reglas nuevas, la migración se detiene sin cambiar nada.
#   - Fase 4.1, R1 (barrios oficiales de Barcelona):
#     - en una instalación existente, un barrio oficial que ya estaba se
#       conserva con su id y se añaden los que faltan;
#     - con barrios incompatibles, la migración se detiene sin cambiar nada;
#     - aplicarla otra vez no cambia nada;
#     - en una instalación limpia, las migraciones crean Barcelona y sus
#       barrios, y el seed se aplica después sin duplicar nada.
#
# «Migraciones nuevas» = las posteriores a la última de la Fase 2
# (20261004120100_profiles_privacy.sql).
#
# Conexión: variables estándar de libpq, como tests/db/run.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
DB="migration_upgrade_selftest_$$"
LAST_PHASE2="20261004120100_profiles_privacy.sql"
PHASE41="20261015120000_rooms_integrity_publication.sql"
R1="20261016120000_barcelona_neighborhoods.sql"
# Huella de los barrios de Barcelona con sus id: detecta cualquier cambio.
BARRIS_FP="select count(*) || ':' || md5(string_agg(n.id::text || '|' || n.slug || '|' || n.name, ',' order by n.slug collate \"C\")) from public.neighborhoods n join public.cities c on c.id = n.city_id where c.slug = 'barcelona'"
WORK="$(mktemp -d)"

cleanup() {
  "${ADMIN[@]}" -c "drop database if exists ${DB}" >/dev/null 2>&1 || true
  "${ADMIN[@]}" -c "drop database if exists ${DB}_limpia" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${ADMIN[@]}" -c "create database ${DB}" >/dev/null
P=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB")
"${P[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1

new_migrations=()
for migration in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$migration")"
  if [[ "$name" > "$LAST_PHASE2" ]]; then
    new_migrations+=("$migration")
  else
    "${P[@]}" -f "$migration" >/dev/null
  fi
done
"${P[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null

if [ "${#new_migrations[@]}" -eq 0 ]; then
  echo "FALLO: no hay migraciones posteriores a ${LAST_PHASE2}"
  exit 1
fi

echo "== datos de la Fase 2 (antes de las migraciones nuevas)"
"${P[@]}" <<'SQL'
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-00000000000a', 'up-a@test'),
  ('f0000000-0000-0000-0000-00000000000c', 'up-c@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('f0000000-0000-0000-0000-00000000000a', 'Upgrade A', '2000-01-01', 'looking_for_room'),
  ('f0000000-0000-0000-0000-00000000000c', 'Upgrade C', '2000-01-01', 'flexible');
insert into public.housing_preferences (profile_id, city_id, budget_max)
  select 'f0000000-0000-0000-0000-00000000000a', id, 600 from public.cities where slug = 'barcelona';
-- Con el esquema de la Fase 2: versión y completed_at por DEFAULT.
insert into public.compatibility_responses (profile_id, answers) values
  ('f0000000-0000-0000-0000-00000000000a', '{"clean_frequency": 3}'),
  ('f0000000-0000-0000-0000-00000000000c', '{"clean_frequency": 4}');
-- Con las políticas de habitaciones anteriores a la Fase 4.0 y sin las reglas
-- de la 4.1: la de A, activa y completa (barrio de su ciudad, ocupación y
-- características del catálogo); la de C, un borrador incompleto. El barrio
-- ya es uno oficial (R1): la carga de barrios debe conservarlo con su id.
insert into public.neighborhoods (id, city_id, name, slug)
  select 'f2000000-0000-0000-0000-000000000001', id, 'el Raval', 'el-raval'
  from public.cities where slug = 'barcelona';
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, features, status)
  select 'f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
         'Habitación antigua A', c.id, 'f2000000-0000-0000-0000-000000000001', 500,
         '2026-11-01', 2, 3, array['wifi', 'desk'], 'active'
  from public.cities c where c.slug = 'barcelona';
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
  select 'f1000000-0000-0000-0000-00000000000c', 'f0000000-0000-0000-0000-00000000000c',
         'Habitación antigua C', c.id, 500, '2026-11-01'
  from public.cities c where c.slug = 'barcelona';
update public.profiles set deleted_at = now() where id = 'f0000000-0000-0000-0000-00000000000c';
SQL
echo "   ok - 2 filas de compatibility_responses con los DEFAULT de la Fase 2 y 2 habitaciones"

# Fase 4.1: con datos que incumplen las reglas nuevas, la migración se detiene
# en su comprobación previa y no deja nada a medias (la transacción se aborta).
phase41_refuses() {
  local migration="$1"
  if { echo "begin;"
       cat <<'SQL'
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, status)
  select 'f1000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-00000000000a',
         'Activa sin barrio', c.id, 500, '2026-11-01', 'active'
  from public.cities c where c.slug = 'barcelona';
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, features)
  select 'f1000000-0000-0000-0000-0000000000e2', 'f0000000-0000-0000-0000-00000000000a',
         'Características fuera del catálogo', c.id, 500, '2026-11-01', array['pool', 'pool']
  from public.cities c where c.slug = 'barcelona';
SQL
       cat "$migration"
       echo "commit;"
     } | "${P[@]}" >"$WORK/refuse.log" 2>&1; then
    echo "   FALLO: la 4.1 se aplicó sobre habitaciones que incumplen sus reglas"
    return 1
  fi
  if ! grep -q "rooms_4_1_precheck" "$WORK/refuse.log" \
     || ! grep -q "repetidas: 1;" "$WORK/refuse.log" \
     || ! grep -q "activas sin barrio u ocupación: 1)" "$WORK/refuse.log"; then
    echo "   FALLO: la 4.1 falló, pero no en su comprobación previa:"
    grep -E "ERROR" "$WORK/refuse.log" | head -3
    return 1
  fi
  if [ "$("${P[@]}" -At -c "select count(*) from public.rooms where id::text like 'f1000000-0000-0000-0000-0000000000e%'")" != "0" ] \
     || [ "$("${P[@]}" -At -c "select count(*) from pg_constraint where conname like 'chk_rooms_%' or conname = 'fk_rooms_neighborhood_city'")" != "0" ]; then
    echo "   FALLO: la 4.1 rechazada dejó restos"
    return 1
  fi
  echo "   ok - $(basename "$migration"): con datos que incumplen sus reglas se detiene (rooms_4_1_precheck) sin cambiar nada"
}

# R1: con barrios de Barcelona que no coinciden con ninguno oficial (uno
# inventado, un slug oficial con otro nombre y un nombre oficial con otro slug),
# la carga se detiene en su comprobación previa y no deja nada.
r1_refuses() {
  local migration="$1"
  if { echo "begin;"
       cat <<'SQL'
insert into public.neighborhoods (city_id, name, slug)
  select c.id, v.name, v.slug
  from public.cities c,
       (values ('Barrio inventado', 'barrio-inventado'),
               ('Sants Badal', 'sants-badal'),
               ('la Sagrera', 'sagrera')) as v(name, slug)
  where c.slug = 'barcelona';
SQL
       cat "$migration"
       echo "commit;"
     } | "${P[@]}" >"$WORK/refuse-r1.log" 2>&1; then
    echo "   FALLO: la carga de barrios se aplicó sobre barrios incompatibles"
    return 1
  fi
  if ! grep -q "neighborhoods_r1_precheck: Barcelona tiene 3 barrios que no coinciden" "$WORK/refuse-r1.log" \
     || ! grep -q "barrio-inventado (Barrio inventado)" "$WORK/refuse-r1.log" \
     || ! grep -q "sagrera (la Sagrera)" "$WORK/refuse-r1.log" \
     || ! grep -q "sants-badal (Sants Badal)" "$WORK/refuse-r1.log"; then
    echo "   FALLO: la carga de barrios falló, pero no en su comprobación previa:"
    grep -E "ERROR" "$WORK/refuse-r1.log" | head -3
    return 1
  fi
  if [ "$("${P[@]}" -At -c "$BARRIS_FP")" != "$barris_before" ]; then
    echo "   FALLO: la carga de barrios rechazada dejó restos"
    return 1
  fi
  echo "   ok - $(basename "$migration"): con barrios incompatibles se detiene (neighborhoods_r1_precheck) sin cambiar nada"
}

echo "== migraciones nuevas sobre esos datos"
for migration in "${new_migrations[@]}"; do
  if [ "$(basename "$migration")" = "$PHASE41" ]; then
    phase41_refuses "$migration"
  fi
  if [ "$(basename "$migration")" = "$R1" ]; then
    barris_before="$("${P[@]}" -At -c "$BARRIS_FP")"
    if [ "${barris_before%%:*}" != "1" ]; then
      echo "   FALLO: antes de la carga, Barcelona debía tener solo el barrio de la Fase 2 (${barris_before})"
      exit 1
    fi
    r1_refuses "$migration"
  fi
  "${P[@]}" -f "$migration" >/dev/null
  echo "   ok - $(basename "$migration") aplicada"
done

# R1 es idempotente: aplicarla otra vez no cambia ningún barrio.
barris_loaded="$("${P[@]}" -At -c "$BARRIS_FP")"
"${P[@]}" -f "$ROOT/supabase/migrations/$R1" >/dev/null
if [ "${barris_loaded%%:*}" != "73" ] || [ "$("${P[@]}" -At -c "$BARRIS_FP")" != "$barris_loaded" ]; then
  echo "   FALLO: aplicar $R1 otra vez cambió los barrios (${barris_loaded})"
  exit 1
fi
echo "   ok - $R1 aplicada otra vez: los 73 barrios, sin cambios"
"${P[@]}" -f "$ROOT/tests/db/helpers.sql" >/dev/null

echo "== comprobaciones"
"${P[@]}" 2>&1 <<'SQL' | sed -n 's/^psql:[^:]*:[0-9]*: //; s/^NOTICE:  /   /p; s/^ERROR:  /   ERROR: /p'
select roomly_test.ok(
  (select count(*) = 2 from public.compatibility_responses
   where questionnaire_version = 1 and completed_at is not null),
  'UP1: las filas antiguas se conservan (versión 1, completed_at con valor)');
select roomly_test.ok(
  (select answers = '{"clean_frequency": 3}' from public.compatibility_responses
   where profile_id = 'f0000000-0000-0000-0000-00000000000a'),
  'UP1: sus respuestas no cambian');
set role service_role;
select roomly_test.expect_error(
  $$update public.compatibility_responses set completed_at = null
    where profile_id = 'f0000000-0000-0000-0000-00000000000a'$$,
  '23514', 'UP2: una fila antigua completada queda sujeta a S4');
select roomly_test.expect_affected(
  $$update public.compatibility_responses
    set questionnaire_version = 2, completed_at = null
    where profile_id = 'f0000000-0000-0000-0000-00000000000a'$$,
  1, 'UP3: y puede pasar a borrador de una versión nueva (S5)');
select roomly_test.expect_error(
  $$update public.compatibility_responses set answers = '{}'
    where profile_id = 'f0000000-0000-0000-0000-00000000000c'$$,
  '23514', 'UP4: la fila antigua de una cuenta eliminada ya no se puede escribir');
reset role;
select roomly_test.ok(
  (select count(*) = 44 from pg_policies where schemaname = 'public'),
  'UP5: 44 políticas (37 hasta la 4.0)');
select roomly_test.ok(
  (select count(*) = 2 from public.rooms
   where id in ('f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000c')),
  'UP6: las habitaciones anteriores se conservan');
set role authenticated;
select roomly_test.login('f0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Habitación antigua A, editada'
    where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  1, 'UP6: su propietaria activa la sigue editando');
select roomly_test.login('f0000000-0000-0000-0000-00000000000c');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = 'f1000000-0000-0000-0000-00000000000c'$$,
  1, 'UP7: la cuenta desactivada sigue viendo su habitación');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Reactivada'
    where id = 'f1000000-0000-0000-0000-00000000000c'$$,
  0, 'UP7: pero ya no la escribe');
reset role;
select roomly_test.ok(
  (select status = 'active' and neighborhood_id = 'f2000000-0000-0000-0000-000000000001'
          and total_roommates = 2 and total_rooms = 3 and features = array['wifi', 'desk']
   from public.rooms where id = 'f1000000-0000-0000-0000-00000000000a')
  and (select status = 'draft' and neighborhood_id is null and total_rooms is null
       from public.rooms where id = 'f1000000-0000-0000-0000-00000000000c'),
  'UP8: la 4.1 conserva la habitación activa completa y el borrador incompleto tal cual');
set role authenticated;
select roomly_test.login('f0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$update public.rooms set neighborhood_id = null
    where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514', 'UP9: desde la 4.1, la habitación activa anterior no puede quedarse sin barrio');
select roomly_test.expect_error(
  $$update public.rooms set deleted_at = now()
    where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '42501', 'UP9: ni su propietaria escribe deleted_at');
reset role;
select roomly_test.ok(
  (select count(*) = 73 and md5(string_agg(n.slug || '|' || n.name, chr(10) order by n.slug collate "C"))
                          = '9847876cf9e43791d3ad0a206f28813a'
   from public.neighborhoods n join public.cities c on c.id = n.city_id where c.slug = 'barcelona'),
  'UP10: Barcelona tiene exactamente los 73 barrios oficiales (la huella de P1)');
select roomly_test.ok(
  (select id = 'f2000000-0000-0000-0000-000000000001' from public.neighborhoods where slug = 'el-raval')
  and (select count(*) = 1 from public.cities where slug = 'barcelona'),
  'UP10: el barrio oficial que ya existía conserva su id, y Barcelona sigue siendo una');
SQL

echo "== instalación limpia: migraciones → seed (R1)"
"${ADMIN[@]}" -c "create database ${DB}_limpia" >/dev/null
L=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "${DB}_limpia")
"${L[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${L[@]}" -f "$migration" >/dev/null
done
clean_city="$("${L[@]}" -At -c "select count(*) || ':' || string_agg(name || '|' || is_active || '|' || center_lat || '|' || center_lng, ',') from public.cities")"
clean_barris="$("${L[@]}" -At -c "$BARRIS_FP")"
if [ "$clean_city" != "1:Barcelona|true|41.3874|2.1686" ] || [ "${clean_barris%%:*}" != "73" ]; then
  echo "   FALLO: sin el seed, las migraciones debían crear Barcelona y sus 73 barrios (${clean_city}; ${clean_barris%%:*})"
  exit 1
fi
echo "   ok - sin el seed, las migraciones crean Barcelona (valores del seed) y sus 73 barrios"
"${L[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
if [ "$("${L[@]}" -At -c "select count(*) from public.cities")" != "9" ] \
   || [ "$("${L[@]}" -At -c "select count(*) from public.cities where slug = 'barcelona'")" != "1" ] \
   || [ "$("${L[@]}" -At -c "select count(*) from public.universities")" != "7" ] \
   || [ "$("${L[@]}" -At -c "$BARRIS_FP")" != "$clean_barris" ]; then
  echo "   FALLO: el seed después de las migraciones duplicó o cambió algo"
  exit 1
fi
echo "   ok - el seed después: 9 ciudades, Barcelona una sola vez, 7 universidades y los mismos barrios"
"${L[@]}" -f "$ROOT/supabase/migrations/$R1" >/dev/null
if [ "$("${L[@]}" -At -c "$BARRIS_FP")" != "$clean_barris" ]; then
  echo "   FALLO: aplicar $R1 otra vez tras el seed cambió los barrios"
  exit 1
fi
echo "   ok - $R1 otra vez, tras el seed: sin cambios"

echo "RESULTADO: las migraciones nuevas se aplican sobre datos de la Fase 2 y los conservan, y una instalación limpia carga los barrios antes del seed"
