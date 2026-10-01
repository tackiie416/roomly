-- Fase 2.5 — 20260930140000_phase2_preferences_integrity.sql.
-- Debe fallar si, con el onboarding completado, las preferencias pueden
-- quedarse sin ciudad o borrarse desde el cliente; si antes del onboarding
-- deja de poderse; si una universidad de otra ciudad se acepta; o si el
-- servidor pierde el borrado (cascada del perfil).
-- I: onboarding incompleto · C: onboarding completado · U: completado, para
-- universidades · S: completado, sus preferencias las borra el servidor.

reset role;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1', 'pi-i@test'),
  ('a0000000-0000-0000-0000-00000000000c', 'pi-c@test'),
  ('a0000000-0000-0000-0000-0000000000b2', 'pi-u@test'),
  ('a0000000-0000-0000-0000-0000000000d3', 'pi-s@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Incompleto', '2000-01-01', 'looking_for_room'),
  ('a0000000-0000-0000-0000-00000000000c', 'Completo', '2000-01-01', 'looking_for_room'),
  ('a0000000-0000-0000-0000-0000000000b2', 'Universidad', '2000-01-01', 'looking_for_room'),
  ('a0000000-0000-0000-0000-0000000000d3', 'Servidor', '2000-01-01', 'looking_for_room');
insert into public.housing_preferences (profile_id, city_id, budget_max)
  select v.id::uuid, c.id, 600
  from (values ('a0000000-0000-0000-0000-0000000000a1'),
               ('a0000000-0000-0000-0000-00000000000c'),
               ('a0000000-0000-0000-0000-0000000000b2'),
               ('a0000000-0000-0000-0000-0000000000d3')) as v(id)
  cross join public.cities c where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
  where id in ('a0000000-0000-0000-0000-00000000000c',
               'a0000000-0000-0000-0000-0000000000b2',
               'a0000000-0000-0000-0000-0000000000d3');
-- Universidades de prueba: una de Madrid y una sin ciudad (p. ej. online).
insert into public.universities (id, city_id, name, slug)
  select 'a1000000-0000-0000-0000-000000000001'::uuid, id, 'Madrid test', 'madrid-test'
  from public.cities where slug = 'madrid';
insert into public.universities (id, city_id, name, slug)
  values ('a1000000-0000-0000-0000-000000000002', null, 'Online test', 'online-test');

-- ------------------------------------------------------------
-- 1. Antes del onboarding: todo opcional, también borrar.
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('a0000000-0000-0000-0000-0000000000a1');
select roomly_test.expect_affected(
  $$update public.housing_preferences set city_id = null, budget_max = null
    where profile_id = 'a0000000-0000-0000-0000-0000000000a1'$$,
  1, 'PI1: antes del onboarding se puede quitar la ciudad (campos opcionales)');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = 'a0000000-0000-0000-0000-0000000000a1'$$,
  1, 'PI2: antes del onboarding se pueden borrar las preferencias');
select roomly_test.expect_affected(
  $$insert into public.housing_preferences (profile_id, field_of_study)
    values ('a0000000-0000-0000-0000-0000000000a1', 'Derecho')$$,
  1, 'PI3: antes del onboarding se crean sin ciudad');

-- ------------------------------------------------------------
-- 2. Después del onboarding: ciudad obligatoria, sin borrado del cliente.
-- ------------------------------------------------------------
select roomly_test.login('a0000000-0000-0000-0000-00000000000c');
select roomly_test.expect_error(
  $$update public.housing_preferences set city_id = null
    where profile_id = 'a0000000-0000-0000-0000-00000000000c'$$,
  '23514', 'PC1: con el onboarding completado no se puede quitar la ciudad');
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set budget_min = 300, budget_max = 25000, field_of_study = 'Física',
        move_in_date = '2026-10-01', move_out_date = null,
        roommates_wanted_min = 1, roommates_wanted_max = 12, university_id = null
    where profile_id = 'a0000000-0000-0000-0000-00000000000c'$$,
  1, 'PC2: el resto de campos se edita (y se vacía) con normalidad, sin techos');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = 'a0000000-0000-0000-0000-00000000000c'$$,
  0, 'PC3: con el onboarding completado el cliente no borra sus preferencias');
reset role;
select roomly_test.ok(
  (select city_id is not null and budget_max = 25000
   from public.housing_preferences
   where profile_id = 'a0000000-0000-0000-0000-00000000000c'),
  'PC4: la fila sigue ahí, con ciudad y con los cambios válidos');

-- El servidor (service_role) tampoco deja las preferencias sin ciudad
-- (invariante de los datos), pero sí puede borrarlas y borrar el perfil en
-- cascada (borrado de cuenta futuro).
set role service_role;
select roomly_test.expect_error(
  $$update public.housing_preferences set city_id = null
    where profile_id = 'a0000000-0000-0000-0000-0000000000d3'$$,
  '23514', 'PS1: tampoco el servidor quita la ciudad de un onboarding completado');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = 'a0000000-0000-0000-0000-0000000000d3'$$,
  1, 'PS2: el servidor sí puede borrar las preferencias');

