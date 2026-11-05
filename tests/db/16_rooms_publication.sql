-- Fase 4.1 — Habitaciones: integridad, catálogo, ocupación, publicación y
-- columnas reservadas al servidor (20261015120000_rooms_integrity_publication.sql).
-- Debe fallar si:
--   - una habitación puede tener un barrio de otra ciudad (INSERT, UPDATE del
--     barrio o de la ciudad) o un barrio en uso puede cambiar de ciudad;
--   - `features` acepta claves fuera del catálogo, repetidas o NULL, o deja de
--     aceptar alguna clave del catálogo o el array vacío;
--   - la ocupación admite negativos o `total_rooms = 0`;
--   - se puede publicar (o dejar `active`) una habitación sin barrio u
--     ocupación, o un borrador deja de poder estar incompleto;
--   - el cliente puede escribir `status` al crear, `deleted_at`, las fechas,
--     `approx_lat`/`approx_lng`, `id` u `owner_id` al editar, o pierde las
--     columnas que necesita; anon recupera escrituras, o service_role pierde
--     las suyas.
--
-- O: propietaria activa · D: desactivada desde el principio, con un borrador
-- completo creado como servidor · X: admin.
--
-- Por qué las negativas fallan por la regla y no por otra cosa:
--   - cada rechazo exige su SQLSTATE: 23514 (CHECK), 23503 (FK) o 42501
--     (GRANT o RLS); los rechazos de CHECK y FK se repiten como service_role
--     (sin RLS ni GRANT por columnas) con el mismo resultado;
--   - antes de cada negativa, la misma fila acepta un cambio válido, y cada
--     UPDATE que afecta a 0 filas va precedido de la comprobación de que la
--     fila es visible;
--   - el bloque final (RK) retira de forma temporal cada restricción, dentro de
--     una transacción que se deshace, y comprueba que entonces la escritura
--     rechazada entra.

reset role;
insert into auth.users (id, email) values
  ('16000000-0000-0000-0000-00000000000a', 'pub-o@test'),
  ('16000000-0000-0000-0000-00000000000d', 'pub-d@test'),
  ('16000000-0000-0000-0000-0000000000ad', 'pub-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('16000000-0000-0000-0000-00000000000a', 'Propietaria O', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, deleted_at) values
  ('16000000-0000-0000-0000-00000000000d', 'Desactivada D', '2000-01-01', 'has_room_looking_for_roommate', now());
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('16000000-0000-0000-0000-0000000000ad', 'Admin', '1990-01-01', 'looking_for_room', 'admin');
-- Barrios de prueba: dos de Barcelona y uno de Madrid.
insert into public.neighborhoods (id, city_id, name, slug)
select v.id::uuid, c.id, v.name, v.slug
from (values
  ('16300000-0000-0000-0000-000000000001', 'barcelona', 'Barrio pub 1 test', 'barrio-pub-1-test'),
  ('16300000-0000-0000-0000-000000000002', 'barcelona', 'Barrio pub 2 test', 'barrio-pub-2-test'),
  ('16300000-0000-0000-0000-0000000000a1', 'madrid', 'Barrio pub Madrid test', 'barrio-pub-madrid-test')
) as v(id, city_slug, name, slug)
join public.cities c on c.slug = v.city_slug;
-- El borrador de D, completo, creado como servidor.
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms)
  select '16100000-0000-0000-0000-0000000000d1', '16000000-0000-0000-0000-00000000000d',
         'Borrador de D', c.id, '16300000-0000-0000-0000-000000000001', 400, '2026-11-01', 1, 2
  from public.cities c where c.slug = 'barcelona';

