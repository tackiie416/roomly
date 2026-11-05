-- Fase 4.4 (sesión 71) — Lectura pública mínima para anon
-- (20261031120100_public_read_minimum.sql).
-- Debe fallar si:
--   - anon puede leer alguna columna de rooms fuera de las 20 públicas (owner_id,
--     coordenadas, estado, borrado lógico o fechas internas), o tiene cualquier
--     otro privilegio sobre rooms; o PUBLIC tiene alguno;
--   - anon deja de poder leer las columnas públicas o las fotos de una
--     habitación pública, o empieza a ver borradores o habitaciones ocultas
--     por R7;
--   - la propietaria pierde su CRUD (crear, editar, leer sus columnas) o la
--     lectura de las fotos de sus borradores, o otra persona las ve;
--   - anon o PUBLIC pueden leer public_profile_previews, o alguien puede
--     escribir a través de ella (en particular, ponerse role = admin);
--   - aparece otra vista o función SECURITY DEFINER al alcance de anon.
--
-- O: propietaria · D: propietaria que se desactiva · U: otro usuario · X: admin.
-- Q1 activa de O · Q2 borrador de O · Q3 activa de D; una foto cada una.

reset role;
insert into auth.users (id, email) values
  ('23000000-0000-0000-0000-00000000000a', 'pr-o@test'),
  ('23000000-0000-0000-0000-00000000000d', 'pr-d@test'),
  ('23000000-0000-0000-0000-00000000000b', 'pr-u@test'),
  ('23000000-0000-0000-0000-0000000000ad', 'pr-x@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('23000000-0000-0000-0000-00000000000a', 'PR O', '2000-01-01', 'has_room_looking_for_roommate'),
  ('23000000-0000-0000-0000-00000000000d', 'PR D', '2000-01-01', 'has_room_looking_for_roommate'),
  ('23000000-0000-0000-0000-00000000000b', 'PR U', '2000-01-01', 'looking_for_room');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('23000000-0000-0000-0000-0000000000ad', 'PR X', '1990-01-01', 'looking_for_room', 'admin');
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select v.id, v.owner_id, v.title, c.id, n.id, 500, '2026-11-01', 1, 2, v.status::public.room_status
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'sants',
       (values ('23100000-0000-0000-0000-000000000001'::uuid, '23000000-0000-0000-0000-00000000000a'::uuid, 'Q1 activa de O', 'active'),
               ('23100000-0000-0000-0000-000000000002'::uuid, '23000000-0000-0000-0000-00000000000a'::uuid, 'Q2 borrador de O', 'draft'),
               ('23100000-0000-0000-0000-000000000003'::uuid, '23000000-0000-0000-0000-00000000000d'::uuid, 'Q3 activa de D', 'active'))
         as v(id, owner_id, title, status)
  where c.slug = 'barcelona';
set role service_role;
insert into public.room_images (id, room_id, storage_path, position)
  select ('23200000-0000-0000-0000-00000000000' || n)::uuid,
         ('23100000-0000-0000-0000-00000000000' || n)::uuid,
         '23100000-0000-0000-0000-00000000000' || n || '/23200000-0000-0000-0000-00000000000' || n || '.webp', 0
  from generate_series(1, 3) as n;
reset role;
update public.profiles set deleted_at = now() where id = '23000000-0000-0000-0000-00000000000d';

-- ------------------------------------------------------------
-- 0. Privilegios de anon y PUBLIC sobre rooms
-- ------------------------------------------------------------
select roomly_test.ok(
  (select string_agg(a.attname, ',' order by a.attname)
   from pg_attribute a
   where a.attrelid = 'public.rooms'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT'))
  = 'available_from,city_id,deposit_amount,description,expenses_included,features,house_rules,id,max_stay_months,min_stay_months,neighborhood_id,pets_allowed,price_month,published_at,roommate_preferences,smoking_allowed,students_only,title,total_roommates,total_rooms',
  'PR0: anon lee exactamente las 20 columnas públicas de rooms');
select roomly_test.ok(
  not has_table_privilege('anon', 'public.rooms', 'SELECT')
  and not has_any_column_privilege('anon', 'public.rooms', 'INSERT')
  and not has_any_column_privilege('anon', 'public.rooms', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.rooms', 'REFERENCES')
  and not has_table_privilege('anon', 'public.rooms', 'DELETE')
  and not has_table_privilege('anon', 'public.rooms', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.rooms', 'TRIGGER'),
  'PR0: anon no tiene SELECT de tabla ni ningún otro privilegio sobre rooms');
select roomly_test.ok(
  not exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.rooms'::regclass and a.grantee = 0)
  and not exists (
    select 1 from pg_attribute att, aclexplode(att.attacl) a
    where att.attrelid = 'public.rooms'::regclass and att.attacl is not null and a.grantee = 0),
  'PR0: PUBLIC no tiene ningún privilegio sobre rooms ni sobre sus columnas');
select roomly_test.ok(
  has_table_privilege('authenticated', 'public.rooms', 'SELECT')
  and has_column_privilege('authenticated', 'public.rooms', 'owner_id', 'SELECT')
  and has_column_privilege('authenticated', 'public.rooms', 'status', 'UPDATE')
  and has_column_privilege('authenticated', 'public.rooms', 'title', 'INSERT'),
  'PR0: authenticated conserva su SELECT de tabla y el GRANT por columnas del CRUD');

-- ------------------------------------------------------------
-- 1. anon: columnas públicas sí, el resto no
-- ------------------------------------------------------------
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select id, title, description, city_id, neighborhood_id, price_month, expenses_included,
           deposit_amount, available_from, min_stay_months, max_stay_months, total_roommates,
           total_rooms, features, pets_allowed, smoking_allowed, students_only, house_rules,
           roommate_preferences, published_at
    from public.rooms where id = '23100000-0000-0000-0000-000000000001'$$,
  1, 'PR1: anon lee las columnas públicas de una habitación activa');
do $$
declare
  col text;
begin
  foreach col in array array['owner_id', 'approx_lat', 'approx_lng', 'status', 'deleted_at',
                             'created_at', 'updated_at'] loop
    perform roomly_test.expect_error(
      format('select %I from public.rooms', col), '42501',
      format('PR1: anon no lee rooms.%s', col));
  end loop;
end $$;
select roomly_test.expect_error(
  $$select * from public.rooms$$, '42501', 'PR1: anon no hace select * de rooms');
select roomly_test.expect_error(
  $$select id from public.rooms where status = 'active'$$, '42501',
  'PR1: anon tampoco filtra ni ordena por una columna no pública (status)');
select roomly_test.expect_error(
  $$select id from public.rooms order by owner_id$$, '42501',
  'PR1: ni por owner_id');

-- ------------------------------------------------------------
-- 2. anon: R7 sigue decidiendo las filas
-- ------------------------------------------------------------
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id::text like '23100000-%'$$,
  1, 'PR2: anon solo ve Q1: ni el borrador Q2 ni Q3, de una cuenta desactivada');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id::text like '23200000-%'$$,
  1, 'PR2: y solo la foto de Q1 (la política pública ya no lee rooms.owner_id)');
select roomly_test.expect_rows(
  $$select 1 from public.room_images
    where room_id = '23100000-0000-0000-0000-000000000001' and position = 0
    order by position, created_at, id$$,
  1, 'PR2: anon lee las columnas de room_images que usa la página (orden incluido)');
reset role;

-- ------------------------------------------------------------
-- 3. La propietaria conserva su CRUD; otra persona no ve lo ajeno
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('23000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select owner_id, status, created_at, updated_at, deleted_at, published_at
    from public.rooms where id::text like '23100000-%'$$,
  2, 'PR3: la propietaria lee todas las columnas de sus habitaciones (también el borrador)');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id::text like '23200000-%'$$,
  2, 'PR3: y las fotos de las dos (room_images_select_own)');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '23100000-0000-0000-0000-000000000004', '23000000-0000-0000-0000-00000000000a',
           'Q4 nueva', c.id, 450, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'PR3: crea un borrador');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Q2 editada' where id = '23100000-0000-0000-0000-000000000002'$$,
  1, 'PR3: edita un borrador');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '23100000-0000-0000-0000-000000000002'$$,
  1, 'PR3: y lo publica');
