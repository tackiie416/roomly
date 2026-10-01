-- C1 — Escalado de privilegios vía profiles.role
-- Debe fallar si alguien vuelve a permitir que un usuario normal se cree o
-- se convierta en admin.

reset role;
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-00000000000a', 'c1-a@test'),
  ('10000000-0000-0000-0000-00000000000b', 'c1-b@test');

set role authenticated;
select roomly_test.login('10000000-0000-0000-0000-00000000000a');

select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status, role)
    values ('10000000-0000-0000-0000-00000000000a', 'A', '2000-01-01', 'looking_for_room', 'admin')$$,
  '42501', 'C1: un usuario NO puede crear su propio perfil con role=admin');

select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status, role)
    values ('10000000-0000-0000-0000-00000000000a', 'A', '2000-01-01', 'looking_for_room', 'user')$$,
  '42501', 'C1: role no se puede ni siquiera enviar en el INSERT (GRANT de columnas)');

select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status, deleted_at)
    values ('10000000-0000-0000-0000-00000000000a', 'A', '2000-01-01', 'looking_for_room', now())$$,
  '42501', 'C1: deleted_at tampoco es insertable por el cliente');

select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status)
    values ('10000000-0000-0000-0000-00000000000b', 'Suplantado', '2000-01-01', 'looking_for_room')$$,
  '42501', 'C1: un usuario NO puede crear el perfil de otra persona');

select roomly_test.expect_affected(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status, bio)
    values ('10000000-0000-0000-0000-00000000000a', 'A', '2000-01-01', 'looking_for_room', 'hola')$$,
  1, 'C1: el flujo normal (crear el propio perfil sin role) sigue funcionando');

select roomly_test.ok(
  (select role = 'user' from public.profiles where id = '10000000-0000-0000-0000-00000000000a'),
  'C1: el perfil creado por el cliente queda con role=user (default)');

select roomly_test.ok(not public.is_admin(), 'C1: is_admin() es false para el usuario recién creado');

select roomly_test.expect_error(
  $$update public.profiles set role = 'admin' where id = '10000000-0000-0000-0000-00000000000a'$$,
  '42501', 'C1: un usuario NO puede cambiar después su role');

select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status)
    values ('10000000-0000-0000-0000-00000000000a', 'A', '2000-01-01', 'looking_for_room')
    on conflict (id) do update set role = 'admin'$$,
  '42501', 'C1: tampoco vía upsert (INSERT ... ON CONFLICT DO UPDATE SET role)');

select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'A editado', bio = 'nueva bio'
    where id = '10000000-0000-0000-0000-00000000000a'$$,
  1, 'C1: el usuario sigue pudiendo editar sus campos normales');

select roomly_test.ok(
  (select role = 'user' from public.profiles where id = '10000000-0000-0000-0000-00000000000a'),
  'C1: tras todos los intentos, role sigue siendo user');

-- anon: sin sesión no crea perfiles
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status)
    values ('10000000-0000-0000-0000-00000000000b', 'B', '2000-01-01', 'looking_for_room')$$,
  '42501', 'C1: anon no puede insertar perfiles');

reset role;
