-- Fase 4.0 — Habitaciones: escrituras bloqueadas para cuentas desactivadas
-- (20261013120000_rooms_deleted_account_writes.sql).
-- Debe fallar si una cuenta con `deleted_at` puede volver a crear, modificar
-- o borrar habitaciones, direcciones o imágenes por PostgREST; si un usuario
-- escribe en las filas de otro; si `anon` u otro usuario leen la dirección
-- exacta; si cambia la lectura, o si el admin / service_role pierden lo que
-- ya podían hacer.
--
-- A: activo · B: otro usuario activo · D: se desactiva a mitad del test, con
-- habitación, dirección e imagen · E: desactivado desde el principio ·
-- X: admin.
--
-- Por qué las negativas fallan por permisos y no por otra cosa:
--   - authenticated tiene INSERT, UPDATE y DELETE sobre las tres tablas
--     (RI0), así que un 42501 al insertar es la política (RLS), no el GRANT;
--   - cada INSERT rechazado se repite después, con los mismos datos, como
--     service_role, y entra (los datos son válidos);
--   - un UPDATE o DELETE con 0 filas solo prueba algo si la fila es visible
--     para quien lo intenta: se comprueba antes (como en tests/db/11). La
--     dirección de A no la ve B; para ese caso se abre la lectura con una
--     política temporal dentro de una transacción que se deshace;
--   - el bloque final (RI9) añade, también de forma temporal, la condición
--     de antes de la 4.0 (solo propiedad) y comprueba que entonces D sí
--     escribe: las aserciones de 0 filas dependen de la protección nueva.

reset role;
insert into auth.users (id, email) values
  ('15000000-0000-0000-0000-00000000000a', 'rooms-a@test'),
  ('15000000-0000-0000-0000-00000000000b', 'rooms-b@test'),
  ('15000000-0000-0000-0000-00000000000d', 'rooms-d@test'),
  ('15000000-0000-0000-0000-00000000000e', 'rooms-e@test'),
  ('15000000-0000-0000-0000-0000000000ad', 'rooms-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('15000000-0000-0000-0000-00000000000a', 'Propietaria A', '2000-01-01', 'has_room_looking_for_roommate'),
  ('15000000-0000-0000-0000-00000000000b', 'Otra B', '2000-01-01', 'looking_for_room'),
  ('15000000-0000-0000-0000-00000000000d', 'Propietaria D', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, deleted_at) values
  ('15000000-0000-0000-0000-00000000000e', 'Desactivada E', '2000-01-01', 'has_room_looking_for_roommate', now());
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('15000000-0000-0000-0000-0000000000ad', 'Admin', '1990-01-01', 'looking_for_room', 'admin');

-- ------------------------------------------------------------
-- 0. Estructura: lectura igual, escrituras separadas y con cuenta activa.
-- ------------------------------------------------------------
select roomly_test.ok(
  has_table_privilege('authenticated', 'public.rooms', 'INSERT')
  and has_table_privilege('authenticated', 'public.rooms', 'UPDATE')
  and has_table_privilege('authenticated', 'public.rooms', 'DELETE')
  and has_table_privilege('authenticated', 'public.room_addresses', 'INSERT')
  and has_table_privilege('authenticated', 'public.room_addresses', 'UPDATE')
  and has_table_privilege('authenticated', 'public.room_addresses', 'DELETE')
  and has_table_privilege('authenticated', 'public.room_images', 'INSERT')
  and has_table_privilege('authenticated', 'public.room_images', 'UPDATE')
  and has_table_privilege('authenticated', 'public.room_images', 'DELETE'),
  'RI0: authenticated conserva INSERT, UPDATE y DELETE: un rechazo es de la RLS, no del GRANT');
select roomly_test.ok(
  (select array_agg(policyname::text || ':' || cmd::text order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'rooms')
  = array['rooms_admin_all:ALL', 'rooms_delete_own:DELETE', 'rooms_insert_own:INSERT',
          'rooms_select_active_public:SELECT', 'rooms_select_own:SELECT', 'rooms_update_own:UPDATE'],
  'RI0: rooms tiene sus 6 políticas (sin rooms_owner_write)');
select roomly_test.ok(
  (select array_agg(policyname::text || ':' || cmd::text order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'room_addresses')
  = array['room_addresses_delete_own:DELETE', 'room_addresses_insert_own:INSERT',
          'room_addresses_select_own:SELECT', 'room_addresses_update_own:UPDATE'],
  'RI0: room_addresses tiene sus 4 políticas (sin room_addresses_owner_only)');
select roomly_test.ok(
  (select array_agg(policyname::text || ':' || cmd::text order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'room_images')
  = array['room_images_delete_own:DELETE', 'room_images_insert_own:INSERT',
          'room_images_select:SELECT', 'room_images_update_own:UPDATE'],
  'RI0: room_images tiene sus 4 políticas (sin room_images_owner_write)');
select roomly_test.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('rooms', 'room_addresses', 'room_images')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and not (
        array_to_string(roles, ',') = 'authenticated'
        and (cmd = 'INSERT' or coalesce(qual, '') like '%deleted_at IS NULL%')
        and (cmd = 'DELETE' or coalesce(with_check, '') like '%deleted_at IS NULL%')
        and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%auth.uid()%'
      )
  ),
  'RI0: cada política de escritura es de authenticated y exige propiedad y cuenta activa en todas sus expresiones');
select roomly_test.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('room_addresses', 'room_images')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '')
          not like '%' || tablename || '.room_id%'
  ),
  'RI0: las políticas de escritura de direcciones e imágenes cualifican room_id con su tabla');