-- ------------------------------------------------------------
-- 0. Estructura
-- ------------------------------------------------------------
select roomly_test.ok(
  (select array_agg(c.conname::text order by c.conname)
   from pg_constraint c
   where c.conrelid = 'public.rooms'::regclass and c.contype = 'c' and c.convalidated)
  = array['chk_deposit_nonneg', 'chk_price_positive', 'chk_rooms_features_catalog',
          'chk_rooms_features_unique', 'chk_rooms_publishable', 'chk_rooms_total_roommates',
          'chk_rooms_total_rooms', 'chk_stay_range']
  and not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.rooms'::regclass and not c.convalidated),
  'RS1: rooms tiene exactamente sus 8 CHECK, todas validadas');
select roomly_test.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.rooms'::regclass and c.conname = 'fk_rooms_neighborhood_city'
      and c.contype = 'f' and c.confrelid = 'public.neighborhoods'::regclass
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['neighborhood_id', 'city_id']
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(c.confkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
          = array['id', 'city_id'])
  and exists (select 1 from pg_constraint c
              where c.conrelid = 'public.neighborhoods'::regclass
                and c.conname = 'neighborhoods_id_city_id_key' and c.contype = 'u'),
  'RS2: la FK compuesta barrio ↔ ciudad y su clave única existen');
select roomly_test.ok(
  (select array_agg(m[1] order by m[1])
   from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') as m
   where c.conrelid = 'public.rooms'::regclass and c.conname = 'chk_rooms_features_catalog')
  = (select array_agg(k order by k) from unnest(array[
      'wifi', 'heating', 'air_conditioning', 'elevator', 'washing_machine', 'dishwasher',
      'balcony', 'furnished', 'private_bathroom', 'double_bed', 'desk', 'exterior']) as k)
  and (select array_agg(distinct m[1] order by m[1])
       from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') as m
       where c.conrelid = 'public.rooms'::regclass and c.conname = 'chk_rooms_features_unique')
  = (select array_agg(k order by k) from unnest(array[
      'wifi', 'heating', 'air_conditioning', 'elevator', 'washing_machine', 'dishwasher',
      'balcony', 'furnished', 'private_bathroom', 'double_bed', 'desk', 'exterior']) as k),
  'RS3: el catálogo de la base de datos es exactamente el de las 12 claves aprobadas');
select roomly_test.ok(
  not has_table_privilege('authenticated', 'public.rooms', 'INSERT')
  and not has_table_privilege('authenticated', 'public.rooms', 'UPDATE')
  and has_table_privilege('authenticated', 'public.rooms', 'SELECT')
  and has_table_privilege('authenticated', 'public.rooms', 'DELETE')
  and (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
       where a.attrelid = 'public.rooms'::regclass and a.attnum > 0 and not a.attisdropped
         and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT'))
    = 'available_from,city_id,deposit_amount,description,expenses_included,features,house_rules,id,max_stay_months,min_stay_months,neighborhood_id,owner_id,pets_allowed,price_month,roommate_preferences,smoking_allowed,students_only,title,total_roommates,total_rooms'
  and (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
       where a.attrelid = 'public.rooms'::regclass and a.attnum > 0 and not a.attisdropped
         and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))
    = 'available_from,city_id,deposit_amount,description,expenses_included,features,house_rules,max_stay_months,min_stay_months,neighborhood_id,pets_allowed,price_month,roommate_preferences,smoking_allowed,status,students_only,title,total_roommates,total_rooms',
  'RS4: authenticated escribe por columnas: sin status al crear, sin deleted_at, fechas, approx_*, ni id/owner_id al editar');
select roomly_test.ok(
  has_table_privilege('anon', 'public.rooms', 'SELECT')
  and not has_any_column_privilege('anon', 'public.rooms', 'INSERT')
  and not has_any_column_privilege('anon', 'public.rooms', 'UPDATE')
  and not has_table_privilege('anon', 'public.rooms', 'DELETE')
  and has_table_privilege('service_role', 'public.rooms', 'INSERT')
  and has_table_privilege('service_role', 'public.rooms', 'UPDATE')
  and has_table_privilege('service_role', 'public.rooms', 'DELETE'),
  'RS5: anon solo lee; service_role conserva INSERT, UPDATE y DELETE de tabla completa');