select roomly_test.login('23000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '23100000-0000-0000-0000-000000000004'$$,
  0, 'PR3: otra persona no ve el borrador ajeno');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id::text like '23200000-%'$$,
  2, 'PR3: y de las fotos ajenas solo ve las públicas (Q1 y Q2, ya publicada)');
select roomly_test.login('23000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.room_images where id::text like '23200000-%'$$,
  3, 'PR3: el admin activo sigue leyendo todas (también la de Q3, oculta por R7)');
reset role;

-- ------------------------------------------------------------
-- 4. Políticas de room_images
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (select 1 from pg_policies where schemaname = 'public'
              and tablename = 'room_images' and policyname = 'room_images_select')
  and (select cmd = 'SELECT' and array_to_string(roles, ',') = 'public'
              and qual = 'is_room_publicly_visible(room_id)'
       from pg_policies where schemaname = 'public' and tablename = 'room_images'
         and policyname = 'room_images_select_public')
  and (select cmd = 'SELECT' and array_to_string(roles, ',') = 'authenticated'
              and qual like '%r.owner_id = auth.uid()%'
       from pg_policies where schemaname = 'public' and tablename = 'room_images'
         and policyname = 'room_images_select_own'),
  'PR4: room_images: la lectura pública solo llama a la función; la de las propias, solo para authenticated');
