-- Fase 7 (sesión 84) — Administración y moderación
-- (20261129120000_admin_moderation.sql). Este archivo debe fallar si:
--   - un usuario normal, anon, service_role o un admin desactivado ejecuta
--     con éxito alguna función admin_* (lectura o escritura);
--   - un admin vuelve a escribir desde el cliente en profiles, rooms, reports
--     o admin_action_logs (las políticas de admin son solo de lectura), o un
--     cliente borra perfiles;
--   - una acción de moderación no deja su registro en admin_action_logs, o
--     el registro se puede editar, borrar o vaciar (para cualquier rol);
--   - un admin se suspende a sí mismo o a otro admin, reactiva una cuenta que
--     no suspendió la administración, o un estado imposible se acepta;
--   - una medida que falla deja el reporte cambiado (sin atomicidad);
--   - las funciones de lectura devuelven el email, la fecha de nacimiento u
--     otros datos que el panel no necesita, o la búsqueda acepta comodines.
--
-- U, V, W: cuentas activas con onboarding. M: admin activo. N: otro admin
-- activo. Z: admin desactivado. V publica una habitación activa.

reset role;
insert into auth.users (id, email) values
  ('29000000-0000-0000-0000-00000000000a', 'am-u@test'),
  ('29000000-0000-0000-0000-00000000000b', 'am-v@test'),
  ('29000000-0000-0000-0000-00000000000c', 'am-w@test'),
  ('29000000-0000-0000-0000-0000000000ad', 'am-m@test'),
  ('29000000-0000-0000-0000-0000000000ae', 'am-n@test'),
  ('29000000-0000-0000-0000-0000000000af', 'am-z@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, bio) values
  ('29000000-0000-0000-0000-00000000000a', 'Admin Test U', '2001-01-01', 'looking_for_room', 'Hola'),
  ('29000000-0000-0000-0000-00000000000b', 'Admin Test V', '2001-01-01', 'has_room_looking_for_roommate', null),
  ('29000000-0000-0000-0000-00000000000c', 'Admin Test W 100%', '2001-01-01', 'looking_for_room', null);
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('29000000-0000-0000-0000-0000000000ad', 'Admin Test M', '1990-01-01', 'looking_for_room', 'admin'),
  ('29000000-0000-0000-0000-0000000000ae', 'Admin Test N', '1990-01-01', 'looking_for_room', 'admin');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role, deleted_at) values
  ('29000000-0000-0000-0000-0000000000af', 'Admin Test Z', '1990-01-01', 'looking_for_room', 'admin', now());
insert into public.housing_preferences (profile_id, city_id)
  select p.id, c.id
  from public.cities c
  cross join (values
    ('29000000-0000-0000-0000-00000000000a'::uuid), ('29000000-0000-0000-0000-00000000000b'),
    ('29000000-0000-0000-0000-00000000000c')) p(id)
  where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
where id in ('29000000-0000-0000-0000-00000000000a', '29000000-0000-0000-0000-00000000000b',
             '29000000-0000-0000-0000-00000000000c');
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select '29100000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-00000000000b',
         'Habitación AM de V', c.id, n.id, 520, '2026-12-01', 1, 2, 'active'
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval'
  where c.slug = 'barcelona';
insert into public.room_addresses (room_id, address_exact)
  values ('29100000-0000-0000-0000-000000000001', 'Carrer Secret AM, 1');
-- Reportes de partida: U reporta a V y a la habitación de V; W reporta a N.
insert into public.reports (id, reporter_id, reported_user_id, reason, description) values
  ('29200000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-00000000000a',
   '29000000-0000-0000-0000-00000000000b', 'harassment', 'Mensajes ofensivos'),
  ('29200000-0000-0000-0000-000000000003', '29000000-0000-0000-0000-00000000000c',
   '29000000-0000-0000-0000-0000000000ae', 'spam', null);
insert into public.reports (id, reporter_id, reported_room_id, reason) values
  ('29200000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-00000000000a',
   '29100000-0000-0000-0000-000000000001', 'scam');

