-- Fase 4.2 (sesión 65) — Una habitación solo se borra desde el servidor
-- (20261030120000_rooms_delete_server_only.sql).
-- Debe fallar si:
--   - un cliente (anon, la propietaria o un admin) vuelve a borrar filas de
--     rooms directamente, con DELETE o con TRUNCATE;
--   - un cliente puede llamar a delete_own_room;
--   - service_role pierde sus privilegios sobre rooms o el EXECUTE de la
--     función;
--   - la función borra la habitación de otra persona, la de una cuenta
--     desactivada o inexistente, o sin los dos parámetros;
--   - la función devuelve otras rutas que las de las filas reales de
--     room_images, o no aborta ante una ruta no canónica;
--   - un fallo deja algo borrado a medias.
-- La carrera con una subida simultánea, con dos sesiones de verdad, está en
-- tests/db/concurrency_room_delete.sh.
--
-- A: propietaria activa · B: otro usuario · D: propietaria que se desactiva
-- · X: admin. Las fotos las escribe service_role, el único escritor. Los
-- objetos de Storage (shim) se nombran como sus rutas: la función no los toca;
-- los borra después el servidor.

reset role;
insert into auth.users (id, email) values
  ('21000000-0000-0000-0000-00000000000a', 'delete-a@test'),
  ('21000000-0000-0000-0000-00000000000b', 'delete-b@test'),
  ('21000000-0000-0000-0000-00000000000d', 'delete-d@test'),
  ('21000000-0000-0000-0000-0000000000ad', 'delete-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('21000000-0000-0000-0000-00000000000a', 'Borrado A', '2000-01-01', 'has_room_looking_for_roommate'),
  ('21000000-0000-0000-0000-00000000000b', 'Borrado B', '2000-01-01', 'looking_for_room'),
  ('21000000-0000-0000-0000-00000000000d', 'Borrado D', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('21000000-0000-0000-0000-0000000000ad', 'Admin borrado', '1990-01-01', 'looking_for_room', 'admin');
-- R1 activa de A (con fotos, dirección y un favorito de B), R2 borrador de A
-- (con fotos, para la ruta no canónica y el aislamiento), R3 activa de D,
-- R4 retirada de A, R5 de A con un reporte (FK sin cascada) y R6 borrador de B.
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms)
  select v.id, v.owner, v.title, c.id, n.id, 500, '2026-11-01', 1, 2
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval',
       (values ('21100000-0000-0000-0000-000000000001'::uuid, '21000000-0000-0000-0000-00000000000a'::uuid, 'R1 de A'),
               ('21100000-0000-0000-0000-000000000002'::uuid, '21000000-0000-0000-0000-00000000000a'::uuid, 'R2 de A'),
               ('21100000-0000-0000-0000-000000000003'::uuid, '21000000-0000-0000-0000-00000000000d'::uuid, 'R3 de D'),
               ('21100000-0000-0000-0000-000000000004'::uuid, '21000000-0000-0000-0000-00000000000a'::uuid, 'R4 de A'),
               ('21100000-0000-0000-0000-000000000005'::uuid, '21000000-0000-0000-0000-00000000000a'::uuid, 'R5 de A'),
               ('21100000-0000-0000-0000-000000000006'::uuid, '21000000-0000-0000-0000-00000000000b'::uuid, 'R6 de B'))
         as v(id, owner, title)
  where c.slug = 'barcelona';
update public.rooms set status = 'active'
  where id in ('21100000-0000-0000-0000-000000000001', '21100000-0000-0000-0000-000000000003');
update public.rooms set status = 'removed' where id = '21100000-0000-0000-0000-000000000004';
insert into public.room_addresses (room_id, address_exact)
  values ('21100000-0000-0000-0000-000000000001', 'Carrer de prova 1');
insert into public.favorites (user_id, room_id)
  values ('21000000-0000-0000-0000-00000000000b', '21100000-0000-0000-0000-000000000001');
insert into public.reports (reporter_id, reported_room_id, reason)
  values ('21000000-0000-0000-0000-00000000000b', '21100000-0000-0000-0000-000000000005', 'spam');
set role service_role;
-- R1: tres fotos, con las posiciones desordenadas respecto a su id; R2 y R3: una.
insert into public.room_images (id, room_id, storage_path, position) values
  ('21200000-0000-0000-0000-000000000013', '21100000-0000-0000-0000-000000000001',
   '21100000-0000-0000-0000-000000000001/21200000-0000-0000-0000-000000000013.webp', 0),
  ('21200000-0000-0000-0000-000000000011', '21100000-0000-0000-0000-000000000001',
   '21100000-0000-0000-0000-000000000001/21200000-0000-0000-0000-000000000011.webp', 1),
  ('21200000-0000-0000-0000-000000000012', '21100000-0000-0000-0000-000000000001',
   '21100000-0000-0000-0000-000000000001/21200000-0000-0000-0000-000000000012.webp', 2),
  ('21200000-0000-0000-0000-000000000021', '21100000-0000-0000-0000-000000000002',
   '21100000-0000-0000-0000-000000000002/21200000-0000-0000-0000-000000000021.webp', 0),
  ('21200000-0000-0000-0000-000000000031', '21100000-0000-0000-0000-000000000003',
   '21100000-0000-0000-0000-000000000003/21200000-0000-0000-0000-000000000031.webp', 0);
reset role;
insert into storage.objects (bucket_id, name)
  select 'room-images', i.storage_path from public.room_images i
  where i.room_id::text like '21100000-%';
update public.profiles set deleted_at = now() where id = '21000000-0000-0000-0000-00000000000d';

-- ------------------------------------------------------------
-- 0. Estructura: permisos de rooms y de la función
-- ------------------------------------------------------------
select roomly_test.ok(
  not has_table_privilege('authenticated', 'public.rooms', 'DELETE')
  and not has_table_privilege('authenticated', 'public.rooms', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.rooms', 'DELETE')
  and not has_table_privilege('anon', 'public.rooms', 'TRUNCATE')
  and not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'rooms'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type in ('DELETE', 'TRUNCATE')),
  'DS0: ni anon ni authenticated (ni PUBLIC) tienen DELETE ni TRUNCATE sobre rooms');
select roomly_test.ok(
  has_table_privilege('authenticated', 'public.rooms', 'SELECT')
  and has_column_privilege('authenticated', 'public.rooms', 'title', 'INSERT')
  and has_column_privilege('authenticated', 'public.rooms', 'status', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rooms', 'status', 'INSERT')
  and has_table_privilege('authenticated', 'public.rooms', 'REFERENCES')
  and has_table_privilege('authenticated', 'public.rooms', 'TRIGGER')
  and has_table_privilege('anon', 'public.rooms', 'SELECT')
  and not has_any_column_privilege('anon', 'public.rooms', 'INSERT')
  and not has_any_column_privilege('anon', 'public.rooms', 'UPDATE'),
  'DS0: el resto de privilegios de clientes sigue igual (SELECT, INSERT y UPDATE por columnas, REFERENCES y TRIGGER)');
select roomly_test.ok(
  (select bool_and(has_table_privilege('service_role', 'public.rooms', p))
   from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p)
  and has_table_privilege('service_role', 'public.room_images', 'DELETE')
  and (select rolbypassrls from pg_roles where rolname = 'service_role'),
  'DS0: service_role conserva todos sus privilegios sobre rooms y room_images, y BYPASSRLS');
select roomly_test.ok(
  (select array_agg(policyname::text || ':' || cmd::text order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'rooms')
  = array['rooms_admin_all:ALL', 'rooms_insert_own:INSERT', 'rooms_select_active_public:SELECT',
          'rooms_select_own:SELECT', 'rooms_update_own:UPDATE']
  and (select count(*) = 41 from pg_policies where schemaname = 'public'),
  'DS0: sin rooms_delete_own: rooms tiene 5 políticas y public 41');
select roomly_test.ok(
  (select not p.prosecdef
      and p.provolatile = 'v'
      and p.proconfig = array['search_path=""']
      and p.prorettype = 'text[]'::regtype
   from pg_proc p where p.oid = 'public.delete_own_room(uuid, uuid)'::regprocedure),
  'DS0: delete_own_room es SECURITY INVOKER, VOLATILE, con search_path vacío y devuelve text[]');
select roomly_test.ok(
  has_function_privilege('service_role', 'public.delete_own_room(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_own_room(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.delete_own_room(uuid, uuid)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.delete_own_room(uuid, uuid)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'DS0: EXECUTE solo para service_role (ni PUBLIC, ni anon, ni authenticated)');

-- ------------------------------------------------------------
-- 1. Ningún cliente borra directamente
-- ------------------------------------------------------------
-- A ve su habitación (RLS): un rechazo solo puede venir del privilegio.
set role authenticated;
select roomly_test.login('21000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000002'$$,
  1, 'DS1: A ve su borrador');
select roomly_test.expect_denied(
  $$delete from public.rooms where id = '21100000-0000-0000-0000-000000000002'$$,
  'DS1: la propietaria activa ya no borra su habitación directamente (sin DELETE)');
select roomly_test.expect_denied(
  $$truncate public.rooms cascade$$,
  'DS1: ni con TRUNCATE');
select roomly_test.login('21000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000002'$$,
  1, 'DS1: el admin ve el borrador de A (rooms_admin_all)');
select roomly_test.expect_denied(
  $$delete from public.rooms where id = '21100000-0000-0000-0000-000000000002'$$,
  'DS1: ni un admin desde el cliente');
reset role;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000001'$$,
  1, 'DS2: anon ve la habitación activa de A');
select roomly_test.expect_denied(
  $$delete from public.rooms where id = '21100000-0000-0000-0000-000000000001'$$,
  'DS2: anon no la borra');
reset role;

-- ------------------------------------------------------------
-- 2. Ningún cliente llama a la función
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('21000000-0000-0000-0000-00000000000a');
select roomly_test.expect_denied(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-00000000000a')$$,
  'DS3: la propietaria no llama a delete_own_room con su sesión (sin EXECUTE)');
reset role;
set role anon;
select roomly_test.expect_denied(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-00000000000a')$$,
  'DS3: anon tampoco');
reset role;
select roomly_test.ok(
  (select count(*) = 6 from public.rooms where id::text like '21100000-%'),
  'DS3: después de los rechazos siguen las 6 habitaciones');

-- ------------------------------------------------------------
-- 3. service_role: solo la habitación propia de una cuenta activa
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-00000000000b')$$,
  'P0002', 'room_not_found:', 'DS4: con el id de B no se borra la habitación de A');
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000006', '21000000-0000-0000-0000-00000000000a')$$,
  'P0002', 'room_not_found:', 'DS4: ni con el id de A la de B');
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room('21100000-0000-0000-0000-0000000000ff', '21000000-0000-0000-0000-00000000000a')$$,
  'P0002', 'room_not_found:', 'DS4: ni una habitación que no existe');
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-00000000000d')$$,
  '42501', 'account_deleted:', 'DS5: la cuenta desactivada D no borra su propia habitación');
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-0000000000ee')$$,
  '42501', 'account_deleted:', 'DS5: ni un usuario sin perfil');
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room(null, '21000000-0000-0000-0000-00000000000a')$$,
  '22004', 'room_delete_invalid:', 'DS6: sin habitación, rechazo');
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000002', null)$$,
  '22004', 'room_delete_invalid:', 'DS6: sin usuario, rechazo');
