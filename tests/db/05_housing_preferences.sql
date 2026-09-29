-- Fase 2.0 — RLS, GRANT por columnas y CHECKs de housing_preferences.
-- Debe fallar si alguien vuelve a permitir escribir preferencias ajenas,
-- reasignar profile_id, guardar datos fuera de rango o dejar
-- preferred_neighborhood_ids incoherente con neighborhoods (en cualquiera de
-- las dos direcciones).

reset role;
insert into auth.users (id, email) values
  ('50000000-0000-0000-0000-00000000000a', 'hp-a@test'),
  ('50000000-0000-0000-0000-00000000000b', 'hp-b@test');
insert into public.profiles (id, full_name, date_of_birth) values
  ('50000000-0000-0000-0000-00000000000a', 'HP A', '2000-01-01'),
  ('50000000-0000-0000-0000-00000000000b', 'HP B', '2000-01-01');
-- Preferencias de B creadas por el servidor, para probar el acceso ajeno.
insert into public.housing_preferences (profile_id, field_of_study)
  values ('50000000-0000-0000-0000-00000000000b', 'Medicina');

set role authenticated;
select roomly_test.login('50000000-0000-0000-0000-00000000000a');

-- 1. Crear las propias preferencias (ciudad y universidad del seed).
select roomly_test.expect_affected(
  $$insert into public.housing_preferences
      (profile_id, city_id, university_id, field_of_study, budget_min, budget_max,
       roommates_wanted_min, roommates_wanted_max)
    select '50000000-0000-0000-0000-00000000000a', c.id, u.id, 'Ingeniería', 300, 600, 1, 3
    from public.cities c join public.universities u on u.city_id = c.id
    where c.slug = 'barcelona' and u.slug = 'upc'$$,
  1, 'HP1: un usuario crea sus propias preferencias');

-- 2. Actualizar las propias preferencias.
select roomly_test.expect_affected(
  $$update public.housing_preferences set budget_max = 700, field_of_study = 'Arquitectura'
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP2: un usuario actualiza sus propias preferencias');

-- 3. No crear preferencias en nombre de otra persona.
reset role;
delete from public.housing_preferences where profile_id = '50000000-0000-0000-0000-00000000000b';
set role authenticated;
select roomly_test.login('50000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$insert into public.housing_preferences (profile_id)
    values ('50000000-0000-0000-0000-00000000000b')$$,
  '42501', 'HP3: un usuario NO puede crear preferencias con el profile_id de otro');
reset role;
insert into public.housing_preferences (profile_id, field_of_study)
  values ('50000000-0000-0000-0000-00000000000b', 'Medicina');
set role authenticated;
select roomly_test.login('50000000-0000-0000-0000-00000000000a');

-- 4. No reasignar las propias preferencias a otra persona.
select roomly_test.expect_error(
  $$update public.housing_preferences set profile_id = '50000000-0000-0000-0000-00000000000b'
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '42501', 'HP4: un usuario NO puede reasignar sus preferencias (profile_id fuera del GRANT de UPDATE)');

-- 5. No ver ni modificar preferencias ajenas.
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences where profile_id = '50000000-0000-0000-0000-00000000000b'$$,
  0, 'HP5a: un usuario NO ve las preferencias de otro');
select roomly_test.expect_affected(
  $$update public.housing_preferences set field_of_study = 'Suplantado'
    where profile_id = '50000000-0000-0000-0000-00000000000b'$$,
  0, 'HP5b: un usuario NO puede modificar las preferencias de otro');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences where profile_id = '50000000-0000-0000-0000-00000000000b'$$,
  0, 'HP5c: un usuario NO puede borrar las preferencias de otro');

-- upsert: se rechaza igual que en profiles (PR8), sin relajar permisos.
select roomly_test.expect_error(
  $$insert into public.housing_preferences (profile_id, budget_max)
    values ('50000000-0000-0000-0000-00000000000a', 800)
    on conflict (profile_id) do update set profile_id = excluded.profile_id, budget_max = excluded.budget_max$$,
  '42501', 'HP-upsert: ON CONFLICT DO UPDATE que incluye profile_id se rechaza');

