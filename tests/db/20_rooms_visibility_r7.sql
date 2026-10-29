-- Fase 4.2 — R7: visibilidad pública según la cuenta del propietario
-- (20261024120000_room_images_storage_visibility.sql).
-- Debe fallar si:
--   - una habitación activa de una cuenta desactivada, o sus fotos, siguen
--     siendo visibles para anon o para otro usuario;
--   - la propietaria desactivada deja de ver lo suyo, o el admin deja de ver
--     las habitaciones y las fotos ocultas;
--   - la política del admin hace públicas esas fotos, o deja verlas a un
--     usuario normal o a un admin desactivado;
--   - `is_room_publicly_visible` responde algo distinto de lo que ya revela
--     un SELECT, o la lectura pública deja de depender de ella;
--   - ocultar cambia datos (al reactivar la cuenta, todo vuelve a verse).
--
-- O: propietaria activa · D: propietaria que se desactiva · U: otro usuario
-- · X: admin · Y: admin desactivado.
-- R1 activa de O, R2 activa de D, R3 borrador de O, R4 activa de O que se
-- pausa; cada una con una foto (la crea service_role).

reset role;
insert into auth.users (id, email) values
  ('2a000000-0000-0000-0000-00000000000a', 'r7-o@test'),
  ('2a000000-0000-0000-0000-00000000000d', 'r7-d@test'),
  ('2a000000-0000-0000-0000-00000000000b', 'r7-u@test'),
  ('2a000000-0000-0000-0000-0000000000ad', 'r7-x@test'),
  ('2a000000-0000-0000-0000-0000000000ae', 'r7-y@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('2a000000-0000-0000-0000-00000000000a', 'R7 O', '2000-01-01', 'has_room_looking_for_roommate'),
  ('2a000000-0000-0000-0000-00000000000d', 'R7 D', '2000-01-01', 'has_room_looking_for_roommate'),
  ('2a000000-0000-0000-0000-00000000000b', 'R7 U', '2000-01-01', 'looking_for_room');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('2a000000-0000-0000-0000-0000000000ad', 'R7 X', '1990-01-01', 'looking_for_room', 'admin');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role, deleted_at) values
  ('2a000000-0000-0000-0000-0000000000ae', 'R7 Y', '1990-01-01', 'looking_for_room', 'admin', now());
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select v.id, v.owner_id, v.title, c.id, n.id, 500, '2026-11-01', 1, 2, v.status::public.room_status
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval',
       (values ('2a100000-0000-0000-0000-000000000001'::uuid, '2a000000-0000-0000-0000-00000000000a'::uuid, 'R1 activa de O', 'active'),
               ('2a100000-0000-0000-0000-000000000002'::uuid, '2a000000-0000-0000-0000-00000000000d'::uuid, 'R2 activa de D', 'active'),
               ('2a100000-0000-0000-0000-000000000003'::uuid, '2a000000-0000-0000-0000-00000000000a'::uuid, 'R3 borrador de O', 'draft'),
               ('2a100000-0000-0000-0000-000000000004'::uuid, '2a000000-0000-0000-0000-00000000000a'::uuid, 'R4 activa de O', 'active'))
         as v(id, owner_id, title, status)
  where c.slug = 'barcelona';
set role service_role;
insert into public.room_images (id, room_id, storage_path, position)
  select ('2a200000-0000-0000-0000-00000000000' || n)::uuid,
         ('2a100000-0000-0000-0000-00000000000' || n)::uuid,
         '2a100000-0000-0000-0000-00000000000' || n || '/2a200000-0000-0000-0000-00000000000' || n || '.webp', 0
  from generate_series(1, 4) as n;
reset role;

-- Consultas reutilizadas: qué habitaciones y fotos de este test ve cada uno.
-- (Las de otros tests no cuentan: se filtra por el prefijo de los ids.)
-- security_invoker: la RLS se aplica a quien consulta, no al dueño de la vista.
create temporary view r7_rooms with (security_invoker = true) as
  select r.id from public.rooms r where r.id::text like '2a100000-%';
create temporary view r7_images with (security_invoker = true) as
  select i.room_id from public.room_images i where i.id::text like '2a200000-%';
grant select on r7_rooms, r7_images to anon, authenticated;

