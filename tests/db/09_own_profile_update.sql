-- Fase 2.4 — edición del perfil propio (/perfil). Sin migración nueva: fija
-- en la base de datos el contrato que usa la pantalla. Debe fallar si una
-- cuenta activa deja de poder escribir alguno de los campos editables, o si
-- `id`, `created_at` o `updated_at` pasan a ser actualizables por el
-- cliente, o si se puede editar un perfil ajeno. (Cuenta eliminada: 08.)

reset role;
insert into auth.users (id, email) values
  ('90000000-0000-0000-0000-00000000000a', 'own-a@test'),
  ('90000000-0000-0000-0000-00000000000b', 'own-b@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('90000000-0000-0000-0000-00000000000a', 'Propia', '2000-01-01', 'looking_for_room'),
  ('90000000-0000-0000-0000-00000000000b', 'Ajena', '2000-01-01', 'looking_for_room');

set role authenticated;
select roomly_test.login('90000000-0000-0000-0000-00000000000a');

-- 1. Todos los campos de /perfil en un solo UPDATE (lo que envía updateProfile).
select roomly_test.expect_affected(
  $$update public.profiles
    set full_name = 'Propia editada', date_of_birth = '1999-01-02',
        seeking_status = 'flexible', bio = null, email_notifications_enabled = false
    where id = '90000000-0000-0000-0000-00000000000a'$$,
  1, 'OP1: una cuenta activa actualiza todos los campos editables de /perfil');
select roomly_test.ok(
  (select full_name = 'Propia editada' and date_of_birth = '1999-01-02'
          and seeking_status = 'flexible' and bio is null
          and email_notifications_enabled = false and onboarding_completed_at is null
   from public.profiles where id = '90000000-0000-0000-0000-00000000000a'),
  'OP1: los valores quedan guardados y onboarding_completed_at no cambia');

-- 2. Columnas fuera del GRANT de UPDATE.
select roomly_test.expect_error(
  $$update public.profiles set id = '90000000-0000-0000-0000-0000000000ff'
    where id = '90000000-0000-0000-0000-00000000000a'$$,
  '42501', 'OP2: id no es actualizable por el cliente');
select roomly_test.expect_error(
  $$update public.profiles set created_at = now() - interval '1 year'
    where id = '90000000-0000-0000-0000-00000000000a'$$,
  '42501', 'OP3: created_at no es actualizable por el cliente');
select roomly_test.expect_error(
  $$update public.profiles set updated_at = now() - interval '1 year'
    where id = '90000000-0000-0000-0000-00000000000a'$$,
  '42501', 'OP4: updated_at no es actualizable por el cliente');

-- 3. Perfil ajeno: 0 filas, aunque se conozca su id.
select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'Suplantada', bio = 'x'
    where id = '90000000-0000-0000-0000-00000000000b'$$,
  0, 'OP5: no se puede editar el perfil de otra persona');
reset role;
select roomly_test.ok(
  (select full_name = 'Ajena' and bio is null from public.profiles
   where id = '90000000-0000-0000-0000-00000000000b'),
  'OP5: el perfil ajeno queda intacto');

-- 4. Las restricciones de la base de datos siguen aplicando al editar.
set role authenticated;
select roomly_test.login('90000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$update public.profiles set seeking_status = null
    where id = '90000000-0000-0000-0000-00000000000a'$$,
  '23502', 'OP6: seeking_status no se puede vaciar');
select roomly_test.expect_error(
  $$update public.profiles set email_notifications_enabled = null
    where id = '90000000-0000-0000-0000-00000000000a'$$,
  '23502', 'OP7: email_notifications_enabled no se puede vaciar');
select roomly_test.expect_error(
  $$update public.profiles set bio = repeat('b', 501)
    where id = '90000000-0000-0000-0000-00000000000a'$$,
  '23514', 'OP8: bio de más de 500 caracteres se rechaza');
reset role;
