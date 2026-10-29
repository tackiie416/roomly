-- Fase 4.2 — Fotos de habitaciones: room_images y Storage
-- (20261024120000_room_images_storage_visibility.sql y
-- 20261025120000_room_images_private_bucket.sql).
-- Debe fallar si:
--   - un cliente (anon, la propietaria, otro usuario o un admin) vuelve a
--     escribir en room_images, o en storage.objects;
--   - una fila puede apuntar a una ruta distinta de room_id/id.webp, o tener
--     una posición negativa;
--   - una habitación pasa de 8 fotos, o recibe fotos estando retirada o
--     eliminada, o con la cuenta del propietario desactivada, aunque escriba
--     service_role (el servidor, que se salta la RLS);
--   - un UPDATE cambia algo más que la posición;
--   - el servidor deja de poder borrar fotos, o el borrado en cascada de
--     rooms se bloquea;
--   - un cliente lista o descarga objetos del bucket por la API;
--   - el bucket deja de ser privado (D1), o un cliente puede volver a hacerlo
--     público o cambiar sus límites (ST0 y ST1);
--   - el admin deja de leer las fotos ocultas, o las lee otro usuario.
--
-- A: propietaria activa · B: otro usuario · D: propietaria que se desactiva
-- · X: admin. Las fotos legítimas las escribe service_role, el único escritor.
-- Los objetos de Storage del test van bajo roomly-test-19/, y sus recuentos se
-- limitan a ese prefijo: el bucket puede tener objetos ajenos (M3).
-- Limitación: storage es el del shim (tests/db/supabase_shim.sql), no la API
-- de Storage de Supabase.

