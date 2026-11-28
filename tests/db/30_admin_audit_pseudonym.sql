-- Sesión 85 — actor seudónimo en la auditoría
-- (20261130120000_admin_audit_pseudonymous_actor.sql). Decisión del
-- propietario (2026-11-27): el registro se mantiene íntegro e inmutable, y
-- haber actuado como admin no bloquea por sí solo el borrado de una cuenta.
-- Este archivo debe fallar si:
--   - `admin_action_logs.admin_id` o `reports.resolved_by` vuelven a ser FK
--     (impedirían borrar a un admin que actuó o cerró reportes);
--   - borrar a ese admin modifica o borra alguna fila del registro o del
--     reporte que cerró;
--   - la ficha del panel deja de mostrar las acciones de un admin borrado;
--   - el registro deja de ser inmutable.
--
-- U: cuenta activa. W: cuenta activa a la que U reporta. X: admin que se
-- borrará. M: admin que se queda.

reset role;
insert into auth.users (id, email) values
  ('30000000-0000-0000-0000-00000000000a', 'ps-u@test'),
  ('30000000-0000-0000-0000-00000000000c', 'ps-w@test'),
  ('30000000-0000-0000-0000-0000000000ad', 'ps-m@test'),
  ('30000000-0000-0000-0000-0000000000ae', 'ps-x@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('30000000-0000-0000-0000-00000000000a', 'Seudónimo U', '2001-01-01', 'looking_for_room'),
  ('30000000-0000-0000-0000-00000000000c', 'Seudónimo W', '2001-01-01', 'looking_for_room');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('30000000-0000-0000-0000-0000000000ad', 'Seudónimo Admin M', '1990-01-01', 'looking_for_room', 'admin'),
  ('30000000-0000-0000-0000-0000000000ae', 'Seudónimo Admin X', '1990-01-01', 'looking_for_room', 'admin');
insert into public.reports (id, reporter_id, reported_user_id, reason) values
  ('30200000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000c', 'spam');

-- ------------------------------------------------------------
-- 0. Catálogo: sin FK en las columnas del actor; el registro sigue inmutable
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and ((c.conrelid = 'public.admin_action_logs'::regclass and a.attname = 'admin_id')
        or (c.conrelid = 'public.reports'::regclass and a.attname = 'resolved_by'))),
  'PS0: admin_id y resolved_by ya no son FK');
select roomly_test.ok(
  (select count(*) from pg_trigger
   where tgrelid = 'public.admin_action_logs'::regclass and not tgisinternal
     and tgname in ('trg_admin_action_logs_append_only', 'trg_admin_action_logs_no_truncate')) = 2,
  'PS0: los dos triggers de solo añadir siguen activos');
select roomly_test.ok(
  (select count(*) from pg_constraint
   where conrelid = 'public.reports'::regclass and contype = 'f') = 3,
  'PS0: reports conserva sus otras tres FK (quién reporta, a quién y qué habitación)');

-- ------------------------------------------------------------
-- 1. X actúa: suspende y reactiva a W y cierra el reporte de U
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('30000000-0000-0000-0000-0000000000ae');
select public.admin_suspend_user('30000000-0000-0000-0000-00000000000c', 'Prueba de seudónimo');
select public.admin_reactivate_user('30000000-0000-0000-0000-00000000000c', 'Revisado');
select public.admin_set_report_status('30200000-0000-0000-0000-000000000001', 'dismissed',
                                      'Sin indicios', 'none');
reset role;

create temp table ps_before as
  select id, admin_id, action, target_type, target_id, notes, created_at
  from public.admin_action_logs where admin_id = '30000000-0000-0000-0000-0000000000ae';
select roomly_test.ok((select count(*) from ps_before) = 3,
  'PS1: las tres acciones de X están registradas con su UUID');
select roomly_test.ok(
  (select resolved_by from public.reports where id = '30200000-0000-0000-0000-000000000001')
  = '30000000-0000-0000-0000-0000000000ae',
  'PS1: el reporte cerrado lleva a X como responsable');

-- ------------------------------------------------------------
-- 2. Borrar la cuenta de X (Auth → profiles en cascada) ya no falla
-- ------------------------------------------------------------
delete from auth.users where id = '30000000-0000-0000-0000-0000000000ae';
select roomly_test.ok(
  not exists (select 1 from public.profiles where id = '30000000-0000-0000-0000-0000000000ae'),
  'PS2: el perfil de X se ha borrado aunque tenía acciones y un reporte cerrado');
select roomly_test.ok(
  (select count(*) from public.admin_action_logs l
   join ps_before b using (id)
   where (l.admin_id, l.action, l.target_type, l.target_id, l.notes, l.created_at)
         is not distinct from (b.admin_id, b.action, b.target_type, b.target_id, b.notes, b.created_at)) = 3,
  'PS2: el registro de X sigue entero y sin cambios (mismo UUID como seudónimo)');
select roomly_test.ok(
  (select (status, resolved_by, resolution_notes)
          is not distinct from ('dismissed'::public.report_status,
                                '30000000-0000-0000-0000-0000000000ae'::uuid, 'Sin indicios')
   from public.reports where id = '30200000-0000-0000-0000-000000000001'),
  'PS2: el reporte cerrado conserva su estado, su responsable seudónimo y sus notas');

-- ------------------------------------------------------------
-- 3. El panel sigue mostrando esas acciones, sin nombre
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('30000000-0000-0000-0000-0000000000ad');
select roomly_test.ok(
  (select count(*) from jsonb_array_elements(
     public.admin_get_user('30000000-0000-0000-0000-00000000000c') -> 'history') h
   where h ->> 'admin_name' is null) = 2,
  'PS3: la ficha de W conserva las dos acciones del admin borrado, con admin_name nulo');
select roomly_test.ok(
  (public.admin_get_user('30000000-0000-0000-0000-00000000000c') ->> 'suspended_by_admin')::boolean
  is false,
  'PS3: el estado de W se sigue calculando con el registro');
reset role;

-- ------------------------------------------------------------
-- 4. Inmutable también después: ni el dueño de la tabla lo reescribe
-- ------------------------------------------------------------
select roomly_test.expect_error(
  $$update public.admin_action_logs set admin_id = null
    where admin_id = '30000000-0000-0000-0000-0000000000ae'$$,
  '42501', 'PS4: el dueño de la tabla no reescribe el actor del registro');
select roomly_test.expect_error(
  $$delete from public.admin_action_logs where admin_id = '30000000-0000-0000-0000-0000000000ae'$$,
  '42501', 'PS4: ni lo borra');
set role service_role;
select roomly_test.expect_error(
  $$insert into public.admin_action_logs (admin_id, action, target_type, target_id)
    values ('30000000-0000-0000-0000-0000000000ae', 'user_suspended', 'user',
            '30000000-0000-0000-0000-00000000000c')$$,
  '42501', 'PS4: sin la FK, service_role sigue sin poder añadir filas a mano');
reset role;