-- Sin fila (la borró el servidor), el cliente no puede recrearla sin ciudad.
set role authenticated;
select roomly_test.login('a0000000-0000-0000-0000-0000000000d3');
select roomly_test.expect_error(
  $$insert into public.housing_preferences (profile_id, field_of_study)
    values ('a0000000-0000-0000-0000-0000000000d3', 'Derecho')$$,
  '23514', 'PC5: con el onboarding completado no se crean preferencias sin ciudad');
select roomly_test.expect_affected(
  $$insert into public.housing_preferences (profile_id, city_id)
    select 'a0000000-0000-0000-0000-0000000000d3', id from public.cities
    where slug = 'barcelona'$$,
  1, 'PC6: con ciudad sí se pueden recrear');

reset role;
select roomly_test.expect_affected(
  $$delete from public.profiles where id = 'a0000000-0000-0000-0000-0000000000d3'$$,
  1, 'PS3: el borrado del perfil sigue borrando sus preferencias en cascada');
select roomly_test.ok(
  not exists (select 1 from public.housing_preferences
              where profile_id = 'a0000000-0000-0000-0000-0000000000d3'),
  'PS3: sin preferencias huérfanas');

-- ------------------------------------------------------------
-- 3. Universidad ↔ ciudad.
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('a0000000-0000-0000-0000-0000000000b2');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set university_id = 'a1000000-0000-0000-0000-000000000001'
    where profile_id = 'a0000000-0000-0000-0000-0000000000b2'$$,
  '23514', 'PU1: una universidad de otra ciudad se rechaza');
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set university_id = (select id from public.universities where slug = 'upc')
    where profile_id = 'a0000000-0000-0000-0000-0000000000b2'$$,
  1, 'PU2: una universidad de la misma ciudad se acepta');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set city_id = (select id from public.cities where slug = 'madrid')
    where profile_id = 'a0000000-0000-0000-0000-0000000000b2'$$,
  '23514', 'PU3: cambiar de ciudad dejando la universidad de la anterior se rechaza');
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set city_id = (select id from public.cities where slug = 'madrid'),
        university_id = 'a1000000-0000-0000-0000-000000000001'
    where profile_id = 'a0000000-0000-0000-0000-0000000000b2'$$,
  1, 'PU4: cambiar ciudad y universidad a la vez, coherentes, se acepta');
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set university_id = 'a1000000-0000-0000-0000-000000000002'
    where profile_id = 'a0000000-0000-0000-0000-0000000000b2'$$,
  1, 'PU5: una universidad sin ciudad vale con cualquier ciudad');
select roomly_test.expect_error(
  $$update public.housing_preferences set university_id = gen_random_uuid()
    where profile_id = 'a0000000-0000-0000-0000-0000000000b2'$$,
  '23503', 'PU6: una universidad inexistente la sigue rechazando la FK');

-- Barrios ↔ ciudad tras el onboarding (el trigger de 2.0 sigue actuando).
reset role;
insert into public.neighborhoods (id, city_id, name, slug)
  select 'a2000000-0000-0000-0000-000000000001'::uuid, id, 'Gràcia pi', 'gracia-pi'
  from public.cities where slug = 'barcelona';
set role authenticated;
select roomly_test.login('a0000000-0000-0000-0000-0000000000b2');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set preferred_neighborhood_ids = array['a2000000-0000-0000-0000-000000000001'::uuid]
    where profile_id = 'a0000000-0000-0000-0000-0000000000b2'$$,
  '23514', 'PN1: un barrio de otra ciudad se rechaza');

-- ------------------------------------------------------------
-- 4. Estructura.
-- ------------------------------------------------------------
reset role;
select roomly_test.ok(
  (select count(*) = 2 from pg_trigger
   where tgrelid = 'public.housing_preferences'::regclass and not tgisinternal
     and tgenabled <> 'D'
     and tgname in ('trg_housing_preferences_city_required',
                    'trg_housing_preferences_university')),
  'PX1: los dos triggers nuevos existen y están activos');
select roomly_test.ok(
  (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""']
                   and not has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p
   where p.oid in ('public.enforce_housing_city_after_onboarding()'::regprocedure,
                   'public.enforce_housing_preferences_university()'::regprocedure)),
  'PX2: SECURITY INVOKER, search_path vacío, sin EXECUTE para authenticated');
select roomly_test.ok(
  (select qual like '%onboarding_completed_at IS NULL%' and qual like '%deleted_at IS NULL%'
   from pg_policies
   where schemaname = 'public' and tablename = 'housing_preferences'
     and policyname = 'housing_preferences_delete_own'),
  'PX3: la política de DELETE exige cuenta activa y onboarding sin completar');
select roomly_test.ok(
  (select count(*) = 38 from pg_policies where schemaname = 'public'),
  'PX4: siguen 38 políticas');