reset role;
insert into auth.users (id, email) values
  ('19000000-0000-0000-0000-00000000000a', 'images-a@test'),
  ('19000000-0000-0000-0000-00000000000b', 'images-b@test'),
  ('19000000-0000-0000-0000-00000000000d', 'images-d@test'),
  ('19000000-0000-0000-0000-0000000000ad', 'images-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('19000000-0000-0000-0000-00000000000a', 'Fotos A', '2000-01-01', 'has_room_looking_for_roommate'),
  ('19000000-0000-0000-0000-00000000000b', 'Fotos B', '2000-01-01', 'looking_for_room'),
  ('19000000-0000-0000-0000-00000000000d', 'Fotos D', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('19000000-0000-0000-0000-0000000000ad', 'Admin fotos', '1990-01-01', 'looking_for_room', 'admin');
-- R1 activa de A, R2 borrador de A, R3 activa de D, R4 activa de A (se
-- retira), R5 borrador de A (se elimina) y R6 pausada de A.
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select v.id, v.owner_id, v.title, c.id, n.id, 450, '2026-11-01', 2, 3, v.status::public.room_status
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval',
       (values ('19100000-0000-0000-0000-000000000001'::uuid, '19000000-0000-0000-0000-00000000000a'::uuid, 'R1 activa de A', 'active'),
               ('19100000-0000-0000-0000-000000000002'::uuid, '19000000-0000-0000-0000-00000000000a'::uuid, 'R2 borrador de A', 'draft'),
               ('19100000-0000-0000-0000-000000000003'::uuid, '19000000-0000-0000-0000-00000000000d'::uuid, 'R3 activa de D', 'active'),
               ('19100000-0000-0000-0000-000000000004'::uuid, '19000000-0000-0000-0000-00000000000a'::uuid, 'R4 activa de A', 'active'),
               ('19100000-0000-0000-0000-000000000005'::uuid, '19000000-0000-0000-0000-00000000000a'::uuid, 'R5 borrador de A', 'draft'),
               ('19100000-0000-0000-0000-000000000006'::uuid, '19000000-0000-0000-0000-00000000000a'::uuid, 'R6 pausada de A', 'paused'))
         as v(id, owner_id, title, status)
  where c.slug = 'barcelona';

-- ------------------------------------------------------------
-- 0. Estructura
-- ------------------------------------------------------------
select roomly_test.ok(
  (select array_agg(policyname::text || ':' || cmd::text order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'room_images')
  = array['room_images_admin_select:SELECT', 'room_images_select:SELECT'],
  'IM0: room_images solo tiene sus 2 políticas de lectura (sin las de escritura de la 4.0)');
select roomly_test.ok(
  (select bool_and(not has_table_privilege(r, 'public.room_images', p))
   from unnest(array['anon', 'authenticated']) as r,
        unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p)
  and not has_any_column_privilege('anon', 'public.room_images', 'INSERT')
  and not has_any_column_privilege('anon', 'public.room_images', 'UPDATE')
  and not has_any_column_privilege('authenticated', 'public.room_images', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.room_images', 'UPDATE'),
  'IM0: anon y authenticated no tienen ninguna escritura en room_images, ni de tabla ni de columna');
select roomly_test.ok(
  has_table_privilege('anon', 'public.room_images', 'SELECT')
  and has_table_privilege('authenticated', 'public.room_images', 'SELECT')
  and has_table_privilege('service_role', 'public.room_images', 'INSERT')
  and has_table_privilege('service_role', 'public.room_images', 'UPDATE')
  and has_table_privilege('service_role', 'public.room_images', 'DELETE'),
  'IM0: los clientes conservan SELECT (RLS) y service_role escribe');
select roomly_test.ok(
  (select count(*) = 2 from pg_constraint
   where conrelid = 'public.room_images'::regclass and contype = 'c' and convalidated
     and conname in ('chk_room_images_storage_path', 'chk_room_images_position')),
  'IM0: chk_room_images_storage_path y chk_room_images_position existen y están validadas');
select roomly_test.ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.room_images'::regclass and t.tgname = 'trg_room_images_integrity'
      and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgtype & 1 = 1          -- FOR EACH ROW
      and t.tgtype & 2 = 2          -- BEFORE
      and t.tgtype & 4 = 4          -- INSERT
      and t.tgtype & 16 = 16        -- UPDATE
      and t.tgtype & 8 = 0          -- no DELETE
      and t.tgfoid = 'public.enforce_room_images_integrity()'::regprocedure),
  'IM0: trg_room_images_integrity es BEFORE INSERT OR UPDATE, por fila, activo y sin DELETE');
select roomly_test.ok(
  (select not p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc p where p.oid = 'public.enforce_room_images_integrity()'::regprocedure)
  and not has_function_privilege('anon', 'public.enforce_room_images_integrity()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enforce_room_images_integrity()', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.enforce_room_images_integrity()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'IM0: su función es SECURITY INVOKER, con search_path vacío y sin EXECUTE para anon, authenticated ni PUBLIC');
select roomly_test.ok(
  exists (select 1 from storage.buckets b
          where b.id = 'room-images' and b.name = 'room-images'
            and b.file_size_limit = 5242880
            and b.allowed_mime_types = array['image/webp']::text[])
  and (select count(*) = 1 from storage.buckets b where b.name = 'room-images'),
  'IM0: el bucket room-images existe, con id = nombre, 5 MiB y solo image/webp');
select roomly_test.ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass)
  and not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'),
  'IM0: storage.objects tiene la RLS activa y ninguna política');
select roomly_test.ok(
  exists (select 1 from storage.buckets b where b.id = 'room-images' and b.public is false),
  'ST0: el bucket room-images es privado (D1, 20261025120000): sin URL públicas');
select roomly_test.ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'storage.buckets'::regclass)
  and not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'buckets' and p.cmd <> 'SELECT'),
  'ST0: storage.buckets tiene la RLS activa y ninguna política de escritura');

-- ------------------------------------------------------------
-- 1. Ningún cliente escribe en room_images
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000011', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000011.webp', 0)$$,
  '42501', 'IM1: la propietaria ya no añade fotos desde el cliente');
select roomly_test.login('19000000-0000-0000-0000-00000000000b');
select roomly_test.expect_error(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000011', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000011.webp', 0)$$,
  '42501', 'IM1: otro usuario tampoco');
select roomly_test.login('19000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000011', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000011.webp', 0)$$,
  '42501', 'IM1: ni un admin');
reset role;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000011', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000011.webp', 0)$$,
  '42501', 'IM1: ni anon');