select roomly_test.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('rooms', 'room_addresses', 'room_images')
      and cmd = 'SELECT'
      and coalesce(qual, '') like '%profiles%'
  )
  and (select qual not like '%deleted_at%'
       from pg_policies
       where schemaname = 'public' and tablename = 'room_addresses'
         and policyname = 'room_addresses_select_own'),
  'RI0: la lectura no mira la cuenta: ninguna política SELECT consulta profiles');

-- ------------------------------------------------------------
-- 1. Un propietario activo escribe con normalidad.
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('15000000-0000-0000-0000-00000000000a');

select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, status)
    select '15100000-0000-0000-0000-00000000000a', '15000000-0000-0000-0000-00000000000a',
           'Habitación de A', c.id, 450, '2026-11-01', 'active'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RI1: un propietario activo crea su habitación');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-0000000000a2', '15000000-0000-0000-0000-00000000000a',
           'Borrador de A', c.id, 400, '2026-12-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RI1: y un segundo anuncio, en borrador');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Habitación de A, reformada', price_month = 470
    where id = '15100000-0000-0000-0000-00000000000a'$$,
  1, 'RI1: lo edita');
select roomly_test.expect_affected(
  $$insert into public.room_addresses (room_id, address_exact)
    values ('15100000-0000-0000-0000-00000000000a', 'Carrer Exacte de A, 1')$$,
  1, 'RI1: guarda su dirección exacta');
select roomly_test.expect_affected(
  $$update public.room_addresses set address_exact = 'Carrer Exacte de A, 1, 2º'
    where room_id = '15100000-0000-0000-0000-00000000000a'$$,
  1, 'RI1: la corrige');
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position) values
      ('15200000-0000-0000-0000-00000000000a', '15100000-0000-0000-0000-00000000000a', 'rooms/a/1.jpg', 0),
      ('15200000-0000-0000-0000-0000000000a2', '15100000-0000-0000-0000-00000000000a', 'rooms/a/2.jpg', 1)$$,
  2, 'RI1: añade dos imágenes');
select roomly_test.expect_affected(
  $$update public.room_images set position = 5
    where id = '15200000-0000-0000-0000-0000000000a2'$$,
  1, 'RI1: reordena una imagen');
select roomly_test.expect_affected(
  $$delete from public.room_images where id = '15200000-0000-0000-0000-0000000000a2'$$,
  1, 'RI1: borra una imagen');