reset role;
select roomly_test.ok(
  (select count(*) = 6 from public.rooms where id::text like '21100000-%')
  and (select count(*) = 5 from public.room_images where room_id::text like '21100000-%')
  and exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000003'),
  'DS4-DS6: ningún rechazo borra nada (6 habitaciones, 5 fotos, también la de D)');

-- El rechazo fuera de READ COMMITTED (room_delete_isolation) necesita su
-- propia transacción: está en tests/db/concurrency_room_delete.sh (CD0), que
-- solo corre en local. La suite remota ejecuta cada archivo dentro de una
-- transacción del runner y no admite cambiar el aislamiento.

-- ------------------------------------------------------------
-- 4. Una ruta no canónica aborta sin borrar nada
-- ------------------------------------------------------------
-- chk_room_images_storage_path impide esas filas: el test lo quita dentro de
-- una transacción que se deshace al final, para probar la defensa de la
-- función. Una ruta en la carpeta de otra habitación y otra con «..».
begin;
alter table public.room_images drop constraint chk_room_images_storage_path;
insert into public.room_images (id, room_id, storage_path, position) values
  ('21200000-0000-0000-0000-000000000022', '21100000-0000-0000-0000-000000000002',
   '21100000-0000-0000-0000-000000000003/21200000-0000-0000-0000-000000000031.webp', 1),
  ('21200000-0000-0000-0000-000000000023', '21100000-0000-0000-0000-000000000002',
   '21100000-0000-0000-0000-000000000002/../21100000-0000-0000-0000-000000000003/x.webp', 2);