-- Control: los mismos datos entran como servidor, así que los rechazos de
-- arriba no venían de los datos.
reset role;
set role service_role;
select roomly_test.login(null);
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000011', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000011.webp', 0),
      ('19200000-0000-0000-0000-000000000021', '19100000-0000-0000-0000-000000000002',
       '19100000-0000-0000-0000-000000000002/19200000-0000-0000-0000-000000000021.webp', 0),
      ('19200000-0000-0000-0000-000000000031', '19100000-0000-0000-0000-000000000003',
       '19100000-0000-0000-0000-000000000003/19200000-0000-0000-0000-000000000031.webp', 0),
      ('19200000-0000-0000-0000-000000000041', '19100000-0000-0000-0000-000000000004',
       '19100000-0000-0000-0000-000000000004/19200000-0000-0000-0000-000000000041.webp', 0),
      ('19200000-0000-0000-0000-000000000061', '19100000-0000-0000-0000-000000000006',
       '19100000-0000-0000-0000-000000000006/19200000-0000-0000-0000-000000000061.webp', 0)$$,
  5, 'IM1-control: service_role sí escribe esas fotos (y las de un borrador, de D y de una pausada)');

-- La propietaria ve su foto, así que un rechazo al cambiarla o borrarla es
-- del GRANT, no de que no la vea.
reset role;
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id = '19200000-0000-0000-0000-000000000011'$$,
  1, 'IM1: la propietaria ve su foto');
select roomly_test.expect_error(
  $$update public.room_images set position = 3 where id = '19200000-0000-0000-0000-000000000011'$$,
  '42501', 'IM1: pero no la reordena desde el cliente');
select roomly_test.expect_error(
  $$delete from public.room_images where id = '19200000-0000-0000-0000-000000000011'$$,
  '42501', 'IM1: ni la borra');
select roomly_test.login('19000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error(
  $$update public.room_images set position = 3 where id = '19200000-0000-0000-0000-000000000011'$$,
  '42501', 'IM1: un admin tampoco la cambia desde el cliente');

-- Control negativo: aunque una política volviera a abrir el INSERT, el GRANT
-- revocado lo sigue impidiendo (dos capas, la RLS no es la única).
reset role;
begin;
create policy "zz_test_images_insert_temporal" on public.room_images
  for insert to authenticated with check (true);
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.webp', 1)$$,
  '42501', 'IM1: con una política de INSERT abierta, el GRANT revocado sigue impidiéndolo');
rollback;
reset role;

-- ------------------------------------------------------------
-- 2. Ruta canónica y posición (también para service_role)
-- ------------------------------------------------------------
set role service_role;
select roomly_test.login(null);
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000002/19200000-0000-0000-0000-000000000012.webp', 1)$$,
  'chk_room_images_storage_path', 'IM2: la ruta no puede apuntar a otra habitación');
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000011.webp', 1)$$,
  'chk_room_images_storage_path', 'IM2: ni a la foto de otra fila');
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.jpg', 1)$$,
  'chk_room_images_storage_path', 'IM2: ni tener otra extensión');
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-0000000000fa', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-0000000000FA.webp', 1)$$,
  'chk_room_images_storage_path', 'IM2: ni el id en mayúsculas (la ruta es la forma canónica en minúsculas)');
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '../19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.webp', 1)$$,
  'chk_room_images_storage_path', 'IM2: ni subir de directorio');
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       'rooms/19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.webp', 1)$$,
  'chk_room_images_storage_path', 'IM2: ni llevar otro prefijo (como las rutas libres de antes)');
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.webp ', 1)$$,
  'chk_room_images_storage_path', 'IM2: ni un espacio al final');
select roomly_test.expect_check_violation(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.webp', -1)$$,
  'chk_room_images_position', 'IM2: ni una posición negativa');
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000012', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.webp', 1)$$,
  1, 'IM2-control: con su ruta canónica y posición ≥ 0, la misma foto entra');

-- ------------------------------------------------------------
-- 3. Un UPDATE solo cambia la posición
-- ------------------------------------------------------------
select roomly_test.expect_affected(
  $$update public.room_images set position = 4 where id = '19200000-0000-0000-0000-000000000012'$$,
  1, 'IM3: el servidor reordena una foto');
select roomly_test.expect_error_prefix(
  $$update public.room_images
    set storage_path = '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000099.webp'
    where id = '19200000-0000-0000-0000-000000000012'$$,
  '23514', 'room_image_locked:', 'IM3: pero no cambia su ruta');
