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

-- Una sola escritura (Fase 2.9, 20261004120000): ya completado, no vuelve a
-- NULL. Antes de la 2.9 esto estaba permitido. El resto de casos, en 11–13.
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000a'$$,
  '23514', 'OB5b: volver a poner onboarding_completed_at a null se rechaza (onboarding_locked)');
select roomly_test.ok(
  (select onboarding_completed_at is not null from public.profiles
   where id = '70000000-0000-0000-0000-00000000000a'),
  'OB5b: el onboarding sigue completado');

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

-- ------------------------------------------------------------
-- 11–13. Una sola escritura para todos los roles (Fase 2.9, punto A de 2.3;
-- 20261004120000). D completa su onboarding con una fecha fija; después,
-- ningún rol (D, un admin, service_role ni el dueño de las tablas) puede
-- volver a NULL ni cambiar la fecha. Reescribir el mismo valor sí se puede.
-- ------------------------------------------------------------
insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-00000000000d', 'ob-d@test'),
  ('70000000-0000-0000-0000-00000000000e', 'ob-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('70000000-0000-0000-0000-00000000000d', 'OB D', '2000-01-01', 'looking_for_room', 'user'),
  ('70000000-0000-0000-0000-00000000000e', 'OB Admin', '2000-01-01', 'flexible', 'admin');
insert into public.housing_preferences (profile_id, city_id)
  select '70000000-0000-0000-0000-00000000000d', id from public.cities where slug = 'barcelona';

set role authenticated;
select roomly_test.login('70000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$update public.profiles set onboarding_completed_at = '2026-01-01 10:00:00+00'
    where id = '70000000-0000-0000-0000-00000000000d'
      and onboarding_completed_at is null$$,
  1, 'OB11: D completa su onboarding');

-- 11. El propio usuario.
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB11: el usuario no vuelve a poner su onboarding a null');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = '2026-06-01 10:00:00+00'
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB11: el usuario no cambia la fecha a una posterior');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = '2025-01-01 10:00:00+00'
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB11: ni a una anterior');
select roomly_test.expect_error(
  $$update public.profiles
    set onboarding_completed_at = onboarding_completed_at + interval '1 microsecond'
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB11: ni en un microsegundo');
select roomly_test.expect_error(
  $$update public.profiles set full_name = 'OB D cambiado', onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB11: ni junto con otro campo (se rechaza la sentencia entera)');
select roomly_test.expect_affected(
  $$update public.profiles set onboarding_completed_at = '2026-01-01 10:00:00+00'
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  1, 'OB11: reescribir exactamente la misma fecha está permitido');
select roomly_test.expect_affected(
  $$update public.profiles set onboarding_completed_at = onboarding_completed_at
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  1, 'OB11: y asignarse a sí misma también');
select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'OB D editado', bio = 'Hola'
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  1, 'OB11: con el onboarding completo, editar otros campos sigue funcionando');

-- 12. Un admin (profiles_admin_all le deja escribir la fila de D: lo único
--     que lo impide es el trigger).
select roomly_test.login('70000000-0000-0000-0000-00000000000e');
select roomly_test.expect_affected(
  $$update public.profiles set bio = 'Revisado'
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  1, 'OB12: el admin puede editar otros campos del perfil de D (control positivo)');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB12: el admin no reinicia el onboarding de D');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = now()
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB12: ni le cambia la fecha');

-- 13. service_role (sin RLS) y el dueño de las tablas: tampoco.
set role service_role;
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB13: service_role no vuelve a null');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = now()
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB13: service_role no cambia la fecha');
select roomly_test.expect_affected(
  $$update public.profiles set onboarding_completed_at = '2026-01-01 10:00:00+00'
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  1, 'OB13: service_role puede reescribir la misma fecha');
-- Sin preferencias (service_role puede borrarlas) sigue sin poder volver a
-- null: el bloqueo no depende de ellas.
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = '70000000-0000-0000-0000-00000000000d'$$,
  1, 'OB13: service_role borra las preferencias de D');
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB13: sin preferencias, tampoco vuelve a null');
reset role;
select roomly_test.expect_error(
  $$update public.profiles set onboarding_completed_at = null
    where id = '70000000-0000-0000-0000-00000000000d'$$,
  '23514', 'OB13: el dueño de las tablas tampoco');
select roomly_test.ok(
  (select onboarding_completed_at = '2026-01-01 10:00:00+00'
          and full_name = 'OB D editado' and bio = 'Revisado'
   from public.profiles where id = '70000000-0000-0000-0000-00000000000d'),
  'OB13: la fecha original se conserva y solo persistieron las ediciones permitidas');

-- 14. La función sigue igual de cerrada (20260930120000 + 20261004120000).
select roomly_test.ok(
  (select not p.prosecdef
          and p.proconfig = array['search_path=""']
          and not has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
   from pg_proc p
   where p.oid = 'public.enforce_onboarding_completion()'::regprocedure),
  'OB14: SECURITY INVOKER, search_path vacío y sin EXECUTE para anon/authenticated');
select roomly_test.ok(
  (select count(*) = 1 from pg_trigger t
   where t.tgrelid = 'public.profiles'::regclass
     and t.tgfoid = 'public.enforce_onboarding_completion()'::regprocedure
     and not t.tgisinternal and t.tgenabled <> 'D'),
  'OB14: un único trigger activo usa la función');