select roomly_test.expect_affected(
  $$delete from public.rooms where id = '15100000-0000-0000-0000-0000000000a2'$$,
  1, 'RI1: borra su borrador');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-0000000000a3', '15000000-0000-0000-0000-00000000000a',
           'Tercera de A, sin dirección', c.id, 420, '2026-12-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RI1: y deja otro borrador, todavía sin dirección');

-- ------------------------------------------------------------
-- 2. Otro usuario no escribe en las filas de A.
-- ------------------------------------------------------------
select roomly_test.login('15000000-0000-0000-0000-00000000000b');

-- La habitación y la imagen activas son públicas: B las ve, así que un 0
-- solo puede venir de la política de escritura.
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '15100000-0000-0000-0000-00000000000a'$$,
  1, 'RI2: B ve la habitación activa de A');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Suplantada', price_month = 1
    where id = '15100000-0000-0000-0000-00000000000a'$$,
  0, 'RI2: aun viéndola, B NO edita la habitación de A');
select roomly_test.expect_affected(
  $$delete from public.rooms where id = '15100000-0000-0000-0000-00000000000a'$$,
  0, 'RI2: ni la borra');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-0000000000b1', '15000000-0000-0000-0000-00000000000a',
           'A nombre de A', c.id, 300, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RI2: ni crea una habitación a nombre de A');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id = '15200000-0000-0000-0000-00000000000a'$$,
  1, 'RI2: B ve la imagen de la habitación activa de A');
select roomly_test.expect_affected(
  $$update public.room_images set storage_path = 'rooms/b/suplantada.jpg'
    where id = '15200000-0000-0000-0000-00000000000a'$$,
  0, 'RI2: aun viéndola, B NO cambia la imagen de A');
select roomly_test.expect_affected(
  $$delete from public.room_images where id = '15200000-0000-0000-0000-00000000000a'$$,
  0, 'RI2: ni la borra');
select roomly_test.expect_error(
  $$insert into public.room_images (id, room_id, storage_path, position)
    values ('15200000-0000-0000-0000-0000000000b1', '15100000-0000-0000-0000-00000000000a', 'rooms/b/1.jpg', 9)$$,
  '42501', 'RI2: ni añade imágenes a la habitación de A');
select roomly_test.expect_error(
  $$insert into public.room_addresses (room_id, address_exact)
    values ('15100000-0000-0000-0000-0000000000a3', 'Dirección inventada por B')$$,
  '42501', 'RI2: ni pone la dirección del borrador de A');

-- Control: los mismos INSERT entran si los hace la dueña, así que los
-- rechazos de B no venían de los datos.
select roomly_test.login('15000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-0000000000b1', '15000000-0000-0000-0000-00000000000a',
           'A nombre de A', c.id, 300, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RI2-control: A sí crea esa habitación');
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position)
    values ('15200000-0000-0000-0000-0000000000b1', '15100000-0000-0000-0000-00000000000a', 'rooms/b/1.jpg', 9)$$,
  1, 'RI2-control: esa imagen');
select roomly_test.expect_affected(
  $$insert into public.room_addresses (room_id, address_exact)
    values ('15100000-0000-0000-0000-0000000000a3', 'Dirección inventada por B')$$,
  1, 'RI2-control: y esa dirección');
select roomly_test.login('15000000-0000-0000-0000-00000000000b');

-- La dirección exacta: ni B ni anon la leen, aunque conozcan el room_id.
select roomly_test.expect_rows(
  $$select address_exact from public.room_addresses
    where room_id = '15100000-0000-0000-0000-00000000000a'$$,
  0, 'RI3: B NO lee la dirección exacta de A conociendo su room_id');
reset role;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select address_exact from public.room_addresses
    where room_id = '15100000-0000-0000-0000-00000000000a'$$,
  0, 'RI3: anon tampoco');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '15100000-0000-0000-0000-00000000000a'$$,
  1, 'RI3: anon sí ve la habitación activa (sin la dirección): la lectura pública no cambia');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-0000000000f1', '15000000-0000-0000-0000-00000000000a',
           'Anónima', c.id, 300, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RI3: anon no crea habitaciones');