select roomly_test.expect_error_prefix(
  $$update public.room_images
    set room_id = '19100000-0000-0000-0000-000000000006',
        storage_path = '19100000-0000-0000-0000-000000000006/19200000-0000-0000-0000-000000000012.webp'
    where id = '19200000-0000-0000-0000-000000000012'$$,
  '23514', 'room_image_locked:', 'IM3: ni la mueve a otra habitación, aunque la ruta sea coherente');
select roomly_test.expect_error_prefix(
  $$update public.room_images
    set id = '19200000-0000-0000-0000-000000000099',
        storage_path = '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000099.webp'
    where id = '19200000-0000-0000-0000-000000000012'$$,
  '23514', 'room_image_locked:', 'IM3: ni le cambia el id');
select roomly_test.expect_error_prefix(
  $$update public.room_images set created_at = now() - interval '1 day'
    where id = '19200000-0000-0000-0000-000000000012'$$,
  '23514', 'room_image_locked:', 'IM3: ni la fecha de creación');

-- ------------------------------------------------------------
-- 4. Como mucho 8 fotos por habitación
-- ------------------------------------------------------------
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position)
    select v.id, '19100000-0000-0000-0000-000000000001',
           '19100000-0000-0000-0000-000000000001/' || v.id::text || '.webp', v.n
    from (select ('19200000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid as id, n
          from generate_series(3, 8) as n) as v$$,
  6, 'IM4: R1 llega a 8 fotos');
select roomly_test.expect_error_prefix(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000109', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000109.webp', 9)$$,
  '23514', 'room_images_limit:', 'IM4: la novena se rechaza, también como servidor');
select roomly_test.expect_error_prefix(
  $$insert into public.room_images (id, room_id, storage_path, position)
    select v.id, '19100000-0000-0000-0000-000000000002',
           '19100000-0000-0000-0000-000000000002/' || v.id::text || '.webp', v.n
    from (select ('19200000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid as id, n
          from generate_series(1, 8) as n) as v$$,
  '23514', 'room_images_limit:', 'IM4: y 8 de golpe en un borrador que ya tiene 1 (la novena, dentro del mismo INSERT)');
select roomly_test.ok(
  (select count(*) = 8 from public.room_images where room_id = '19100000-0000-0000-0000-000000000001')
  and (select count(*) = 1 from public.room_images where room_id = '19100000-0000-0000-0000-000000000002'),
  'IM4: R1 sigue con 8 y el borrador con 1 (el INSERT rechazado no deja nada)');
select roomly_test.expect_affected(
  $$delete from public.room_images where id = '19200000-0000-0000-0000-000000000108'$$,
  1, 'IM4: al borrar una');
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000109', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000109.webp', 9)$$,
  1, 'IM4: vuelve a caber otra');
-- Control: sin el trigger, la novena entraría; el límite es suyo.
reset role;
begin;
alter table public.room_images disable trigger trg_room_images_integrity;
set role service_role;
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000110', '19100000-0000-0000-0000-000000000001',
       '19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000110.webp', 10)$$,
  1, 'IM4-control: con el trigger desactivado, la novena entraría');
rollback;
reset role;
select roomly_test.ok(
  (select count(*) = 8 from public.room_images where room_id = '19100000-0000-0000-0000-000000000001')
  and exists (select 1 from pg_trigger where tgname = 'trg_room_images_integrity' and tgenabled = 'O'),
  'IM4-control: deshecho: 8 fotos y el trigger otra vez activo');

-- ------------------------------------------------------------
-- 5. Habitaciones retiradas o eliminadas y cuentas desactivadas
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000062', '19100000-0000-0000-0000-000000000006',
       '19100000-0000-0000-0000-000000000006/19200000-0000-0000-0000-000000000062.webp', 1)$$,
  1, 'IM5: una habitación pausada sí recibe fotos');
reset role;
update public.rooms set status = 'removed' where id = '19100000-0000-0000-0000-000000000004';
update public.rooms set deleted_at = now() where id = '19100000-0000-0000-0000-000000000005';
set role service_role;
select roomly_test.expect_error_prefix(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000042', '19100000-0000-0000-0000-000000000004',
       '19100000-0000-0000-0000-000000000004/19200000-0000-0000-0000-000000000042.webp', 1)$$,
  '23514', 'room_not_writable:', 'IM5: una habitación retirada (removed) no recibe fotos, ni del servidor');