-- ------------------------------------------------------------
-- 1. R6 — Catálogo cerrado de características
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, features)
    select '16100000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-00000000000a',
           'Con todo', c.id, 450, '2026-11-01',
           array['wifi', 'heating', 'air_conditioning', 'elevator', 'washing_machine', 'dishwasher',
                 'balcony', 'furnished', 'private_bathroom', 'double_bed', 'desk', 'exterior']
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RC1: se aceptan las 12 claves del catálogo (cada una, a la vez)');
select roomly_test.expect_affected(
  $$update public.rooms set features = '{}' where id = '16100000-0000-0000-0000-000000000001'$$,
  1, 'RC2: y el array vacío');
select roomly_test.expect_affected(
  $$update public.rooms set features = array['wifi', 'desk']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  1, 'RC2: y un subconjunto');
select roomly_test.expect_error(
  $$update public.rooms set features = array['wifi', 'pool']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  '23514', 'RC3: una clave fuera del catálogo se rechaza');
select roomly_test.expect_error(
  $$update public.rooms set features = array['WiFi']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  '23514', 'RC4: las claves distinguen mayúsculas: «WiFi» no es «wifi»');
select roomly_test.expect_error(
  $$update public.rooms set features = array['wifi', 'desk', 'wifi']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  '23514', 'RC5: una clave repetida se rechaza');
select roomly_test.expect_error(
  $$update public.rooms set features = array['wifi', null]
    where id = '16100000-0000-0000-0000-000000000001'$$,
  '23514', 'RC6: un NULL dentro del array se rechaza');
select roomly_test.expect_error(
  $$update public.rooms set features = array['pets_allowed']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  '23514', 'RC7: mascotas, tabaco y solo estudiantes no son características (son columnas propias)');
reset role;
set role service_role;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$update public.rooms set features = array['pool']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  '23514', 'RC8: también como servidor: la regla es de la base de datos, no de Zod ni de la RLS');
select roomly_test.expect_error(
  $$update public.rooms set features = array['desk', 'desk']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  '23514', 'RC8: ni repetidas como servidor');
reset role;
select roomly_test.ok(
  (select features = array['wifi', 'desk'] from public.rooms
   where id = '16100000-0000-0000-0000-000000000001'),
  'RC9: los rechazos no cambiaron las características');

-- ------------------------------------------------------------
-- 2. R9 — Ocupación
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '16100000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-00000000000a',
           'Borrador sin ocupación', c.id, 400, '2026-12-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RT1: un borrador puede crearse sin ocupación ni barrio');
select roomly_test.expect_affected(
  $$update public.rooms set total_roommates = 0, total_rooms = 1
    where id = '16100000-0000-0000-0000-000000000002'$$,
  1, 'RT2: cero compañeros y un dormitorio son válidos');
select roomly_test.expect_error(
  $$update public.rooms set total_roommates = -1
    where id = '16100000-0000-0000-0000-000000000002'$$,
  '23514', 'RT3: total_roommates negativo se rechaza');
select roomly_test.expect_error(
  $$update public.rooms set total_rooms = 0
    where id = '16100000-0000-0000-0000-000000000002'$$,
  '23514', 'RT4: total_rooms = 0 se rechaza');
select roomly_test.expect_error(
  $$update public.rooms set total_rooms = -2
    where id = '16100000-0000-0000-0000-000000000002'$$,
  '23514', 'RT4: y negativo');
reset role;
set role service_role;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$update public.rooms set total_rooms = 0
    where id = '16100000-0000-0000-0000-000000000002'$$,
  '23514', 'RT5: también como servidor');
reset role;
select roomly_test.ok(
  (select total_roommates = 0 and total_rooms = 1 from public.rooms
   where id = '16100000-0000-0000-0000-000000000002'),
  'RT6: la ocupación válida sigue intacta');