-- ------------------------------------------------------------
-- 0. Catálogo: políticas, privilegios y funciones
-- ------------------------------------------------------------
select roomly_test.ok(
  (select array_agg(format('%s.%s:%s:%s', tablename, policyname, cmd, array_to_string(roles, ','))
                    order by tablename)
   from pg_policies
   where schemaname = 'public'
     and policyname in ('profiles_admin_select', 'rooms_admin_select', 'reports_admin_select',
                        'admin_action_logs_admin_select'))
  = array['admin_action_logs.admin_action_logs_admin_select:SELECT:authenticated',
          'profiles.profiles_admin_select:SELECT:authenticated',
          'reports.reports_admin_select:SELECT:authenticated',
          'rooms.rooms_admin_select:SELECT:authenticated']
  and not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and policyname in ('profiles_admin_all', 'rooms_admin_all', 'reports_admin_all',
                         'admin_action_logs_admin_only')),
  'AM0: las cuatro políticas de admin son solo SELECT para authenticated (sin las FOR ALL)');
select roomly_test.ok(
  not has_any_column_privilege('authenticated', 'public.reports', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.admin_action_logs', 'INSERT')
  and not has_table_privilege('authenticated', 'public.admin_action_logs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.admin_action_logs', 'DELETE')
  and has_table_privilege('authenticated', 'public.admin_action_logs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.profiles', 'DELETE')
  and not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.profiles', 'DELETE')
  and not has_table_privilege('anon', 'public.profiles', 'TRUNCATE'),
  'AM0: sin UPDATE de reports, admin_action_logs solo lectura y nadie borra perfiles desde un cliente');
select roomly_test.ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not has_function_privilege('service_role', p.oid, 'EXECUTE')
                   and not exists (
                     select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
     and count(*) = 10
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('admin_list_users', 'admin_get_user', 'admin_list_rooms', 'admin_get_room',
                       'admin_metrics', 'admin_suspend_user', 'admin_reactivate_user',
                       'admin_remove_room', 'admin_restore_room', 'admin_set_report_status')),
  'AM0: las 10 funciones del panel son SECURITY DEFINER, search_path vacío y EXECUTE solo de authenticated');