select roomly_test.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and cmd in ('SELECT', 'ALL')
      and 'public' = any(roles::text[]) and qual like '%owner_id%'
      and tablename <> 'rooms'),
  'PR4: ninguna política de lectura que se aplique a anon lee owner_id de otra tabla');

-- ------------------------------------------------------------
-- 5. public_profile_previews: ni anon ni PUBLIC (sesión 71), ni authenticated
--    (hotfix 20261014120000); nadie escribe por ella
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (
    select 1 from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                               'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('anon', 'public.public_profile_previews', p))
  and not exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.public_profile_previews'::regclass and a.grantee = 0),
  'PR5: anon y PUBLIC no tienen ningún privilegio sobre public_profile_previews');
select roomly_test.ok(
  not exists (
    select 1 from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('authenticated', 'public.public_profile_previews', p)),
  'PR5: authenticated tampoco tiene ningún privilegio (hotfix 20261014120000)');
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$select id from public.public_profile_previews$$, '42501',
  'PR5: anon no lee public_profile_previews');
select roomly_test.expect_error(
  $$update public.public_profile_previews set full_name = 'X'
    where id = '23000000-0000-0000-0000-00000000000b'$$,
  '42501', 'PR5: anon no cambia el nombre de nadie a través de la vista');
select roomly_test.expect_error(
  $$delete from public.public_profile_previews where id = '23000000-0000-0000-0000-00000000000b'$$,
  '42501', 'PR5: ni borra perfiles a través de ella');
set role authenticated;
select roomly_test.login('23000000-0000-0000-0000-00000000000b');
select roomly_test.expect_error(
  $$update public.public_profile_previews set role = 'admin'
    where id = '23000000-0000-0000-0000-00000000000b'$$,
  '42501', 'PR5: un usuario no se pone role = admin a través de la vista');
select roomly_test.expect_error(
  $$delete from public.public_profile_previews where id = '23000000-0000-0000-0000-00000000000a'$$,
  '42501', 'PR5: ni borra el perfil de otra persona');
select roomly_test.expect_error(
  $$select 1 from public.public_profile_previews where id = '23000000-0000-0000-0000-00000000000a'$$,
  '42501', 'PR5: authenticated tampoco lee la vista (hotfix 20261014120000)');
reset role;
select roomly_test.ok(
  (select role = 'user' and full_name = 'PR U' from public.profiles
   where id = '23000000-0000-0000-0000-00000000000b')
  and exists (select 1 from public.profiles where id = '23000000-0000-0000-0000-00000000000a'),
  'PR5: los intentos no cambiaron nada');

-- ------------------------------------------------------------
-- 6. Nada más al alcance de anon que revele lo mismo
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and has_table_privilege('anon', c.oid, 'SELECT')),
  'PR6: anon no lee ninguna vista de public');
select roomly_test.ok(
  (select string_agg(p.oid::regprocedure::text, ',' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE'))
  = 'is_admin(),is_room_publicly_visible(uuid)',
  'PR6: las únicas funciones SECURITY DEFINER que anon ejecuta son is_admin e is_room_publicly_visible');
