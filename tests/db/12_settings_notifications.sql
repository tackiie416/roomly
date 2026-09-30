-- Fase 2.6 — ajustes: email_notifications_enabled. Sin migración nueva: fija
-- en la base de datos lo que usa /ajustes (y /perfil desde 2.4). Debe fallar
-- si un usuario activo deja de poder cambiar su propio aviso (o el cambio no
-- persiste), si puede cambiar el de otro en cualquier dirección o si el valor
-- puede quedar nulo.
--
-- Ownership sin depender de la lectura: en `profiles`, a diferencia de
-- `housing_preferences`, la política de SELECT deja a cualquier usuario
-- autenticado ver los perfiles activos (H4, sin cambios). Se comprueba que
-- la fila ajena es visible; así, un UPDATE ajeno que afecta a 0 filas solo
-- puede deberse a la condición de dueño de `profiles_update_own`.

reset role;
insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-00000000000a', 'set-a@test'),
  ('c0000000-0000-0000-0000-00000000000b', 'set-b@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('c0000000-0000-0000-0000-00000000000a', 'Ajustes A', '2000-01-01', 'looking_for_room'),
  ('c0000000-0000-0000-0000-00000000000b', 'Ajustes B', '2000-01-01', 'looking_for_room');

set role authenticated;
select roomly_test.login('c0000000-0000-0000-0000-00000000000a');

-- 1. El propio aviso se lee y se cambia en los dos sentidos.
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id = 'c0000000-0000-0000-0000-00000000000a' and email_notifications_enabled$$,
  1, 'ST1: una cuenta nueva tiene los avisos activados (default true)');
select roomly_test.expect_affected(
  $$update public.profiles set email_notifications_enabled = false
    where id = 'c0000000-0000-0000-0000-00000000000a'$$,
  1, 'ST2: una cuenta activa desactiva su aviso por email');
select roomly_test.expect_affected(
  $$update public.profiles set email_notifications_enabled = true
    where id = 'c0000000-0000-0000-0000-00000000000a'$$,
  1, 'ST3: y lo vuelve a activar');
select roomly_test.expect_error(
  $$update public.profiles set email_notifications_enabled = null
    where id = 'c0000000-0000-0000-0000-00000000000a'$$,
  '23502', 'ST4: el aviso no puede quedar nulo');

-- 2. El de otro usuario: visible (H4) y aun así no modificable.
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id = 'c0000000-0000-0000-0000-00000000000b'$$,
  1, 'ST5: la fila de B es visible para A (la lectura no explica el resultado siguiente)');
select roomly_test.expect_affected(
  $$update public.profiles set email_notifications_enabled = false
    where id = 'c0000000-0000-0000-0000-00000000000b'$$,
  0, 'ST6: A NO puede cambiar el aviso de B (ownership de profiles_update_own)');
reset role;
select roomly_test.ok(
  (select email_notifications_enabled and full_name = 'Ajustes B'
   from public.profiles where id = 'c0000000-0000-0000-0000-00000000000b'),
  'ST6: el perfil de B queda intacto');

-- 3. Dirección B → A, con persistencia comprobada leyendo el valor.
--    A cambia su aviso (legítimo) y se lee que quedó guardado; B, que ve la
--    fila de A (H4), intenta cambiarlo y no afecta a ninguna fila; la fila
--    de A sigue exactamente como la dejó A.
set role authenticated;
select roomly_test.login('c0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.profiles set email_notifications_enabled = false
    where id = 'c0000000-0000-0000-0000-00000000000a'$$,
  1, 'ST8: A desactiva su aviso');
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id = 'c0000000-0000-0000-0000-00000000000a'
      and email_notifications_enabled = false$$,
  1, 'ST8: el cambio legítimo de A persiste (se lee false)');

select roomly_test.login('c0000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id = 'c0000000-0000-0000-0000-00000000000a'
      and email_notifications_enabled = false$$,
  1, 'ST9: B ve la fila de A y su valor (SELECT no la oculta)');
select roomly_test.expect_affected(
  $$update public.profiles set email_notifications_enabled = true
    where id = 'c0000000-0000-0000-0000-00000000000a'$$,
  0, 'ST10: B NO puede cambiar el aviso de A (ownership de profiles_update_own)');
select roomly_test.expect_affected(
  $$update public.profiles set email_notifications_enabled = true, full_name = 'Suplantado'
    where id = 'c0000000-0000-0000-0000-00000000000a'$$,
  0, 'ST10: ni junto con otro campo');
reset role;
select roomly_test.ok(
  (select email_notifications_enabled = false and full_name = 'Ajustes A'
   from public.profiles where id = 'c0000000-0000-0000-0000-00000000000a'),
  'ST11: la fila de A queda intacta tras los intentos de B (sigue en false, mismo nombre)');

-- 4. Cambiar el aviso no toca el estado del onboarding.
select roomly_test.ok(
  (select onboarding_completed_at is null from public.profiles
   where id = 'c0000000-0000-0000-0000-00000000000a'),
  'ST7: cambiar el aviso no completa el onboarding');
