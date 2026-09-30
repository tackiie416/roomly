-- Decisión B (auditoría 2.3) — 20260930130000_block_deleted_account_writes.sql.
-- Debe fallar si una cuenta con `deleted_at` puede volver a escribir su
-- perfil o sus preferencias por PostgREST, si cambia la lectura, o si el
-- admin / service_role pierden lo que ya podían hacer.
-- A: activa · D: se elimina a mitad del test (con preferencias) ·
-- E: eliminada sin preferencias · X: admin.

reset role;
insert into auth.users (id, email) values
  ('80000000-0000-0000-0000-00000000000a', 'del-a@test'),
  ('80000000-0000-0000-0000-00000000000d', 'del-d@test'),
  ('80000000-0000-0000-0000-00000000000e', 'del-e@test'),
  ('80000000-0000-0000-0000-0000000000ad', 'del-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('80000000-0000-0000-0000-00000000000a', 'Activa', '2000-01-01', 'looking_for_room'),
  ('80000000-0000-0000-0000-00000000000d', 'Eliminada D', '2000-01-01', 'looking_for_room');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, deleted_at) values
  ('80000000-0000-0000-0000-00000000000e', 'Eliminada E', '2000-01-01', 'looking_for_room', now());
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('80000000-0000-0000-0000-0000000000ad', 'Admin', '1990-01-01', 'looking_for_room', 'admin');
insert into public.housing_preferences (profile_id, city_id, budget_max)
  select '80000000-0000-0000-0000-00000000000d', id, 600
  from public.cities where slug = 'barcelona';

-- ------------------------------------------------------------
-- 1. Una cuenta activa escribe con normalidad.
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('80000000-0000-0000-0000-00000000000a');

select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'Activa editada'
    where id = '80000000-0000-0000-0000-00000000000a'$$,
  1, 'DA1: una cuenta activa actualiza su perfil');
select roomly_test.expect_affected(
  $$insert into public.housing_preferences (profile_id, city_id, budget_max)
    select '80000000-0000-0000-0000-00000000000a', id, 500
    from public.cities where slug = 'barcelona'$$,
  1, 'DA2: una cuenta activa crea sus preferencias');
select roomly_test.expect_affected(
  $$update public.housing_preferences set budget_max = 800
    where profile_id = '80000000-0000-0000-0000-00000000000a'$$,
  1, 'DA3: una cuenta activa actualiza sus preferencias');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = '80000000-0000-0000-0000-00000000000a'$$,
  1, 'DA4: una cuenta activa borra sus preferencias');

-- ------------------------------------------------------------
-- 2. D escribe mientras está activa; después se elimina su cuenta y se
--    reintenta con el MISMO JWT (no se vuelve a hacer login): RLS mira el
--    valor actual de deleted_at, no el token.
-- ------------------------------------------------------------
select roomly_test.login('80000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$update public.housing_preferences set budget_max = 650
    where profile_id = '80000000-0000-0000-0000-00000000000d'$$,
  1, 'DD0: antes de eliminarse, D actualiza sus preferencias');

reset role;
update public.profiles set deleted_at = now()
  where id = '80000000-0000-0000-0000-00000000000d';
set role authenticated;

select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'Reactivada', bio = 'x'
    where id = '80000000-0000-0000-0000-00000000000d'$$,
  0, 'DD1: una cuenta eliminada NO actualiza su perfil (mismo JWT)');
select roomly_test.expect_affected(
  $$update public.profiles set email_notifications_enabled = false
    where id = '80000000-0000-0000-0000-00000000000d'$$,
  0, 'DD1b: ni siquiera una preferencia de notificaciones');
select roomly_test.expect_affected(
  $$update public.housing_preferences set budget_max = 9999
    where profile_id = '80000000-0000-0000-0000-00000000000d'$$,
  0, 'DD2: una cuenta eliminada NO actualiza sus preferencias');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = '80000000-0000-0000-0000-00000000000d'$$,
  0, 'DD3: una cuenta eliminada NO borra sus preferencias');

-- Lectura sin cambios: el propietario sigue viendo sus filas.
select roomly_test.expect_rows(
  $$select 1 from public.profiles
    where id = '80000000-0000-0000-0000-00000000000d' and full_name = 'Eliminada D'$$,
  1, 'DD4: la cuenta eliminada sigue leyendo su perfil, sin cambios');
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences
    where profile_id = '80000000-0000-0000-0000-00000000000d' and budget_max = 650$$,
  1, 'DD4: y sus preferencias, sin cambios');

-- E: eliminada sin preferencias, no puede crearlas.
select roomly_test.login('80000000-0000-0000-0000-00000000000e');
select roomly_test.expect_error(
  $$insert into public.housing_preferences (profile_id, budget_max)
    values ('80000000-0000-0000-0000-00000000000e', 500)$$,
  '42501', 'DE1: una cuenta eliminada NO crea preferencias');
select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'Reactivada'
    where id = '80000000-0000-0000-0000-00000000000e'$$,
  0, 'DE2: ni actualiza su perfil');

-- La lectura ajena tampoco cambia: A no ve las preferencias de D.
select roomly_test.login('80000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences
    where profile_id = '80000000-0000-0000-0000-00000000000d'$$,
  0, 'DA5: un usuario sigue sin ver preferencias ajenas');

-- ------------------------------------------------------------
-- 3. Capacidades administrativas intactas.
-- ------------------------------------------------------------
select roomly_test.login('80000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update public.profiles set bio = 'moderado por admin'
    where id = '80000000-0000-0000-0000-00000000000d'$$,
  1, 'DX1: un admin sigue pudiendo editar el perfil de una cuenta eliminada');

set role service_role;
select roomly_test.expect_affected(
  $$update public.profiles set full_name = 'Eliminada D (servidor)'
    where id = '80000000-0000-0000-0000-00000000000d'$$,
  1, 'DX2: service_role actualiza el perfil de una cuenta eliminada');
select roomly_test.expect_affected(
  $$update public.housing_preferences set budget_max = 700
    where profile_id = '80000000-0000-0000-0000-00000000000d'$$,
  1, 'DX3: service_role actualiza sus preferencias');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = '80000000-0000-0000-0000-00000000000d'$$,
  1, 'DX4: service_role borra sus preferencias');
select roomly_test.expect_affected(
  $$insert into public.housing_preferences (profile_id, budget_max)
    values ('80000000-0000-0000-0000-00000000000e', 500)$$,
  1, 'DX5: service_role crea preferencias de una cuenta eliminada');

-- ------------------------------------------------------------
-- 4. Estructura: lectura idéntica y escrituras separadas.
-- ------------------------------------------------------------
reset role;
select roomly_test.ok(
  (select count(*) = 4 from pg_policies
   where schemaname = 'public' and tablename = 'housing_preferences'),
  'DS1: housing_preferences tiene 4 políticas (select, insert, update, delete)');
select roomly_test.ok(
  (select qual = '(auth.uid() = profile_id)' and cmd = 'SELECT'
   from pg_policies
   where schemaname = 'public' and tablename = 'housing_preferences'
     and policyname = 'housing_preferences_select_own'),
  'DS2: la lectura de housing_preferences mantiene la condición anterior');
select roomly_test.ok(
  not exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'housing_preferences'
                and cmd = 'ALL'),
  'DS3: ya no queda ninguna política FOR ALL en housing_preferences');