-- ------------------------------------------------------------
-- 3. R1 — El barrio es de la ciudad de la habitación
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month, available_from)
    select '16100000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a',
           'Barrio ajeno', c.id, '16300000-0000-0000-0000-0000000000a1', 400, '2026-12-01'
    from public.cities c where c.slug = 'barcelona'$$,
  '23503', 'RN1: una habitación de Barcelona no puede tener un barrio de Madrid');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month, available_from)
    select '16100000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a',
           'Barrio ajeno', c.id, '16300000-0000-0000-0000-000000000001', 400, '2026-12-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RN1-control: con un barrio de Barcelona, la misma fila entra');
select roomly_test.expect_affected(
  $$update public.rooms set neighborhood_id = '16300000-0000-0000-0000-000000000002'
    where id = '16100000-0000-0000-0000-000000000003'$$,
  1, 'RN2-control: cambiar a otro barrio de la misma ciudad se permite');
select roomly_test.expect_error(
  $$update public.rooms set neighborhood_id = '16300000-0000-0000-0000-0000000000a1'
    where id = '16100000-0000-0000-0000-000000000003'$$,
  '23503', 'RN2: ni cambiar el barrio por uno de otra ciudad');
select roomly_test.expect_error(
  $$update public.rooms set city_id = (select c.id from public.cities c where c.slug = 'madrid')
    where id = '16100000-0000-0000-0000-000000000003'$$,
  '23503', 'RN3: ni cambiar solo la ciudad y dejar el barrio de la anterior');
select roomly_test.expect_affected(
  $$update public.rooms
    set city_id = (select c.id from public.cities c where c.slug = 'madrid'),
        neighborhood_id = '16300000-0000-0000-0000-0000000000a1'
    where id = '16100000-0000-0000-0000-000000000003'$$,
  1, 'RN4: cambiar ciudad y barrio a la vez, coherentes, se permite');
select roomly_test.expect_affected(
  $$update public.rooms
    set city_id = (select c.id from public.cities c where c.slug = 'barcelona'),
        neighborhood_id = null
    where id = '16100000-0000-0000-0000-000000000003'$$,
  1, 'RN5: un borrador puede quedarse sin barrio');
reset role;
set role service_role;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$update public.rooms set neighborhood_id = '16300000-0000-0000-0000-0000000000a1'
    where id = '16100000-0000-0000-0000-000000000003'$$,
  '23503', 'RN6: también como servidor');
reset role;
-- La habitación 16…0d1 (D, Barcelona) usa el barrio 1.
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update public.neighborhoods set name = 'Barrio pub 1 test, renombrado'
    where id = '16300000-0000-0000-0000-000000000001'$$,
  1, 'RN7-control: un admin puede renombrar un barrio en uso');
select roomly_test.expect_error(
  $$update public.neighborhoods
    set city_id = (select c.id from public.cities c where c.slug = 'madrid')
    where id = '16300000-0000-0000-0000-000000000001'$$,
  '23503', 'RN7: ni un admin mueve de ciudad un barrio que usa una habitación');
select roomly_test.expect_error(
  $$delete from public.neighborhoods where id = '16300000-0000-0000-0000-000000000001'$$,
  '23503', 'RN8: ni lo borra');
reset role;
select roomly_test.ok(
  (select city_id = (select c.id from public.cities c where c.slug = 'barcelona')
   from public.neighborhoods where id = '16300000-0000-0000-0000-000000000001')
  and (select city_id = (select c.id from public.cities c where c.slug = 'barcelona')
              and neighborhood_id is null
       from public.rooms where id = '16100000-0000-0000-0000-000000000003'),
  'RN9: el barrio y la habitación siguen coherentes');