set local role service_role;
select roomly_test.expect_error_prefix(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-00000000000a')$$,
  '23514', 'room_delete_path_invalid: 2 fotos', 'DS8: dos rutas no canónicas → rechazo, con cuántas');
reset role;
select roomly_test.ok(
  exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000002')
  and (select count(*) = 3 from public.room_images where room_id = '21100000-0000-0000-0000-000000000002')
  and (select count(*) = 5 from storage.objects where name like '21100000-%'),
  'DS8: sin borrar la habitación, sus 3 filas (también la válida) ni ningún objeto');
rollback;
select roomly_test.ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.room_images'::regclass and conname = 'chk_room_images_storage_path')
  and not exists (select 1 from public.room_images where id = '21200000-0000-0000-0000-000000000022'),
  'DS8: la restricción y los datos vuelven a su estado (transacción deshecha)');

-- ------------------------------------------------------------
-- 5. Una referencia sin cascada (reports) aborta sin borrar nada
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_fk_violation(
  $$select public.delete_own_room('21100000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-00000000000a')$$,
  'reports_reported_room_id_fkey', 'DS9: con un reporte que la referencia, el DELETE falla por esa FK');
reset role;
select roomly_test.ok(
  exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000005'),
  'DS9: y la habitación sigue');

-- ------------------------------------------------------------
-- 6. El borrado autorizado
-- ------------------------------------------------------------
create temporary table ds_expected as
  select array_agg(i.storage_path order by i.position, i.created_at, i.id) as paths
  from public.room_images i where i.room_id = '21100000-0000-0000-0000-000000000001';