-- Con la dirección visible a la fuerza, B sigue sin poder tocarla.
reset role;
begin;
create policy "zz_test_select_all_temporal" on public.room_addresses
  for select to authenticated using (true);
set role authenticated;
select roomly_test.login('15000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.room_addresses
    where room_id = '15100000-0000-0000-0000-00000000000a'$$,
  1, 'RI4: con la lectura abierta temporalmente, B ve la dirección de A');
select roomly_test.expect_affected(
  $$update public.room_addresses set address_exact = 'Suplantada'
    where room_id = '15100000-0000-0000-0000-00000000000a'$$,
  0, 'RI4: aun viéndola, B NO modifica la dirección de A');
select roomly_test.expect_affected(
  $$delete from public.room_addresses
    where room_id = '15100000-0000-0000-0000-00000000000a'$$,
  0, 'RI4: ni la borra');
select roomly_test.login('15000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.room_addresses set address_exact = 'Cambio propio'
    where room_id = '15100000-0000-0000-0000-00000000000a'$$,
  1, 'RI4-control: en la misma situación A sí la modifica (solo falla el dueño)');
rollback;
reset role;

select roomly_test.ok(
  (select title = 'Habitación de A, reformada' and price_month = 470
   from public.rooms where id = '15100000-0000-0000-0000-00000000000a')
  and (select address_exact = 'Carrer Exacte de A, 1, 2º'
       from public.room_addresses where room_id = '15100000-0000-0000-0000-00000000000a')
  and (select storage_path = 'rooms/a/1.jpg'
       from public.room_images where id = '15200000-0000-0000-0000-00000000000a'),
  'RI4: la habitación, la dirección y la imagen de A siguen intactas');

-- ------------------------------------------------------------
-- 3. D escribe mientras está activa; después se desactiva su cuenta y se
--    reintenta con el MISMO JWT: la RLS mira el valor actual de deleted_at.
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('15000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, status)
    select r.id, '15000000-0000-0000-0000-00000000000d', r.title, c.id, 500, '2026-11-01', 'active'
    from public.cities c,
         (values ('15100000-0000-0000-0000-00000000000d'::uuid, 'Habitación de D'),
                 ('15100000-0000-0000-0000-0000000000d2'::uuid, 'Segunda de D')) as r(id, title)
    where c.slug = 'barcelona'$$,
  2, 'RD0: antes de desactivarse, D crea dos habitaciones');
select roomly_test.expect_affected(
  $$insert into public.room_addresses (room_id, address_exact)
    values ('15100000-0000-0000-0000-00000000000d', 'Carrer Exacte de D, 4')$$,
  1, 'RD0: con dirección (la segunda, sin ella)');
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position)
    values ('15200000-0000-0000-0000-00000000000d', '15100000-0000-0000-0000-00000000000d', 'rooms/d/1.jpg', 0)$$,
  1, 'RD0: y una imagen');

reset role;
update public.profiles set deleted_at = now()
  where id = '15000000-0000-0000-0000-00000000000d';
set role authenticated;

-- D sigue viendo sus filas (la lectura no cambia), así que un 0 al
-- escribirlas solo puede venir de la política de escritura.
select roomly_test.expect_rows(
  $$select 1 from public.rooms where owner_id = '15000000-0000-0000-0000-00000000000d'$$,
  2, 'RD1: la cuenta desactivada sigue viendo sus dos habitaciones');
select roomly_test.expect_rows(
  $$select 1 from public.room_addresses
    where room_id = '15100000-0000-0000-0000-00000000000d'
      and address_exact = 'Carrer Exacte de D, 4'$$,
  1, 'RD1: su dirección exacta');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id = '15200000-0000-0000-0000-00000000000d'$$,
  1, 'RD1: y su imagen');

select roomly_test.expect_affected(
  $$update public.rooms set title = 'Reactivada', price_month = 1, status = 'paused'
    where id = '15100000-0000-0000-0000-00000000000d'$$,
  0, 'RD2: una cuenta desactivada NO edita su habitación (mismo JWT)');