select roomly_test.ok(
  (select bool_and(not has_function_privilege(r, p.oid, 'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join unnest(array['anon', 'authenticated', 'service_role']) r
   where n.nspname = 'public'
     and p.proname in ('admin_require', 'admin_clean_reason', 'admin_log',
                       'enforce_admin_action_logs_append_only')),
  'AM0: las utilidades internas (admin_require, admin_clean_reason, admin_log) no las ejecuta ningún cliente');
select roomly_test.ok(
  (select array_agg(n order by n) from (
     select unnest(p.proargnames) n
     from pg_proc p where p.oid = 'public.admin_list_users(text, text, text, text, boolean, integer, integer)'::regprocedure
   ) x where n not like 'p\_%')
  = array['created_at', 'deleted_at', 'full_name', 'id', 'onboarding_completed_at', 'open_reports',
          'role', 'rooms_count', 'seeking_status', 'total_count']
  and (select array_agg(n order by n) from (
     select unnest(p.proargnames) n
     from pg_proc p where p.oid = 'public.admin_list_rooms(text, text, boolean, integer, integer)'::regprocedure
   ) x where n not like 'p\_%')
  = array['city_name', 'created_at', 'id', 'neighborhood_name', 'open_reports', 'owner_deactivated',
          'owner_id', 'owner_name', 'price_month', 'published_at', 'status', 'title', 'total_count'],
  'AM0: los listados devuelven solo sus columnas (sin email, fecha de nacimiento, approx_* ni dirección)');

-- ------------------------------------------------------------
-- 1. Nadie que no sea un admin activo ejecuta las funciones
-- ------------------------------------------------------------
create temp table am29_calls (label text, sql text);
insert into am29_calls values
  ('admin_list_users', $$select * from public.admin_list_users()$$),
  ('admin_get_user', $$select public.admin_get_user('29000000-0000-0000-0000-00000000000b')$$),
  ('admin_list_rooms', $$select * from public.admin_list_rooms()$$),
  ('admin_get_room', $$select public.admin_get_room('29100000-0000-0000-0000-000000000001')$$),
  ('admin_metrics', $$select public.admin_metrics()$$),
  ('admin_suspend_user', $$select public.admin_suspend_user('29000000-0000-0000-0000-00000000000b', 'motivo')$$),
  ('admin_reactivate_user', $$select public.admin_reactivate_user('29000000-0000-0000-0000-00000000000b', 'motivo')$$),
  ('admin_remove_room', $$select public.admin_remove_room('29100000-0000-0000-0000-000000000001', 'motivo')$$),
  ('admin_restore_room', $$select public.admin_restore_room('29100000-0000-0000-0000-000000000001', 'motivo')$$),
  ('admin_set_report_status',
   $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'dismissed', 'motivo')$$);
grant select on am29_calls to anon, authenticated, service_role;

do $$
declare
  c record;
  who record;
begin
  for who in
    select * from (values
      ('un usuario normal (U)', 'authenticated', '29000000-0000-0000-0000-00000000000a', 'admin_forbidden:'),
      ('la persona reportada (V)', 'authenticated', '29000000-0000-0000-0000-00000000000b', 'admin_forbidden:'),
      ('un admin desactivado (Z)', 'authenticated', '29000000-0000-0000-0000-0000000000af', 'admin_forbidden:'),
      ('authenticated sin sub', 'authenticated', null, 'admin_forbidden:'),
      ('anon', 'anon', null, 'permission denied'),
      ('service_role', 'service_role', null, 'permission denied')
    ) as v(label, role, uid, prefix)
  loop
    for c in select * from am29_calls loop
      begin
        execute format('set local role %I', who.role);
        perform roomly_test.login(who.uid::uuid);
        execute c.sql;
        raise exception 'FALLO: AM1: % ejecutó % sin error', who.label, c.label;
      exception
        when sqlstate '42501' then
          if sqlerrm not like who.prefix || '%' then
            raise exception 'FALLO: AM1: % → % rechazado por otro motivo: %', who.label, c.label, sqlerrm;
          end if;
      end;
      reset role;
    end loop;
    raise notice 'ok - AM1: % no ejecuta ninguna de las 10 funciones de admin (42501)', who.label;
  end loop;
end $$;
reset role;
select roomly_test.ok(
  (select status = 'active' from public.rooms where id = '29100000-0000-0000-0000-000000000001')
  and (select deleted_at is null from public.profiles where id = '29000000-0000-0000-0000-00000000000b')
  and (select status = 'pending' from public.reports where id = '29200000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.admin_action_logs
                  where target_id in ('29000000-0000-0000-0000-00000000000b',
                                      '29100000-0000-0000-0000-000000000001',
                                      '29200000-0000-0000-0000-000000000001')),
  'AM1: los intentos rechazados no cambian nada ni dejan registro');

-- ------------------------------------------------------------
-- 2. Un usuario normal tampoco llega por las tablas
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id <> '29000000-0000-0000-0000-00000000000a'$$,
  0, 'AM2: U no lee otros perfiles');
select roomly_test.expect_rows($$select 1 from public.admin_action_logs$$, 0,
  'AM2: U no lee el registro de administración');
select roomly_test.expect_rows(
  $$select 1 from public.reports where reporter_id <> '29000000-0000-0000-0000-00000000000a'$$,
  0, 'AM2: U no lee reportes ajenos');
select roomly_test.expect_error(
  $$delete from public.profiles where id = '29000000-0000-0000-0000-00000000000b'$$,
  '42501', 'AM2: U no borra perfiles (sin GRANT)');
select roomly_test.expect_error(
  $$update public.reports set status = 'dismissed' where id = '29200000-0000-0000-0000-000000000001'$$,
  '42501', 'AM2: U no resuelve su propio reporte');
select roomly_test.login('29000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows($$select 1 from public.reports$$, 0,
  'AM2: la persona reportada (V) no ve los reportes sobre ella ni sobre su habitación');

-- ------------------------------------------------------------
-- 3. Un admin tampoco escribe desde el cliente
-- ------------------------------------------------------------
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id = '29000000-0000-0000-0000-00000000000b'$$,
  1, 'AM3: M lee el perfil de V (profiles_admin_select)');
