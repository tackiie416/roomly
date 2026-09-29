-- Fase 2.3 — integridad del onboarding (20260930120000_phase2_onboarding_integrity.sql).
-- Debe fallar si `seeking_status` vuelve a tener valor por defecto o si se
-- puede marcar el onboarding como completo sin preferencias con ciudad.

reset role;
insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-00000000000a', 'ob-a@test'),
  ('70000000-0000-0000-0000-00000000000b', 'ob-b@test'),
  ('70000000-0000-0000-0000-00000000000c', 'ob-c@test');

select roomly_test.ok(
  (select column_default is null and is_nullable = 'NO'
   from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'seeking_status'),
  'OB0: profiles.seeking_status es NOT NULL y sin DEFAULT');

set role authenticated;
select roomly_test.login('70000000-0000-0000-0000-00000000000a');

-- 1 y 2. seeking_status siempre explícito.
select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth)
    values ('70000000-0000-0000-0000-00000000000a', 'OB A', '2000-01-01')$$,
  '23502', 'OB1: un perfil sin seeking_status se rechaza (ya no hay default)');
select roomly_test.expect_affected(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status)
    values ('70000000-0000-0000-0000-00000000000a', 'OB A', '2000-01-01', 'flexible')$$,
  1, 'OB2: con seeking_status = flexible explícito se crea');
select roomly_test.ok(
  (select seeking_status = 'flexible' and onboarding_completed_at is null
   from public.profiles where id = '70000000-0000-0000-0000-00000000000a'),
  'OB2: queda flexible (elegido) y con el onboarding sin completar');

-- 3. Sin preferencias no se completa.
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = now()
    where id = '70000000-0000-0000-0000-00000000000a'$$,
  '23514', 'OB3: marcar el onboarding completo sin preferencias se rechaza');

-- 4. Con preferencias pero sin ciudad tampoco.
select roomly_test.expect_affected(
  $$insert into public.housing_preferences (profile_id, field_of_study)
    values ('70000000-0000-0000-0000-00000000000a', 'Derecho')$$,
  1, 'OB4: preferencias sin ciudad (permitido guardarlas)');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = now()
    where id = '70000000-0000-0000-0000-00000000000a'$$,
  '23514', 'OB4: marcar el onboarding completo con preferencias sin ciudad se rechaza');
select roomly_test.ok(
  (select onboarding_completed_at is null from public.profiles
   where id = '70000000-0000-0000-0000-00000000000a'),
  'OB4: los intentos rechazados no marcaron nada');

-- 5. Con ciudad sí.
select roomly_test.expect_affected(
  $$update public.housing_preferences
    set city_id = (select id from public.cities where slug = 'barcelona')
    where profile_id = '70000000-0000-0000-0000-00000000000a'$$,
  1, 'OB5: se añade la ciudad');
select roomly_test.expect_affected(
  $$update public.profiles set onboarding_completed_at = now()
    where id = '70000000-0000-0000-0000-00000000000a'
      and onboarding_completed_at is null$$,
  1, 'OB5: con preferencias y ciudad, el onboarding se completa');

-- Volver a NULL no se comprueba (no deja datos incoherentes).
select roomly_test.expect_affected(
  $$update public.profiles set onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000a'$$,
  1, 'OB5b: poner onboarding_completed_at a null está permitido');

-- 6. Tampoco en el INSERT (las preferencias necesitan el perfil antes).
select roomly_test.login('70000000-0000-0000-0000-00000000000b');
select roomly_test.expect_error(
  $$insert into public.profiles (id, full_name, date_of_birth, seeking_status, onboarding_completed_at)
    values ('70000000-0000-0000-0000-00000000000b', 'OB B', '2000-01-01', 'looking_for_room', now())$$,
  '23514', 'OB6: crear un perfil ya completo se rechaza');

-- 7. Nadie completa el onboarding de otro (RLS: 0 filas).
select roomly_test.expect_affected(
  $$update public.profiles set onboarding_completed_at = now()
    where id = '70000000-0000-0000-0000-00000000000a'$$,
  0, 'OB7: un usuario no puede tocar el onboarding de otro');

-- 8. La función del trigger no se puede llamar directamente.
select roomly_test.expect_error(
  $$select public.enforce_onboarding_completion()$$,
  '42501', 'OB8: authenticated no puede ejecutar la función del trigger');

-- 9. El trigger no rompe la edición normal ni exige nada si no se toca la columna.
select roomly_test.login('70000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'OB A editado'
    where id = '70000000-0000-0000-0000-00000000000a'$$,
  1, 'OB9: editar otros campos sigue funcionando');

-- 10. Servidor (sin RLS): mismas reglas de integridad.
reset role;
insert into public.profiles (id, full_name, date_of_birth, seeking_status)
  values ('70000000-0000-0000-0000-00000000000c', 'OB C', '2000-01-01', 'has_room_looking_for_roommate');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = now()
    where id = '70000000-0000-0000-0000-00000000000c'$$,
  '23514', 'OB10: el servidor tampoco completa sin preferencias con ciudad');
select roomly_test.ok(
  (select count(*) = 1 from pg_trigger
   where tgname = 'trg_profiles_onboarding_completion' and not tgisinternal and tgenabled <> 'D'),
  'OB10: el trigger de completitud existe y está activo');