-- ------------------------------------------------------------
-- 4. R7 — Requisitos para publicar
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '16100000-0000-0000-0000-000000000010', '16000000-0000-0000-0000-00000000000a',
           'Para publicar', c.id, 500, '2026-11-15'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RP1: un borrador incompleto se guarda');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '16100000-0000-0000-0000-000000000010' and status = 'draft'$$,
  1, 'RP1: nace draft');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP2: sin barrio ni ocupación no se publica');
select roomly_test.expect_affected(
  $$update public.rooms set neighborhood_id = '16300000-0000-0000-0000-000000000001'
    where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP3-control: añade el barrio (sigue draft)');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP3: con barrio pero sin ocupación, tampoco');
select roomly_test.expect_affected(
  $$update public.rooms set total_roommates = 2 where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP4-control: añade total_roommates');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP4: sin total_rooms, tampoco');
select roomly_test.expect_affected(
  $$update public.rooms set total_roommates = null, total_rooms = 3
    where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP4b-control: con total_rooms y sin total_roommates (sigue draft)');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP4b: sin total_roommates, tampoco');
select roomly_test.expect_affected(
  $$update public.rooms set total_roommates = 2, status = 'active'
    where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP5: completa, se publica');
select roomly_test.expect_error(
  $$update public.rooms set total_rooms = null where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP6: una habitación activa no puede perder total_rooms');
select roomly_test.expect_error(
  $$update public.rooms set total_roommates = null where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP6: ni total_roommates');
select roomly_test.expect_error(
  $$update public.rooms set neighborhood_id = null where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP6: ni el barrio');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Para publicar, editada', price_month = 520,
                            features = array['wifi', 'furnished']
    where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP7: activa, sigue editando el resto de campos');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'paused' where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP8: la pausa');
select roomly_test.expect_affected(
  $$update public.rooms set total_rooms = null where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP8: pausada puede quedar incompleta (la regla es solo para active)');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-000000000010'$$,
  '23514', 'RP8: y no se reactiva hasta completarla');
select roomly_test.expect_affected(
  $$update public.rooms set total_rooms = 3, status = 'active'
    where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RP8: completa, se reactiva');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                              available_from, total_roommates, total_rooms, status)
    select '16100000-0000-0000-0000-000000000011', '16000000-0000-0000-0000-00000000000a',
           'Directa a active', c.id, '16300000-0000-0000-0000-000000000001', 500,
           '2026-11-15', 1, 2, 'active'
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RP9: el cliente no fija status al crear, ni completa (status fuera del GRANT de INSERT)');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                              available_from, total_roommates, total_rooms)
    select '16100000-0000-0000-0000-000000000011', '16000000-0000-0000-0000-00000000000a',
           'Directa a active', c.id, '16300000-0000-0000-0000-000000000001', 500,
           '2026-11-15', 1, 2
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RP9-control: la misma fila sin status entra (como draft)');
select roomly_test.expect_affected(
  $$delete from public.rooms where id = '16100000-0000-0000-0000-000000000011'$$,
  1, 'RP9: y la propietaria puede borrar su borrador');

-- Un admin y el servidor tampoco publican una habitación incompleta.
select roomly_test.login('16000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '16100000-0000-0000-0000-000000000002'$$,
  1, 'RP10: el admin ve el borrador incompleto de O');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-000000000002'$$,
  '23514', 'RP10: ni un admin publica una habitación sin barrio');
reset role;
set role service_role;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, status)
    select '16100000-0000-0000-0000-000000000012', '16000000-0000-0000-0000-00000000000a',
           'Servidor incompleta', c.id, 500, '2026-11-15', 'active'
    from public.cities c where c.slug = 'barcelona'$$,
  '23514', 'RP11: ni el servidor crea una habitación activa incompleta');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                              available_from, total_roommates, total_rooms, status)
    select '16100000-0000-0000-0000-000000000012', '16000000-0000-0000-0000-00000000000a',
           'Servidor completa', c.id, '16300000-0000-0000-0000-000000000002', 500,
           '2026-11-15', 0, 1, 'active'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RP11-control: completa, el servidor sí la crea activa');