select roomly_test.expect_affected(
  $$update public.profiles set bio = 'editado por admin' where id = '29000000-0000-0000-0000-00000000000b'$$,
  0, 'AM3: M no edita el perfil de V');
select roomly_test.expect_error(
  $$delete from public.profiles where id = '29000000-0000-0000-0000-00000000000b'$$,
  '42501', 'AM3: M no borra el perfil de V (sin GRANT de DELETE)');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'cambiado', price_month = 1 where id = '29100000-0000-0000-0000-000000000001'$$,
  0, 'AM3: M no edita la habitación de V');
select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('29000000-0000-0000-0000-00000000000c', '29000000-0000-0000-0000-00000000000b', 'spam')$$,
  '42501', 'AM3: M no crea un reporte en nombre de W (antes, reports_admin_all lo permitía)');
select roomly_test.expect_error(
  $$update public.reports set status = 'dismissed' where id = '29200000-0000-0000-0000-000000000001'$$,
  '42501', 'AM3: M no actualiza reports directamente');
select roomly_test.expect_error(
  $$insert into public.admin_action_logs (admin_id, action, target_type, target_id)
    values ('29000000-0000-0000-0000-0000000000ad', 'user_suspended', 'user', '29000000-0000-0000-0000-00000000000b')$$,
  '42501', 'AM3: M no inventa entradas del registro');
select roomly_test.expect_rows(
  $$select 1 from public.room_addresses where room_id = '29100000-0000-0000-0000-000000000001'$$,
  0, 'AM3: M no lee la dirección exacta');

-- ------------------------------------------------------------
-- 4. Suspender
-- ------------------------------------------------------------
select roomly_test.expect_error_prefix(
  $$select public.admin_suspend_user('29000000-0000-0000-0000-00000000000b', '  ')$$,
  '22023', 'admin_invalid:', 'AM4: sin motivo, rechazado');
select roomly_test.expect_error_prefix(
  $$select public.admin_suspend_user('29000000-0000-0000-0000-00000000000b', repeat('x', 1001))$$,
  '22023', 'admin_invalid:', 'AM4: motivo de más de 1000 caracteres, rechazado');
select roomly_test.expect_error_prefix(
  $$select public.admin_suspend_user('29000000-0000-0000-0000-0000000000ad', 'Me suspendo')$$,
  '23514', 'admin_state:', 'AM4: un admin no se suspende a sí mismo');
select roomly_test.expect_error_prefix(
  $$select public.admin_suspend_user('29000000-0000-0000-0000-0000000000ae', 'Suspendo a N')$$,
  '23514', 'admin_state:', 'AM4: ni a otro admin');
select roomly_test.expect_error_prefix(
  $$select public.admin_suspend_user('29ffffff-0000-0000-0000-000000000000', 'No existe')$$,
  'P0002', 'admin_not_found:', 'AM4: una cuenta que no existe, P0002');
select roomly_test.ok(
  public.admin_suspend_user('29000000-0000-0000-0000-00000000000c', '  Perfil falso confirmado  ') = 'suspended',
  'AM4: M suspende a W');
select roomly_test.expect_error_prefix(
  $$select public.admin_suspend_user('29000000-0000-0000-0000-00000000000c', 'Otra vez')$$,
  '23514', 'admin_state:', 'AM4: no se suspende dos veces');
reset role;
select roomly_test.ok(
  (select deleted_at is not null from public.profiles where id = '29000000-0000-0000-0000-00000000000c')
  and (select count(*) = 1 from public.admin_action_logs
       where admin_id = '29000000-0000-0000-0000-0000000000ad' and action = 'user_suspended'
         and target_type = 'user' and target_id = '29000000-0000-0000-0000-00000000000c'
         and notes = 'Perfil falso confirmado'),
  'AM4: W queda desactivada y la acción, registrada con su autor y el motivo recortado');
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-00000000000c');
select roomly_test.expect_affected(
  $$update public.profiles set bio = 'sigo aquí' where id = '29000000-0000-0000-0000-00000000000c'$$,
  0, 'AM4: la cuenta suspendida ya no escribe en su perfil (RLS de cuentas desactivadas)');