select roomly_test.expect_affected(
  $$update public.rooms set deleted_at = now()
    where id = '15100000-0000-0000-0000-00000000000d'$$,
  0, 'RD2: ni la retira con un borrado lógico');
select roomly_test.expect_affected(
  $$delete from public.rooms where id = '15100000-0000-0000-0000-00000000000d'$$,
  0, 'RD2: ni la borra');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-0000000000d3', '15000000-0000-0000-0000-00000000000d',
           'Nueva de D', c.id, 500, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RD2: ni crea otra');

select roomly_test.expect_affected(
  $$update public.room_addresses set address_exact = 'Otra calle'
    where room_id = '15100000-0000-0000-0000-00000000000d'$$,
  0, 'RD3: NO cambia su dirección exacta');
select roomly_test.expect_affected(
  $$delete from public.room_addresses
    where room_id = '15100000-0000-0000-0000-00000000000d'$$,
  0, 'RD3: ni la borra');
select roomly_test.expect_error(
  $$insert into public.room_addresses (room_id, address_exact)
    values ('15100000-0000-0000-0000-0000000000d2', 'Carrer Exacte de D, 6')$$,
  '42501', 'RD3: ni crea la de su segunda habitación');

select roomly_test.expect_affected(
  $$update public.room_images set position = 3
    where id = '15200000-0000-0000-0000-00000000000d'$$,
  0, 'RD4: NO reordena su imagen');
select roomly_test.expect_affected(
  $$delete from public.room_images where id = '15200000-0000-0000-0000-00000000000d'$$,
  0, 'RD4: ni la borra');
select roomly_test.expect_error(
  $$insert into public.room_images (id, room_id, storage_path, position)
    values ('15200000-0000-0000-0000-0000000000d2', '15100000-0000-0000-0000-00000000000d', 'rooms/d/2.jpg', 1)$$,
  '42501', 'RD4: ni añade otra');

reset role;
select roomly_test.ok(
  (select title = 'Habitación de D' and price_month = 500 and status = 'active' and deleted_at is null
   from public.rooms where id = '15100000-0000-0000-0000-00000000000d')
  and (select address_exact = 'Carrer Exacte de D, 4'
       from public.room_addresses where room_id = '15100000-0000-0000-0000-00000000000d')
  and (select position = 0
       from public.room_images where id = '15200000-0000-0000-0000-00000000000d')
  and (select count(*) = 1 from public.room_images
       where room_id = '15100000-0000-0000-0000-00000000000d'),
  'RD5: la habitación, la dirección y la imagen de D siguen intactas');

-- E: desactivada desde el principio, no crea nada.
set role authenticated;
select roomly_test.login('15000000-0000-0000-0000-00000000000e');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-00000000000e', '15000000-0000-0000-0000-00000000000e',
           'Habitación de E', c.id, 380, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'RE1: una cuenta desactivada desde el principio NO crea habitaciones');

-- ------------------------------------------------------------
-- 4. Admin y service_role: lo que ya podían hacer sigue igual.
-- ------------------------------------------------------------
select roomly_test.login('15000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'removed'
    where id = '15100000-0000-0000-0000-00000000000d'$$,
  1, 'RX1: un admin sigue moderando la habitación de una cuenta desactivada');

reset role;
set role service_role;
select roomly_test.login(null);
-- Los mismos datos que se rechazaron arriba entran como servidor: eran válidos.
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '15100000-0000-0000-0000-00000000000e', '15000000-0000-0000-0000-00000000000e',
           'Habitación de E', c.id, 380, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'RX2: service_role crea la habitación que E no pudo crear');
select roomly_test.expect_affected(
  $$insert into public.room_addresses (room_id, address_exact)
    values ('15100000-0000-0000-0000-0000000000d2', 'Carrer Exacte de D, 6')$$,
  1, 'RX2: y la dirección que D no pudo crear');
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position)
    values ('15200000-0000-0000-0000-0000000000d2', '15100000-0000-0000-0000-00000000000d', 'rooms/d/2.jpg', 1)$$,
  1, 'RX2: y la imagen que D no pudo añadir');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'paused'
    where id = '15100000-0000-0000-0000-00000000000d'$$,
  1, 'RX3: service_role sigue escribiendo habitaciones de una cuenta desactivada');