-- 6 y 7. Número de compañeros.
select roomly_test.expect_error(
  $$update public.housing_preferences set roommates_wanted_min = -1, roommates_wanted_max = 2
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP6: roommates_wanted_min < 0 se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences set roommates_wanted_min = 3, roommates_wanted_max = 2
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP7: roommates_wanted_max < roommates_wanted_min se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences set roommates_wanted_min = null, roommates_wanted_max = -1
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP7b: roommates_wanted_max < 0 se rechaza');
-- Sin techo (decisión de producto: la especificación no lo define).
select roomly_test.expect_affected(
  $$update public.housing_preferences set roommates_wanted_min = 1, roommates_wanted_max = 12
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP7c: un número alto de compañeros (12) ya no se rechaza');
select roomly_test.expect_affected(
  $$update public.housing_preferences set roommates_wanted_min = 1, roommates_wanted_max = 3
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP7c: se restauran los compañeros de A');

-- Presupuesto.
select roomly_test.expect_error(
  $$update public.housing_preferences set budget_min = null, budget_max = -5
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP-budget: budget_max negativo se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences set budget_min = -1
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP-budget: budget_min negativo se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences set budget_min = 800, budget_max = 700
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP-budget: budget_min > budget_max se rechaza');
-- Sin techo (decisión de producto: la especificación no lo define).
select roomly_test.expect_affected(
  $$update public.housing_preferences set budget_min = 300, budget_max = 15000
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP-budget: un presupuesto alto (15 000) ya no se rechaza');
select roomly_test.expect_affected(
  $$update public.housing_preferences set budget_min = 300, budget_max = 700
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP-budget: se restaura el presupuesto de A');

-- 8. Textos y tamaños fuera de límite.
select roomly_test.expect_error(
  $$update public.housing_preferences set field_of_study = repeat('x', 121)
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP8a: field_of_study de más de 120 caracteres se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences set field_of_study = '   '
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP8b: field_of_study vacío o solo espacios se rechaza');

-- 9 y 10. Referencias inexistentes.
select roomly_test.expect_error(
  $$update public.housing_preferences set city_id = gen_random_uuid()
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23503', 'HP9: una ciudad inexistente se rechaza (FK)');
select roomly_test.expect_error(
  $$update public.housing_preferences set university_id = gen_random_uuid()
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23503', 'HP10: una universidad inexistente se rechaza (FK)');

-- Tras todos los intentos, la fila propia sigue siendo coherente.
select roomly_test.ok(
  (select budget_max = 700 and field_of_study = 'Arquitectura'
          and roommates_wanted_min = 1 and roommates_wanted_max = 3
   from public.housing_preferences where profile_id = '50000000-0000-0000-0000-00000000000a'),
  'HP: los intentos rechazados no alteraron las preferencias propias');

-- ------------------------------------------------------------
-- 11 y 12. Integridad de preferred_neighborhood_ids (trigger).
-- Barrios de prueba: dos de Barcelona (uno lo usará A), uno de Madrid y uno
-- de Barcelona que nadie usa.
-- ------------------------------------------------------------
reset role;
insert into public.neighborhoods (id, city_id, name, slug)
select v.id::uuid, c.id, v.name, v.slug
from (values
  ('5b000000-0000-0000-0000-000000000001', 'barcelona', 'Gràcia test', 'gracia-test'),
  ('5b000000-0000-0000-0000-000000000002', 'barcelona', 'Sants test', 'sants-test'),
  ('5b000000-0000-0000-0000-000000000003', 'madrid', 'Lavapiés test', 'lavapies-test'),
  ('5b000000-0000-0000-0000-000000000004', 'barcelona', 'Sin uso test', 'sin-uso-test')
) as v(id, city_slug, name, slug)
join public.cities c on c.slug = v.city_slug;

set role authenticated;
select roomly_test.login('50000000-0000-0000-0000-00000000000a');

select roomly_test.expect_affected(
  $$update public.housing_preferences set preferred_neighborhood_ids = '{}', city_id = null
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP-barrios: array vacío se acepta (también sin ciudad)');
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set city_id = (select id from public.cities where slug = 'barcelona'),
        preferred_neighborhood_ids = array['5b000000-0000-0000-0000-000000000001'::uuid,
                                           '5b000000-0000-0000-0000-000000000002'::uuid]
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP-barrios: barrios existentes de la ciudad elegida se aceptan');

select roomly_test.expect_error(
  $$update public.housing_preferences
    set preferred_neighborhood_ids = array[gen_random_uuid()]
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23503', 'HP11: un barrio inexistente se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set preferred_neighborhood_ids = array['5b000000-0000-0000-0000-000000000001'::uuid, null]
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23503', 'HP11b: un elemento NULL en la lista de barrios se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set preferred_neighborhood_ids = array['5b000000-0000-0000-0000-000000000003'::uuid]
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP12: un barrio de otra ciudad se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set city_id = (select id from public.cities where slug = 'madrid')
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP12b: cambiar de ciudad dejando barrios de la anterior se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set city_id = null
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP12c: barrios sin ciudad elegida se rechazan');
-- Sin límite de cantidad (decisión de producto): muchos barrios válidos se
-- aceptan; el trigger sigue comprobando cada uno.
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set preferred_neighborhood_ids = array_fill('5b000000-0000-0000-0000-000000000001'::uuid, array[25])
                                     || '5b000000-0000-0000-0000-000000000002'::uuid
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP8c: una lista larga de barrios válidos (26) ya no se rechaza');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set preferred_neighborhood_ids = array_fill('5b000000-0000-0000-0000-000000000001'::uuid, array[25])
                                     || '5b000000-0000-0000-0000-000000000003'::uuid
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  '23514', 'HP8d: en una lista larga, un solo barrio de otra ciudad se rechaza');
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set preferred_neighborhood_ids = array['5b000000-0000-0000-0000-000000000001'::uuid,
                                           '5b000000-0000-0000-0000-000000000002'::uuid]
    where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  1, 'HP8c: se restauran los barrios de A');
select roomly_test.expect_affected(
  $$update public.housing_preferences set preferred_neighborhood_ids = '{}'
    where profile_id = '50000000-0000-0000-0000-00000000000b'$$,
  0, 'HP-barrios: A tampoco puede tocar los barrios de B');

select roomly_test.ok(
  (select preferred_neighborhood_ids = array['5b000000-0000-0000-0000-000000000001'::uuid,
                                             '5b000000-0000-0000-0000-000000000002'::uuid]
          and city_id = (select id from public.cities where slug = 'barcelona')
   from public.housing_preferences where profile_id = '50000000-0000-0000-0000-00000000000a'),
  'HP-barrios: los intentos rechazados no alteraron ciudad ni barrios');

-- Integridad inversa: administrar barrios que alguien usa.
-- Como el servidor/migraciones (sin RLS) ...
reset role;
select roomly_test.expect_error(
  $$update public.neighborhoods
    set city_id = (select id from public.cities where slug = 'madrid')
    where id = '5b000000-0000-0000-0000-000000000001'$$,
  '23503', 'HP-inv1: mover de ciudad un barrio en uso se rechaza');
select roomly_test.expect_error(
  $$delete from public.neighborhoods where id = '5b000000-0000-0000-0000-000000000001'$$,
  '23503', 'HP-inv2: borrar un barrio en uso se rechaza');
select roomly_test.expect_error(
  $$update public.neighborhoods set id = gen_random_uuid()
    where id = '5b000000-0000-0000-0000-000000000002'$$,
  '23503', 'HP-inv3: cambiar el id de un barrio en uso se rechaza');

-- ... y como un admin autenticado, que por RLS NO ve las preferencias de A:
-- el trigger debe detectar el uso igualmente (SECURITY DEFINER).
insert into auth.users (id, email) values ('50000000-0000-0000-0000-0000000000ad', 'hp-admin@test');
insert into public.profiles (id, full_name, date_of_birth, role)
  values ('50000000-0000-0000-0000-0000000000ad', 'HP Admin', '1990-01-01', 'admin');
set role authenticated;
select roomly_test.login('50000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences where profile_id = '50000000-0000-0000-0000-00000000000a'$$,
  0, 'HP-inv: el admin no ve las preferencias de A (sin política de admin)');
select roomly_test.expect_error(
  $$delete from public.neighborhoods where id = '5b000000-0000-0000-0000-000000000001'$$,
  '23503', 'HP-inv4: un admin tampoco puede borrar un barrio en uso');
select roomly_test.expect_error(
  $$update public.neighborhoods
    set city_id = (select id from public.cities where slug = 'madrid')
    where id = '5b000000-0000-0000-0000-000000000002'$$,
  '23503', 'HP-inv5: un admin tampoco puede mover de ciudad un barrio en uso');

-- Lo que no afecta a ninguna preferencia sigue permitido.
select roomly_test.expect_affected(
  $$update public.neighborhoods set name = 'Gràcia test renombrado'
    where id = '5b000000-0000-0000-0000-000000000001'$$,
  1, 'HP-inv6: renombrar un barrio en uso sí se permite');
select roomly_test.expect_affected(
  $$delete from public.neighborhoods where id = '5b000000-0000-0000-0000-000000000004'$$,
  1, 'HP-inv7: borrar un barrio que nadie usa sí se permite');

reset role;
select roomly_test.ok(
  (select count(*) = 3 from public.neighborhoods where id::text like '5b000000-%'),
  'HP-inv: los barrios en uso siguen existiendo');
select roomly_test.ok(
  (select city_id = (select id from public.cities where slug = 'barcelona')
   from public.neighborhoods where id = '5b000000-0000-0000-0000-000000000001')
  and (select city_id = (select id from public.cities where slug = 'barcelona')
       from public.neighborhoods where id = '5b000000-0000-0000-0000-000000000002'),
  'HP-inv: los barrios en uso siguen en su ciudad');
select roomly_test.ok(
  (select preferred_neighborhood_ids = array['5b000000-0000-0000-0000-000000000001'::uuid,
                                             '5b000000-0000-0000-0000-000000000002'::uuid]
   from public.housing_preferences where profile_id = '50000000-0000-0000-0000-00000000000a'),
  'HP-inv: las preferencias de A siguen intactas');

-- Un usuario normal no puede administrar barrios (RLS de referencia).
set role authenticated;
select roomly_test.login('50000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$delete from public.neighborhoods where id = '5b000000-0000-0000-0000-000000000003'$$,
  0, 'HP-inv8: un usuario normal no puede borrar barrios');

-- anon: ningún privilegio sobre la tabla.
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$select 1 from public.housing_preferences$$,
  '42501', 'HP-anon: anon no puede leer preferencias');
select roomly_test.expect_error(
  $$insert into public.housing_preferences (profile_id)
    values ('50000000-0000-0000-0000-00000000000a')$$,
  '42501', 'HP-anon: anon no puede crear preferencias');

reset role;
select roomly_test.ok(
  (select field_of_study = 'Medicina' from public.housing_preferences
   where profile_id = '50000000-0000-0000-0000-00000000000b'),
  'HP: las preferencias de B siguen intactas');
