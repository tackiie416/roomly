-- Fase 2.0 — CHECKs de longitud/forma de profiles, y que role/deleted_at
-- siguen protegidos tras la migración de Fase 2.0.

reset role;
insert into auth.users (id, email) values
  ('60000000-0000-0000-0000-00000000000a', 'pc-a@test');

set role authenticated;
select roomly_test.login('60000000-0000-0000-0000-00000000000a');

select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth)
    values ('60000000-0000-0000-0000-00000000000a', '   ', '2000-01-01')$$,
  '23514', 'PC1: full_name vacío o solo espacios se rechaza');
select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth)
    values ('60000000-0000-0000-0000-00000000000a', repeat('n', 101), '2000-01-01')$$,
  '23514', 'PC2: full_name de más de 100 caracteres se rechaza');

select roomly_test.expect_affected(
  $$insert into public.profiles (id, full_name, date_of_birth, bio, avatar_url)
    values ('60000000-0000-0000-0000-00000000000a', repeat('n', 100), '2000-01-01',
            repeat('b', 500), 'https://example.com/a.png')$$,
  1, 'PC3: valores en el límite exacto se aceptan');

select roomly_test.expect_error(
  $$update public.profiles set bio = repeat('b', 501)
    where id = '60000000-0000-0000-0000-00000000000a'$$,
  '23514', 'PC4: bio de más de 500 caracteres se rechaza');
select roomly_test.expect_error(
  $$update public.profiles set avatar_url = 'javascript:alert(1)'
    where id = '60000000-0000-0000-0000-00000000000a'$$,
  '23514', 'PC5: avatar_url que no es https se rechaza');
select roomly_test.expect_error(
  $$update public.profiles set avatar_url = 'https://example.com/' || repeat('a', 2030)
    where id = '60000000-0000-0000-0000-00000000000a'$$,
  '23514', 'PC6: avatar_url de más de 2048 caracteres se rechaza');
select roomly_test.expect_error(
  $$update public.profiles set date_of_birth = current_date - interval '17 years'
    where id = '60000000-0000-0000-0000-00000000000a'$$,
  '23514', 'PC7: chk_min_age sigue vigente (menor de 18 se rechaza)');

-- Protección de role y deleted_at (C1), comprobada de nuevo tras Fase 2.0.
select roomly_test.expect_error(
  $$update public.profiles set role = 'admin' where id = '60000000-0000-0000-0000-00000000000a'$$,
  '42501', 'PC8: role sigue sin ser actualizable por el usuario');
select roomly_test.expect_error(
  $$update public.profiles set deleted_at = now() where id = '60000000-0000-0000-0000-00000000000a'$$,
  '42501', 'PC9: deleted_at sigue sin ser actualizable por el usuario');

select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'Nombre normal', bio = null, avatar_url = null
    where id = '60000000-0000-0000-0000-00000000000a'$$,
  1, 'PC10: la edición normal del perfil sigue funcionando');

reset role;
select roomly_test.ok(
  (select role = 'user' and deleted_at is null from public.profiles
   where id = '60000000-0000-0000-0000-00000000000a'),
  'PC: role=user y deleted_at nulo tras todos los intentos');