select roomly_test.expect_affected(
  $$delete from public.room_images where id = '15200000-0000-0000-0000-0000000000d2'$$,
  1, 'RX3: y borrando sus imágenes');

-- ------------------------------------------------------------
-- 5. Lectura sin cambios.
-- ------------------------------------------------------------
reset role;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '15100000-0000-0000-0000-0000000000d2'$$,
  1, 'RL1: una habitación activa de una cuenta desactivada sigue siendo pública (ocultarla es R7, pendiente)');
reset role;
set role authenticated;
select roomly_test.login('15000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.room_addresses
    where room_id in ('15100000-0000-0000-0000-00000000000d', '15100000-0000-0000-0000-0000000000d2')$$,
  0, 'RL2: B no lee las direcciones de D');
select roomly_test.login('15000000-0000-0000-0000-00000000000d');
select roomly_test.expect_rows(
  $$select 1 from public.room_addresses
    where room_id in ('15100000-0000-0000-0000-00000000000d', '15100000-0000-0000-0000-0000000000d2')$$,
  2, 'RL2: D, desactivada, sigue leyendo las suyas');

-- ------------------------------------------------------------
-- 6. Control negativo: con la condición de antes de la 4.0 (solo propiedad),
--    D volvería a escribir. Se añade de forma temporal, una por tabla, y se
--    deshace: las aserciones de 0 filas y de 42501 de arriba dependen de la
--    comprobación de cuenta activa, no de otra cosa.
-- ------------------------------------------------------------
reset role;
begin;
create policy "zz_test_rooms_update_sin_cuenta" on public.rooms
  for update to authenticated
  using (auth.uid() = rooms.owner_id) with check (auth.uid() = rooms.owner_id);
create policy "zz_test_addresses_delete_sin_cuenta" on public.room_addresses
  for delete to authenticated
  using (exists (select 1 from public.rooms r
                 where r.id = room_addresses.room_id and r.owner_id = auth.uid()));
create policy "zz_test_images_insert_sin_cuenta" on public.room_images
  for insert to authenticated
  with check (exists (select 1 from public.rooms r
                      where r.id = room_images.room_id and r.owner_id = auth.uid()));
set role authenticated;
select roomly_test.login('15000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Reactivada'
    where id = '15100000-0000-0000-0000-0000000000d2'$$,
  1, 'RI9: sin la comprobación de cuenta activa, D volvería a editar su habitación');
select roomly_test.expect_affected(
  $$delete from public.room_addresses
    where room_id = '15100000-0000-0000-0000-0000000000d2'$$,
  1, 'RI9: a borrar su dirección');
select roomly_test.expect_affected(
  $$insert into public.room_images (id, room_id, storage_path, position)
    values ('15200000-0000-0000-0000-0000000000d3', '15100000-0000-0000-0000-0000000000d2', 'rooms/d/3.jpg', 0)$$,
  1, 'RI9: y a añadir imágenes');
rollback;
reset role;

select roomly_test.ok(
  not exists (select 1 from pg_policies
              where schemaname = 'public' and policyname like 'zz_test%'),
  'RI9: las políticas temporales ya no existen');
select roomly_test.ok(
  (select title = 'Segunda de D' from public.rooms
   where id = '15100000-0000-0000-0000-0000000000d2')
  and exists (select 1 from public.room_addresses
              where room_id = '15100000-0000-0000-0000-0000000000d2')
  and not exists (select 1 from public.room_images
                  where id = '15200000-0000-0000-0000-0000000000d3'),
  'RI9: y lo que hicieron se deshizo');
select roomly_test.ok(
  (select count(*) = 14 from pg_policies
   where schemaname = 'public' and tablename in ('rooms', 'room_addresses', 'room_images')),
  'RI9: rooms, room_addresses y room_images siguen con sus 14 políticas');