-- ------------------------------------------------------------
-- 5. Reactivar
-- ------------------------------------------------------------
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error_prefix(
  $$select public.admin_reactivate_user('29000000-0000-0000-0000-00000000000a', 'Ya activa')$$,
  '23514', 'admin_state:', 'AM5: no se reactiva una cuenta activa');
select roomly_test.ok(
  public.admin_get_user('29000000-0000-0000-0000-00000000000c') ->> 'suspended_by_admin' = 'true',
  'AM5: la ficha de W indica que la suspendió la administración');
select roomly_test.ok(
  public.admin_reactivate_user('29000000-0000-0000-0000-00000000000c', 'Revisado: era un error') = 'reactivated',
  'AM5: M reactiva a W');
reset role;
select roomly_test.ok(
  (select deleted_at is null from public.profiles where id = '29000000-0000-0000-0000-00000000000c')
  and (select count(*) = 1 from public.admin_action_logs
       where action = 'user_reactivated' and target_id = '29000000-0000-0000-0000-00000000000c'),
  'AM5: W vuelve a estar activa y queda registrado');
-- Una desactivación que no hizo la administración no se deshace aquí.
update public.profiles set deleted_at = now() where id = '29000000-0000-0000-0000-00000000000a';
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error_prefix(
  $$select public.admin_reactivate_user('29000000-0000-0000-0000-00000000000a', 'Reactivo a U')$$,
  '23514', 'admin_state:', 'AM5: no se reactiva una cuenta desactivada por otra vía');
select roomly_test.ok(
  public.admin_get_user('29000000-0000-0000-0000-00000000000a') ->> 'suspended_by_admin' = 'false',
  'AM5: y la ficha no la presenta como suspendida por la administración');
reset role;
update public.profiles set deleted_at = null where id = '29000000-0000-0000-0000-00000000000a';

-- ------------------------------------------------------------
-- 6. Retirar y restaurar habitaciones
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error_prefix(
  $$select public.admin_restore_room('29100000-0000-0000-0000-000000000001', 'No está retirada')$$,
  '23514', 'admin_state:', 'AM6: no se restaura una habitación que no está retirada');
select roomly_test.ok(
  public.admin_remove_room('29100000-0000-0000-0000-000000000001', 'Anuncio fraudulento') = 'removed',
  'AM6: M retira la habitación de V');
select roomly_test.expect_error_prefix(
  $$select public.admin_remove_room('29100000-0000-0000-0000-000000000001', 'Otra vez')$$,
  '23514', 'admin_state:', 'AM6: no se retira dos veces');
reset role;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '29100000-0000-0000-0000-000000000001'$$,
  0, 'AM6: retirada, la habitación deja de ser pública');
reset role;
select roomly_test.ok(
  (select count(*) = 1 from public.admin_action_logs
   where action = 'room_removed' and target_type = 'room'
     and target_id = '29100000-0000-0000-0000-000000000001'
     and notes = 'Anuncio fraudulento [antes: active]'),
  'AM6: el registro guarda el motivo y el estado anterior');
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-00000000000b');
select roomly_test.expect_error_prefix(
  $$update public.rooms set status = 'active' where id = '29100000-0000-0000-0000-000000000001'$$,
  '42501', 'room_moderation:', 'AM6: la propietaria no la reactiva (H5)');
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.ok(
  public.admin_restore_room('29100000-0000-0000-0000-000000000001', 'Revisada y corregida') = 'paused',
  'AM6: M la restaura y queda en paused');
select roomly_test.login('29000000-0000-0000-0000-00000000000b');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '29100000-0000-0000-0000-000000000001'$$,
  1, 'AM6: la propietaria decide volver a publicarla');

-- ------------------------------------------------------------
-- 7. Reportes: transiciones, medidas y atomicidad
-- ------------------------------------------------------------
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'pending', null)$$,
  '23514', 'admin_state:', 'AM7: no se vuelve a pending');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'resolved', '')$$,
  '22023', 'admin_invalid:', 'AM7: resolver exige motivo');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'dismissed', 'x', 'suspend_user')$$,
  '23514', 'admin_state:', 'AM7: una medida solo al resolver');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'resolved', 'Motivo', 'remove_room')$$,
  '23514', 'admin_state:', 'AM7: retirar habitación no corresponde a un reporte de persona');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'resolved', 'Motivo', 'ban')$$,
  '22023', 'admin_invalid:', 'AM7: medida fuera del catálogo');