-- ------------------------------------------------------------
-- 0. Estructura
-- ------------------------------------------------------------
select roomly_test.ok(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
          and p.prorettype = 'boolean'::regtype
   from pg_proc p where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure)
  and (select p.proowner = c.relowner
       from pg_proc p, pg_class c
       where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure
         and c.oid = 'public.rooms'::regclass)
  and (select p.proowner = c.relowner
       from pg_proc p, pg_class c
       where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure
         and c.oid = 'public.profiles'::regclass),
  'VR0: is_room_publicly_visible es SECURITY DEFINER, STABLE, con search_path vacío y del dueño de rooms y profiles');
select roomly_test.ok(
  has_function_privilege('anon', 'public.is_room_publicly_visible(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.is_room_publicly_visible(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.is_room_publicly_visible(uuid)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'VR0: EXECUTE solo para anon y authenticated (ni PUBLIC ni service_role, que no pasa por la RLS)');
select roomly_test.ok(
  (select qual like '%is_room_publicly_visible(id)%' and qual like '%status = ''active''%'
          and qual like '%deleted_at IS NULL%'
   from pg_policies
   where schemaname = 'public' and tablename = 'rooms' and policyname = 'rooms_select_active_public')
  and (select qual like '%is_room_publicly_visible(room_id)%' and qual like '%auth.uid()%'
       from pg_policies
       where schemaname = 'public' and tablename = 'room_images' and policyname = 'room_images_select'),
  'VR0: la lectura pública de habitaciones y de fotos pasa por la función');
select roomly_test.ok(
  (select cmd = 'SELECT' and array_to_string(roles, ',') = 'authenticated' and qual = 'is_admin()'
   from pg_policies
   where schemaname = 'public' and tablename = 'room_images' and policyname = 'room_images_admin_select'),
  'VR0: room_images_admin_select es solo SELECT, solo para authenticated y solo con is_admin()');

-- ------------------------------------------------------------
-- 1. Con las dos cuentas activas
-- ------------------------------------------------------------
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows($$select 1 from r7_rooms$$, 3,
  'VR1: anon ve las 3 habitaciones activas (R1, R2 y R4), no el borrador');
select roomly_test.expect_rows($$select 1 from r7_images$$, 3, 'VR1: y sus 3 fotos');
reset role;
set role authenticated;
select roomly_test.login('2a000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR1: otro usuario ve la habitación activa de D');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR1: y su foto');

-- ------------------------------------------------------------
-- 2. D se desactiva: R2 y su foto dejan de ser públicas
-- ------------------------------------------------------------
reset role;
update public.profiles set deleted_at = now() where id = '2a000000-0000-0000-0000-00000000000d';
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id = '2a100000-0000-0000-0000-000000000002'$$,
  0, 'VR2: anon ya no ve la habitación activa de la cuenta desactivada');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id = '2a100000-0000-0000-0000-000000000002'$$,
  0, 'VR2: ni su foto');
select roomly_test.expect_rows($$select 1 from r7_rooms$$, 2,
  'VR2: las de O siguen públicas (R1 y R4)');
reset role;
set role authenticated;
select roomly_test.login('2a000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id = '2a100000-0000-0000-0000-000000000002'$$,
  0, 'VR2: otro usuario tampoco la ve');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id = '2a100000-0000-0000-0000-000000000002'$$,
  0, 'VR2: ni su foto');
select roomly_test.login('2a000000-0000-0000-0000-00000000000d');
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR2: la propietaria desactivada sigue viendo su habitación (rooms_select_own)');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR2: y su foto');
select roomly_test.login('2a000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id in ('2a100000-0000-0000-0000-000000000002',
                                        '2a100000-0000-0000-0000-000000000003')$$,
  2, 'VR2: el admin ve la habitación oculta y el borrador (rooms_admin_all)');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id in ('2a100000-0000-0000-0000-000000000002',
                                              '2a100000-0000-0000-0000-000000000003')$$,
  2, 'VR2: y sus fotos (room_images_admin_select)');
reset role;
select roomly_test.ok(
  (select status = 'active' and deleted_at is null and title = 'R2 activa de D'
   from public.rooms where id = '2a100000-0000-0000-0000-000000000002')
  and exists (select 1 from public.room_images where id = '2a200000-0000-0000-0000-000000000002'),
  'VR2: ocultar no cambia datos: R2 sigue activa y su foto sigue ahí');