grant select on ds_expected to service_role;
create temporary table ds_result (paths text[]);
grant insert, select on ds_result to service_role;
set role service_role;
insert into ds_result
  select public.delete_own_room('21100000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-00000000000a');
reset role;
select roomly_test.ok(
  (select r.paths from ds_result r) = (select e.paths from ds_expected e)
  and (select r.paths from ds_result r) = array[
    '21100000-0000-0000-0000-000000000001/21200000-0000-0000-0000-000000000013.webp',
    '21100000-0000-0000-0000-000000000001/21200000-0000-0000-0000-000000000011.webp',
    '21100000-0000-0000-0000-000000000001/21200000-0000-0000-0000-000000000012.webp'],
  'DS10: devuelve exactamente las rutas de sus filas de room_images, por posición');
select roomly_test.ok(
  (select bool_and(p ~ '^21100000-0000-0000-0000-000000000001/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
   from ds_result r, unnest(r.paths) as p),
  'DS10: todas son canónicas y de su carpeta');
select roomly_test.ok(
  not exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.room_images where room_id = '21100000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.room_addresses where room_id = '21100000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.favorites where room_id = '21100000-0000-0000-0000-000000000001'),
  'DS10: la habitación, sus fotos, su dirección y el favorito de B se van en la misma transacción');
select roomly_test.ok(
  (select count(*) = 3 from storage.objects where name like '21100000-0000-0000-0000-000000000001/%'),
  'DS10: los objetos de Storage no los toca: los borra después el servidor con esas rutas');
select roomly_test.ok(
  exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000002')
  and exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000003')
  and exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000006')
  and (select count(*) = 2 from public.room_images where room_id::text like '21100000-%'),
  'DS10: las demás habitaciones y sus fotos siguen');

set role service_role;
select roomly_test.ok(
  public.delete_own_room('21100000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-00000000000a') = '{}',
  'DS11: una habitación retirada por moderación, sin fotos, se borra y devuelve un array vacío (como con la RLS anterior)');
reset role;
select roomly_test.ok(
  not exists (select 1 from public.rooms where id = '21100000-0000-0000-0000-000000000004'),
  'DS11: y ya no existe');