select roomly_test.expect_error_prefix(
  $$update public.room_images set position = 2 where id = '19200000-0000-0000-0000-000000000041'$$,
  '23514', 'room_not_writable:', 'IM5: ni se reordenan las suyas');
select roomly_test.expect_error_prefix(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000051', '19100000-0000-0000-0000-000000000005',
       '19100000-0000-0000-0000-000000000005/19200000-0000-0000-0000-000000000051.webp', 0)$$,
  '23514', 'room_not_writable:', 'IM5: una habitación eliminada (deleted_at) tampoco');
select roomly_test.expect_error_prefix(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000071', '19100000-0000-0000-0000-000000000007',
       '19100000-0000-0000-0000-000000000007/19200000-0000-0000-0000-000000000071.webp', 0)$$,
  '23514', 'room_not_writable:', 'IM5: ni una habitación que no existe (el trigger va antes que la FK)');
select roomly_test.expect_affected(
  $$delete from public.room_images where id = '19200000-0000-0000-0000-000000000041'$$,
  1, 'IM5: el servidor sí borra la foto de una habitación retirada');

reset role;
update public.profiles set deleted_at = now() where id = '19000000-0000-0000-0000-00000000000d';
set role service_role;
select roomly_test.expect_error_prefix(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000032', '19100000-0000-0000-0000-000000000003',
       '19100000-0000-0000-0000-000000000003/19200000-0000-0000-0000-000000000032.webp', 1)$$,
  '23514', 'account_deleted:', 'IM6: con la cuenta desactivada, ni el servidor añade fotos (antes sí: IM1-control)');
select roomly_test.expect_error_prefix(
  $$update public.room_images set position = 2 where id = '19200000-0000-0000-0000-000000000031'$$,
  '23514', 'account_deleted:', 'IM6: ni las reordena');
select roomly_test.expect_affected(
  $$delete from public.room_images where id = '19200000-0000-0000-0000-000000000031'$$,
  1, 'IM6: pero sí las borra');
reset role;
update public.profiles set deleted_at = null where id = '19000000-0000-0000-0000-00000000000d';
set role service_role;
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('19200000-0000-0000-0000-000000000032', '19100000-0000-0000-0000-000000000003',
       '19100000-0000-0000-0000-000000000003/19200000-0000-0000-0000-000000000032.webp', 1)$$,
  1, 'IM6-control: al reactivar la cuenta, la misma foto entra');
reset role;

-- ------------------------------------------------------------
-- 6. Lectura: pública, propia y del admin
-- ------------------------------------------------------------
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.room_images where room_id = '19100000-0000-0000-0000-000000000001'$$,
  8, 'IM7: anon ve las fotos de una habitación activa');
select roomly_test.expect_rows(
  $$select 1 from public.room_images
    where room_id in ('19100000-0000-0000-0000-000000000002', '19100000-0000-0000-0000-000000000006')$$,
  0, 'IM7: pero no las de un borrador ni las de una pausada');
reset role;
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id::text like '19200000-%'$$,
  9, 'IM7: otro usuario ve las 9 públicas (R1 y R3), no las ocultas');
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.room_images
    where room_id in ('19100000-0000-0000-0000-000000000002', '19100000-0000-0000-0000-000000000006')$$,
  3, 'IM7: la propietaria ve las de su borrador y su pausada');
select roomly_test.login('19000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.room_images
    where room_id in ('19100000-0000-0000-0000-000000000002', '19100000-0000-0000-0000-000000000006')$$,
  3, 'IM7: el admin también (room_images_admin_select)');
reset role;
begin;
drop policy "room_images_admin_select" on public.room_images;
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.room_images
    where room_id in ('19100000-0000-0000-0000-000000000002', '19100000-0000-0000-0000-000000000006')$$,
  0, 'IM7-control: sin su política, el admin no las vería');
rollback;
reset role;

-- ------------------------------------------------------------
-- 7. El borrado en cascada no se bloquea
-- ------------------------------------------------------------
-- (deja el objeto de Storage huérfano, si lo hubiera: riesgo documentado en
-- docs/SECURITY.md hasta que el borrado de habitaciones pase por el servidor)
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$delete from public.rooms where id = '19100000-0000-0000-0000-000000000006'$$,
  1, 'IM8: la propietaria borra su habitación pausada');