-- ------------------------------------------------------------
-- 3. La función responde lo mismo que el SELECT, nada más
-- ------------------------------------------------------------
set role anon;
select roomly_test.login(null);
select roomly_test.ok(
  (select bool_and(public.is_room_publicly_visible(v.id)
                   = exists (select 1 from public.rooms r where r.id = v.id))
   from (values ('2a100000-0000-0000-0000-000000000001'::uuid),
                ('2a100000-0000-0000-0000-000000000002'::uuid),
                ('2a100000-0000-0000-0000-000000000003'::uuid),
                ('2a100000-0000-0000-0000-000000000004'::uuid),
                ('2a100000-0000-0000-0000-0000000000ff'::uuid)) as v(id)),
  'VR3: para anon, la función dice lo mismo que ya revela un SELECT de rooms (también para un id que no existe)');
select roomly_test.ok(
  public.is_room_publicly_visible('2a100000-0000-0000-0000-000000000001')
  and not public.is_room_publicly_visible('2a100000-0000-0000-0000-000000000002')
  and not public.is_room_publicly_visible('2a100000-0000-0000-0000-000000000003')
  and not public.is_room_publicly_visible('2a100000-0000-0000-0000-0000000000ff')
  and not public.is_room_publicly_visible(null),
  'VR3: oculta, borrador, inexistente y nulo dan lo mismo: false (no distingue una cuenta desactivada)');
reset role;

-- ------------------------------------------------------------
-- 4. Pausar sigue ocultando (sin cambios) y reactivar la cuenta devuelve
--    la visibilidad
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('2a000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'paused' where id = '2a100000-0000-0000-0000-000000000004'$$,
  1, 'VR4: O pausa R4');
reset role;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id = '2a100000-0000-0000-0000-000000000004'$$,
  0, 'VR4: una habitación pausada deja de ser pública, como antes');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id = '2a100000-0000-0000-0000-000000000004'$$,
  0, 'VR4: y su foto');
reset role;
update public.profiles set deleted_at = null where id = '2a000000-0000-0000-0000-00000000000d';
set role anon;
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR4: al reactivar la cuenta de D, R2 vuelve a ser pública, sin haber perdido su estado');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR4: y su foto');
reset role;
update public.profiles set deleted_at = now() where id = '2a000000-0000-0000-0000-00000000000d';

-- ------------------------------------------------------------
-- 5. Un admin desactivado no ve lo oculto
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('2a000000-0000-0000-0000-0000000000ae');
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id in ('2a100000-0000-0000-0000-000000000002',
                                        '2a100000-0000-0000-0000-000000000003',
                                        '2a100000-0000-0000-0000-000000000004')$$,
  0, 'VR5: un admin desactivado no ve las habitaciones ocultas');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id in ('2a100000-0000-0000-0000-000000000002',
                                              '2a100000-0000-0000-0000-000000000003',
                                              '2a100000-0000-0000-0000-000000000004')$$,
  0, 'VR5: ni sus fotos');
select roomly_test.expect_rows($$select 1 from r7_images$$, 1,
  'VR5: solo la pública, como cualquiera');
reset role;

-- ------------------------------------------------------------
-- 6. Controles: la lectura pública depende de la condición nueva
-- ------------------------------------------------------------
-- Con la política de antes de la 4.2, anon volvería a ver R2.
begin;
drop policy "rooms_select_active_public" on public.rooms;
create policy "rooms_select_active_public" on public.rooms
  for select using (status = 'active' and deleted_at is null);
drop policy "room_images_select" on public.room_images;
create policy "room_images_select" on public.room_images
  for select using (exists (select 1 from public.rooms r
                            where r.id = room_images.room_id
                              and (r.status = 'active' or r.owner_id = auth.uid())));
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from r7_rooms where id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR6-control: con la política anterior, anon vería la habitación de la cuenta desactivada');
select roomly_test.expect_rows(
  $$select 1 from r7_images where room_id = '2a100000-0000-0000-0000-000000000002'$$,
  1, 'VR6-control: y su foto');
rollback;
-- Sin EXECUTE, la lectura pública falla con un error en vez de enseñar más.
begin;
revoke execute on function public.is_room_publicly_visible(uuid) from anon;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error($$select 1 from r7_rooms$$, '42501',
  'VR6: sin EXECUTE, la lectura pública de anon falla (no enseña más filas)');
rollback;
reset role;
select roomly_test.ok(
  has_function_privilege('anon', 'public.is_room_publicly_visible(uuid)', 'EXECUTE')
  and (select count(*) = 42 from pg_policies where schemaname = 'public'),
  'VR6: los controles se deshicieron: anon conserva EXECUTE y siguen 42 políticas');
drop view r7_rooms, r7_images;