select roomly_test.ok(
  public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'in_review', null) = 'in_review',
  'AM7: pendiente → en revisión, sin motivo');
select roomly_test.ok(
  public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'resolved',
                                 'Acoso confirmado', 'suspend_user') = 'resolved',
  'AM7: resolver con la medida de suspender a la persona reportada');
reset role;
select roomly_test.ok(
  (select status = 'resolved' and resolved_by = '29000000-0000-0000-0000-0000000000ad'
          and resolved_at is not null and resolution_notes = 'Acoso confirmado'
   from public.reports where id = '29200000-0000-0000-0000-000000000001')
  and (select deleted_at is not null from public.profiles where id = '29000000-0000-0000-0000-00000000000b')
  and (select array_agg(action order by created_at, action) from public.admin_action_logs
       where target_id in ('29200000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-00000000000b'))
      @> array['report_in_review', 'report_resolved', 'user_suspended'],
  'AM7: el reporte queda resuelto por M, V suspendida y las tres acciones registradas');
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'dismissed', 'Cambio')$$,
  '23514', 'admin_state:', 'AM7: un reporte cerrado solo se reabre (a en revisión)');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'in_review', null)$$,
  '22023', 'admin_invalid:', 'AM7: reabrir exige motivo');
select roomly_test.ok(
  public.admin_set_report_status('29200000-0000-0000-0000-000000000001', 'in_review',
                                 'Nueva información') = 'in_review',
  'AM7: se reabre con motivo');
reset role;
select roomly_test.ok(
  (select status = 'in_review' and resolved_by is null and resolved_at is null
   from public.reports where id = '29200000-0000-0000-0000-000000000001')
  and exists (select 1 from public.admin_action_logs
              where action = 'report_reopened' and target_id = '29200000-0000-0000-0000-000000000001'),
  'AM7: reabierto, sin resolución vigente y con report_reopened en el registro');
-- Atomicidad: suspender a un admin falla, y el reporte no cambia.
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error_prefix(
  $$select public.admin_set_report_status('29200000-0000-0000-0000-000000000003', 'resolved',
                                          'Spam de N', 'suspend_user')$$,
  '23514', 'admin_state:', 'AM7: la medida sobre otro admin falla');
reset role;
select roomly_test.ok(
  (select status = 'pending' from public.reports where id = '29200000-0000-0000-0000-000000000003')
  and not exists (select 1 from public.admin_action_logs
                  where target_id = '29200000-0000-0000-0000-000000000003'),
  'AM7: si la medida falla, el reporte sigue pendiente y no queda registro (una sola transacción)');
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.ok(
  public.admin_set_report_status('29200000-0000-0000-0000-000000000002', 'resolved',
                                 'Estafa confirmada', 'remove_room') = 'resolved',
  'AM7: un reporte de habitación se resuelve retirándola');
reset role;
select roomly_test.ok(
  (select status = 'removed' from public.rooms where id = '29100000-0000-0000-0000-000000000001'),
  'AM7: la habitación queda retirada');

-- ------------------------------------------------------------
-- 8. El registro no se edita, borra ni vacía (ningún rol)
-- ------------------------------------------------------------
set role service_role;
-- Desde 20261130120000 service_role ni siquiera tiene UPDATE (42501 por
-- privilegio, antes que el trigger); el trigger lo sigue frenando para el
-- dueño de la tabla, más abajo.
select roomly_test.expect_error(
  $$update public.admin_action_logs set notes = 'manipulado'$$,
  '42501', 'AM8: service_role no edita el registro');
select roomly_test.expect_error_prefix(
  $$delete from public.admin_action_logs$$,
  '42501', 'admin_log_immutable:', 'AM8: ni lo borra');
reset role;
select roomly_test.expect_error_prefix(
  $$update public.admin_action_logs set notes = 'manipulado'$$,
  '42501', 'admin_log_immutable:', 'AM8: ni el dueño de las tablas lo edita');