reset role;

-- La cuenta desactivada no publica su borrador completo (RLS de la 4.0).
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-00000000000d');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '16100000-0000-0000-0000-0000000000d1'$$,
  1, 'RP12: D ve su borrador completo');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-0000000000d1'$$,
  0, 'RP12: pero, desactivada, no lo publica');
reset role;
select roomly_test.ok(
  (select status = 'draft' from public.rooms where id = '16100000-0000-0000-0000-0000000000d1')
  and (select status = 'draft' from public.rooms where id = '16100000-0000-0000-0000-000000000002')
  and (select status = 'active' and total_rooms = 3 and total_roommates = 2
              and neighborhood_id = '16300000-0000-0000-0000-000000000001'
       from public.rooms where id = '16100000-0000-0000-0000-000000000010'),
  'RP13: los rechazos no cambiaron ningún estado');

-- ------------------------------------------------------------
-- 5. Columnas reservadas al servidor
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, deleted_at)
    select '16100000-0000-0000-0000-000000000020', '16000000-0000-0000-0000-00000000000a',
           'Reservada', c.id, 400, '2026-12-01', now()
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RG1: el cliente no fija deleted_at al crear');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, approx_lat, approx_lng)
    select '16100000-0000-0000-0000-000000000020', '16000000-0000-0000-0000-00000000000a',
           'Reservada', c.id, 400, '2026-12-01', 41.4, 2.17
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RG1: ni las coordenadas aproximadas');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, created_at, updated_at)
    select '16100000-0000-0000-0000-000000000020', '16000000-0000-0000-0000-00000000000a',
           'Reservada', c.id, 400, '2026-12-01', '2020-01-01', '2020-01-01'
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RG1: ni las fechas');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '16100000-0000-0000-0000-000000000020', '16000000-0000-0000-0000-00000000000a',
           'Reservada', c.id, 400, '2026-12-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RG1-control: la misma fila, sin las columnas reservadas, entra');