reset role;
select roomly_test.ok(
  not exists (select 1 from public.room_images where room_id = '19100000-0000-0000-0000-000000000006'),
  'IM8: y sus fotos caen en cascada (el trigger no mira el DELETE)');

-- ------------------------------------------------------------
-- 8. storage.objects: ningún cliente lista, sube, cambia ni borra objetos
-- ------------------------------------------------------------
insert into storage.objects (bucket_id, name) values
  ('room-images', 'roomly-test-19/19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000011.webp'),
  ('room-images', 'roomly-test-19/19100000-0000-0000-0000-000000000001/19200000-0000-0000-0000-000000000012.webp');
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from storage.objects where name like 'roomly-test-19/%'$$,
  0, 'IM9: anon no lista los objetos del bucket');
select roomly_test.expect_error(
  $$insert into storage.objects (bucket_id, name) values ('room-images', 'roomly-test-19/anon.webp')$$,
  '42501', 'IM9: ni sube uno');
reset role;
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from storage.objects where name like 'roomly-test-19/%'$$,
  0, 'IM9: la propietaria tampoco los lista (sus fotos le llegan por URL firmada)');
select roomly_test.expect_error(
  $$insert into storage.objects (bucket_id, name)
    values ('room-images', 'roomly-test-19/19100000-0000-0000-0000-000000000001/directa.webp')$$,
  '42501', 'IM9: ni sube directamente, sin pasar por la limpieza del servidor');
select roomly_test.expect_affected(
  $$update storage.objects set name = 'roomly-test-19/movida.webp' where name like 'roomly-test-19/%'$$,
  0, 'IM9: ni mueve objetos');
select roomly_test.expect_affected(
  $$delete from storage.objects where name like 'roomly-test-19/%'$$,
  0, 'IM9: ni los borra');
select roomly_test.login('19000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from storage.objects where name like 'roomly-test-19/%'$$,
  0, 'IM9: ni un admin los lista');
reset role;
set role service_role;
select roomly_test.expect_rows(
  $$select 1 from storage.objects where name like 'roomly-test-19/%'$$,
  2, 'IM9-control: los objetos existen: service_role (el servidor) los ve');
reset role;

-- ------------------------------------------------------------
-- 9. ST1: nadie vuelve público el bucket desde un cliente
-- ------------------------------------------------------------
set role anon;
select roomly_test.login(null);
select roomly_test.expect_affected(
  $$update storage.buckets set public = true where id = 'room-images'$$,
  0, 'ST1: anon no vuelve público el bucket');
reset role;
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update storage.buckets set public = true, file_size_limit = null where id = 'room-images'$$,
  0, 'ST1: la propietaria tampoco, ni le quita el límite');
select roomly_test.login('19000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update storage.buckets set public = true where id = 'room-images'$$,
  0, 'ST1: ni un admin (su rol en la app no cuenta en Storage)');
select roomly_test.expect_error(
  $$insert into storage.buckets (id, name, public) values ('roomly-test-19', 'roomly-test-19', true)$$,
  '42501', 'ST1: ni crea otro bucket público');
select roomly_test.expect_affected(
  $$delete from storage.buckets where id = 'room-images'$$,
  0, 'ST1: ni borra el bucket');
reset role;
select roomly_test.ok(
  exists (select 1 from storage.buckets b
          where b.id = 'room-images' and b.public is false and b.file_size_limit = 5242880),
  'ST1: el bucket sigue privado y con su límite');
-- Control: lo que los frena es la RLS de storage.buckets (sin políticas de
-- escritura). Con una política de UPDATE abierta (y una de lectura, que un
-- UPDATE con WHERE también necesita), la propietaria sí podría.
begin;
create policy "zz_test_buckets_select_temporal" on storage.buckets
  for select to authenticated using (true);
create policy "zz_test_buckets_update_temporal" on storage.buckets
  for update to authenticated using (true) with check (true);
set role authenticated;
select roomly_test.login('19000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update storage.buckets set public = true where id = 'room-images'$$,
  1, 'ST1-control: con una política de escritura en storage.buckets, un cliente lo haría público');
rollback;
reset role;
select roomly_test.ok(
  exists (select 1 from storage.buckets b where b.id = 'room-images' and b.public is false)
  and not exists (select 1 from pg_policies where policyname like 'zz_test%'),
  'ST1-control: deshecho: privado y sin la política temporal');
