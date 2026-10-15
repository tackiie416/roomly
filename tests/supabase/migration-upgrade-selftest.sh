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

cleanup() { "${ADMIN[@]}" -c "drop database if exists ${DB}" >/dev/null 2>&1 || true; }
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
-- Con las políticas de habitaciones anteriores a la Fase 4.0.
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, status)
  select v.id, v.owner_id, v.title, c.id, 500, '2026-11-01', 'active'
  from public.cities c,
       (values ('f1000000-0000-0000-0000-00000000000a'::uuid, 'f0000000-0000-0000-0000-00000000000a'::uuid, 'Habitación antigua A'),
               ('f1000000-0000-0000-0000-00000000000c'::uuid, 'f0000000-0000-0000-0000-00000000000c'::uuid, 'Habitación antigua C'))
         as v(id, owner_id, title)
  where c.slug = 'barcelona';
update public.profiles set deleted_at = now() where id = 'f0000000-0000-0000-0000-00000000000c';
SQL
echo "   ok - 2 filas de compatibility_responses con los DEFAULT de la Fase 2 y 2 habitaciones"

echo "== migraciones nuevas sobre esos datos"
for migration in "${new_migrations[@]}"; do
  "${P[@]}" -f "$migration" >/dev/null
  echo "   ok - $(basename "$migration") aplicada"
done
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
SQL

echo "RESULTADO: las migraciones nuevas se aplican sobre datos de la Fase 2 y los conservan"
