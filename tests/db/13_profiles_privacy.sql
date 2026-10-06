-- Fase 2.9 — H4: privacidad de `profiles` (20261004120100_profiles_privacy.sql).
-- Debe fallar si un usuario autenticado vuelve a poder leer el perfil (y su
-- `date_of_birth`) de otra persona, si pierde el acceso a su propio perfil,
-- si un admin activo deja de leerlos todos, si anon lee alguno, o si la vista
-- pública deja de funcionar o empieza a exponer `date_of_birth`.
--
-- A y B: cuentas activas. C: cuenta eliminada. E: admin activo. F: admin con
-- la cuenta eliminada (no es admin: `is_admin()` exige `deleted_at` nulo).

reset role;
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-00000000000a', 'priv-a@test'),
  ('d0000000-0000-0000-0000-00000000000b', 'priv-b@test'),
  ('d0000000-0000-0000-0000-00000000000c', 'priv-c@test'),
  ('d0000000-0000-0000-0000-00000000000e', 'priv-admin@test'),
  ('d0000000-0000-0000-0000-00000000000f', 'priv-admin-eliminado@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, bio, role, deleted_at) values
  ('d0000000-0000-0000-0000-00000000000a', 'Privacidad A', '2001-02-03', 'looking_for_room', 'Bio A', 'user', null),
  ('d0000000-0000-0000-0000-00000000000b', 'Privacidad B', '1999-05-05', 'looking_for_room', 'Bio B', 'user', null),
  ('d0000000-0000-0000-0000-00000000000c', 'Privacidad C', '1998-07-07', 'flexible', null, 'user', now()),
  ('d0000000-0000-0000-0000-00000000000e', 'Privacidad Admin', '1990-01-01', 'flexible', null, 'admin', null),
  ('d0000000-0000-0000-0000-00000000000f', 'Privacidad Admin F', '1990-01-01', 'flexible', null, 'admin', now());

-- ------------------------------------------------------------
-- 1–3. A no lee el perfil de B, ni conociendo su id, ni su fecha de nacimiento.
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('d0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id <> 'd0000000-0000-0000-0000-00000000000a'$$,
  0, 'PV1: A no ve ningún perfil que no sea el suyo');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id = 'd0000000-0000-0000-0000-00000000000b'$$,
  0, 'PV2: conocer el id de B no permite leer su perfil');
select roomly_test.expect_rows(
  $$select date_of_birth from public.profiles
    where id = 'd0000000-0000-0000-0000-00000000000b'$$,
  0, 'PV3: la fecha de nacimiento de B no es legible por profiles');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where date_of_birth = '1999-05-05'$$,
  0, 'PV3: ni filtrando por ella (no revela que exista)');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where full_name = 'Privacidad B' or bio = 'Bio B'$$,
  0, 'PV3: ni el resto de la fila de B (nombre, bio)');

-- ------------------------------------------------------------
-- 4–5. El propio perfil, también eliminado.
-- ------------------------------------------------------------
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id = 'd0000000-0000-0000-0000-00000000000a'
      and date_of_birth = '2001-02-03' and bio = 'Bio A'$$,
  1, 'PV4: A sigue leyendo su propio perfil completo, con su fecha de nacimiento');
select roomly_test.login('d0000000-0000-0000-0000-00000000000c');
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id = 'd0000000-0000-0000-0000-00000000000c' and deleted_at is not null$$,
  1, 'PV5: una cuenta eliminada sigue leyendo su propio perfil (profiles_select_own_even_if_deleted)');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id <> 'd0000000-0000-0000-0000-00000000000c'$$,
  0, 'PV5: y ningún otro');
select roomly_test.login('d0000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id = 'd0000000-0000-0000-0000-00000000000c'$$,
  0, 'PV5: nadie más ve la cuenta eliminada');

-- ------------------------------------------------------------
-- 6. Admin: un admin activo lee todos (profiles_admin_all); uno eliminado, no.
-- ------------------------------------------------------------
select roomly_test.login('d0000000-0000-0000-0000-00000000000e');
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id in ('d0000000-0000-0000-0000-00000000000a',
                 'd0000000-0000-0000-0000-00000000000b',
                 'd0000000-0000-0000-0000-00000000000c')$$,
  3, 'PV6: un admin activo lee los perfiles de A, B y la cuenta eliminada C');
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id = 'd0000000-0000-0000-0000-00000000000b' and date_of_birth = '1999-05-05'$$,
  1, 'PV6: incluida la fecha de nacimiento');
select roomly_test.login('d0000000-0000-0000-0000-00000000000f');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id <> 'd0000000-0000-0000-0000-00000000000f'$$,
  0, 'PV6: un admin con la cuenta eliminada no lee perfiles ajenos');

-- ------------------------------------------------------------
-- 7. anon no lee ninguno.
-- ------------------------------------------------------------
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.profiles$$,
  0, 'PV7: anon no lee ningún perfil');

-- ------------------------------------------------------------
-- 8–9. La vista pública sigue funcionando y no expone date_of_birth.
-- ------------------------------------------------------------
select roomly_test.expect_rows(
  $$select 1 from public.public_profile_previews
    where id = 'd0000000-0000-0000-0000-00000000000b' and full_name = 'Privacidad B'$$,
  1, 'PV8: anon lee el nombre de B en public_profile_previews');
select roomly_test.expect_error(
  $$select date_of_birth from public.public_profile_previews$$,
  '42703', 'PV9: public_profile_previews no tiene date_of_birth (anon)');
set role authenticated;
select roomly_test.login('d0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.public_profile_previews
    where id = 'd0000000-0000-0000-0000-00000000000b' and full_name = 'Privacidad B'$$,
  1, 'PV8: A lee el nombre de B en public_profile_previews (la vía para datos de otros)');
select roomly_test.expect_rows(
  $$select 1 from public.public_profile_previews
    where id = 'd0000000-0000-0000-0000-00000000000c'$$,
  0, 'PV8: la vista sigue sin mostrar cuentas eliminadas');
select roomly_test.expect_error(
  $$select date_of_birth from public.public_profile_previews$$,
  '42703', 'PV9: public_profile_previews no tiene date_of_birth (authenticated)');
reset role;
select roomly_test.ok(
  (select array_agg(column_name::text order by column_name)
          = array['avatar_url', 'full_name', 'id', 'role']
   from information_schema.columns
   where table_schema = 'public' and table_name = 'public_profile_previews'),
  'PV9: la vista expone exactamente id, full_name, avatar_url y role');

-- ------------------------------------------------------------
-- 10. Políticas de profiles: exactamente las esperadas.
-- ------------------------------------------------------------
select roomly_test.ok(
  (select array_agg(policyname::text || ':' || cmd::text order by policyname)
          = array['profiles_admin_all:ALL', 'profiles_insert_own:INSERT',
                  'profiles_select_own_even_if_deleted:SELECT', 'profiles_update_own:UPDATE']
   from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  'PV10: profiles tiene exactamente sus 4 políticas (sin profiles_select_authenticated)');
select roomly_test.ok(
  (select array_agg(policyname::text order by policyname)
          = array['profiles_admin_all', 'profiles_select_own_even_if_deleted']
   from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and cmd in ('SELECT', 'ALL')),
  'PV10: las únicas que dan lectura son la propia y la de admin');
select roomly_test.ok(
  (select count(*) = 37 from pg_policies where schemaname = 'public'),
  'PV10: 37 políticas en public');