select roomly_test.expect_error(
  $$update public.rooms set deleted_at = now() where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG2: el propietario no escribe deleted_at');
select roomly_test.expect_error(
  $$update public.rooms set approx_lat = 41.4 where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG2: ni approx_lat');
select roomly_test.expect_error(
  $$update public.rooms set approx_lng = 2.17 where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG2: ni approx_lng');
select roomly_test.expect_error(
  $$update public.rooms set created_at = '2020-01-01' where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG2: ni created_at');
select roomly_test.expect_error(
  $$update public.rooms set updated_at = '2020-01-01' where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG2: ni updated_at');
select roomly_test.expect_error(
  $$update public.rooms set owner_id = '16000000-0000-0000-0000-00000000000a'
    where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG2: ni owner_id, ni siquiera con su propio id');
select roomly_test.expect_error(
  $$update public.rooms set id = '16100000-0000-0000-0000-000000000021'
    where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG2: ni id');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '16100000-0000-0000-0000-000000000020', '16000000-0000-0000-0000-00000000000a',
           'Upsert', c.id, 400, '2026-12-01'
    from public.cities c where c.slug = 'barcelona'
    on conflict (id) do update set title = excluded.title, owner_id = excluded.owner_id$$,
  '42501', 'RG3: un upsert que reescribe owner_id (como supabase-js) se rechaza');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Reservada, editada', description = 'Luminosa',
                            house_rules = 'Sin fiestas', status = 'rented'
    where id = '16100000-0000-0000-0000-000000000020'$$,
  1, 'RG4: sí escribe los datos del anuncio y el estado');
reset role;
select roomly_test.ok(
  (select deleted_at is null and approx_lat is null and approx_lng is null
          and owner_id = '16000000-0000-0000-0000-00000000000a'
          and title = 'Reservada, editada' and status = 'rented'
   from public.rooms where id = '16100000-0000-0000-0000-000000000020'),
  'RG5: las columnas reservadas siguen sin tocar');

-- Un admin modera desde el cliente, pero tampoco escribe columnas reservadas.
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'removed' where id = '16100000-0000-0000-0000-000000000020'$$,
  1, 'RG6: un admin sigue moderando (removed)');
select roomly_test.expect_error(
  $$update public.rooms set deleted_at = now() where id = '16100000-0000-0000-0000-000000000020'$$,
  '42501', 'RG6: pero el borrado lógico es del servidor (el GRANT es por rol, como en profiles)');
reset role;

-- anon no escribe ni por GRANT.
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RG7: anon ve la habitación activa de O');
select roomly_test.expect_error(
  $$update public.rooms set title = 'Anónima' where id = '16100000-0000-0000-0000-000000000010'$$,
  '42501', 'RG7: pero no la edita');
reset role;

-- ------------------------------------------------------------
-- 6. Control negativo (RK): sin cada restricción, la escritura rechazada entra
-- ------------------------------------------------------------
reset role;
begin;
alter table public.rooms drop constraint chk_rooms_features_catalog;
alter table public.rooms drop constraint chk_rooms_features_unique;
alter table public.rooms drop constraint chk_rooms_total_roommates;
alter table public.rooms drop constraint chk_rooms_total_rooms;
alter table public.rooms drop constraint chk_rooms_publishable;
alter table public.rooms drop constraint fk_rooms_neighborhood_city;
grant update (deleted_at) on public.rooms to authenticated;
set role authenticated;
select roomly_test.login('16000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set features = array['pool', 'wifi', 'wifi']
    where id = '16100000-0000-0000-0000-000000000001'$$,
  1, 'RK1: sin los CHECK de catálogo, entrarían claves desconocidas y repetidas');
select roomly_test.expect_affected(
  $$update public.rooms set total_roommates = -1, total_rooms = 0
    where id = '16100000-0000-0000-0000-000000000002'$$,
  1, 'RK2: sin los CHECK de ocupación, entraría una ocupación imposible');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '16100000-0000-0000-0000-000000000003'$$,
  1, 'RK3: sin chk_rooms_publishable, se publicaría una habitación incompleta');
select roomly_test.expect_affected(
  $$update public.rooms set neighborhood_id = '16300000-0000-0000-0000-0000000000a1'
    where id = '16100000-0000-0000-0000-000000000010'$$,
  1, 'RK4: sin la FK compuesta, entraría un barrio de otra ciudad');
select roomly_test.expect_affected(
  $$update public.rooms set deleted_at = now() where id = '16100000-0000-0000-0000-000000000001'$$,
  1, 'RK5: con deleted_at en el GRANT, el propietario lo escribiría');
reset role;
rollback;

select roomly_test.ok(
  (select count(*) = 8 from pg_constraint c
   where c.conrelid = 'public.rooms'::regclass and c.contype = 'c')
  and exists (select 1 from pg_constraint c
              where c.conrelid = 'public.rooms'::regclass and c.conname = 'fk_rooms_neighborhood_city')
  and not has_column_privilege('authenticated', 'public.rooms', 'deleted_at', 'UPDATE'),
  'RK6: las restricciones y el GRANT vuelven a estar como antes');
select roomly_test.ok(
  (select features = array['wifi', 'desk'] and deleted_at is null from public.rooms
   where id = '16100000-0000-0000-0000-000000000001')
  and (select total_roommates = 0 and total_rooms = 1 from public.rooms
       where id = '16100000-0000-0000-0000-000000000002')
  and (select status = 'draft' from public.rooms where id = '16100000-0000-0000-0000-000000000003')
  and (select neighborhood_id = '16300000-0000-0000-0000-000000000001' from public.rooms
       where id = '16100000-0000-0000-0000-000000000010'),
  'RK7: y lo que se escribió se deshizo');