select roomly_test.expect_error_prefix(
  $$delete from public.admin_action_logs$$,
  '42501', 'admin_log_immutable:', 'AM8: ni lo borra');
select roomly_test.expect_error_prefix(
  $$truncate public.admin_action_logs$$,
  '42501', 'admin_log_immutable:', 'AM8: ni lo vacía con TRUNCATE');
select roomly_test.expect_check_violation(
  $$insert into public.admin_action_logs (admin_id, action, target_type, target_id)
    values ('29000000-0000-0000-0000-0000000000ad', 'role_changed', 'user', gen_random_uuid())$$,
  'chk_admin_action_logs_action', 'AM8: solo acciones del catálogo');

-- ------------------------------------------------------------
-- 9. Lectura: filtros, búsqueda y datos mínimos
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('29000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.admin_list_users(p_search => 'admin test')$$,
  6, 'AM9: la búsqueda por nombre encuentra las seis cuentas del test');
select roomly_test.expect_rows(
  $$select 1 from public.admin_list_users(p_search => '%')$$,
  1, 'AM9: % no es un comodín (solo W tiene % en el nombre)');
select roomly_test.expect_rows(
  $$select 1 from public.admin_list_users(p_search => 'admin test', p_status => 'suspended')$$,
  2, 'AM9: filtro de suspendidas (V y Z)');
select roomly_test.expect_rows(
  $$select 1 from public.admin_list_users(p_search => 'admin test', p_role => 'admin')$$,
  3, 'AM9: filtro de rol admin');
select roomly_test.expect_rows(
  $$select 1 from public.admin_list_users(p_search => 'admin test', p_reported => true)$$,
  2, 'AM9: con reportes abiertos: V (reabierto) y N');
select roomly_test.ok(
  (select open_reports = 1 and rooms_count = 1 and total_count = 1
   from public.admin_list_users(p_search => 'admin test v')),
  'AM9: recuentos de reportes abiertos y habitaciones, y total para paginar');
select roomly_test.expect_rows(
  $$select 1 from public.admin_list_users(p_search => 'admin test', p_limit => 2, p_offset => 4)$$,
  2, 'AM9: paginación con límite y desplazamiento');
select roomly_test.expect_error_prefix(
  $$select * from public.admin_list_users(p_limit => 1000)$$,
  '22023', 'admin_invalid:', 'AM9: límite fuera de rango, rechazado');
select roomly_test.expect_error_prefix(
  $$select * from public.admin_list_users(p_status => 'todo')$$,
  '22023', 'admin_invalid:', 'AM9: filtro desconocido, rechazado');
select roomly_test.expect_rows(
  $$select 1 from public.admin_list_rooms(p_status => 'removed', p_search => 'habitación am')$$,
  1, 'AM9: listado de habitaciones retiradas');
select roomly_test.ok(
  not (public.admin_get_user('29000000-0000-0000-0000-00000000000a') ?| array['date_of_birth', 'email', 'answers', 'budget_min'])
  and (public.admin_get_user('29000000-0000-0000-0000-00000000000a') ?& array['full_name', 'history', 'reports_received', 'rooms']),
  'AM9: la ficha de una cuenta no incluye email, fecha de nacimiento ni respuestas');
select roomly_test.ok(
  not (public.admin_get_room('29100000-0000-0000-0000-000000000001') ?| array['approx_lat', 'approx_lng', 'address_exact'])
  and jsonb_array_length(public.admin_get_room('29100000-0000-0000-0000-000000000001') -> 'history') = 3,
  'AM9: la ficha de una habitación no incluye ubicación exacta y trae su historial (retirada, restaurada, retirada)');
select roomly_test.expect_error_prefix(
  $$select public.admin_get_room('29ffffff-0000-0000-0000-000000000000')$$,
  'P0002', 'admin_not_found:', 'AM9: una habitación que no existe, P0002');
select roomly_test.ok(
  (public.admin_metrics() -> 'users' ->> 'total')::int >= 6
  and (public.admin_metrics() -> 'reports' ->> 'in_review')::int >= 1
  and public.admin_metrics() ?& array['rooms', 'interests', 'matches', 'conversations', 'messages', 'blocks'],
  'AM9: métricas agregadas con todos los bloques');
reset role;
