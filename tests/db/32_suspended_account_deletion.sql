-- Sesión 88 — eliminación de una cuenta suspendida por un admin
-- (20261202120000_suspended_account_deletion.sql). Este archivo debe fallar si:
--   - una cuenta suspendida no puede pedir y completar su eliminación;
--   - un admin puede reactivar una cuenta con la eliminación pendiente (la
--     dejaría activa a medio borrar);
--   - el panel no ve la eliminación pendiente;
--   - tras eliminarla se pierden la suspensión (auditoría) o los reportes
--     recibidos, o queda algún dato personal suyo.
--
-- S: cuenta que se suspende y se elimina. R: la reporta. M: admin.

reset role;
insert into auth.users (id, email) values
  ('32000000-0000-0000-0000-00000000000a', 'sd-s@test'),
  ('32000000-0000-0000-0000-00000000000b', 'sd-r@test'),
  ('32000000-0000-0000-0000-0000000000ad', 'sd-m@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, bio) values
  ('32000000-0000-0000-0000-00000000000a', 'Suspendida S', '2001-01-01', 'looking_for_room', 'Bio de S'),
  ('32000000-0000-0000-0000-00000000000b', 'Reporta R', '2001-01-01', 'looking_for_room', null),
  ('32000000-0000-0000-0000-0000000000ad', 'Admin M', '1990-01-01', 'looking_for_room', null);
update public.profiles set role = 'admin' where id = '32000000-0000-0000-0000-0000000000ad';
insert into public.reports (id, reporter_id, reported_user_id, reason) values
  ('32300000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-00000000000b',
   '32000000-0000-0000-0000-00000000000a', 'scam');

-- El admin suspende a S.
set role authenticated;
select roomly_test.login('32000000-0000-0000-0000-0000000000ad');
select roomly_test.ok(
  public.admin_suspend_user('32000000-0000-0000-0000-00000000000a', 'Estafa reportada') = 'suspended',
  'SD-prep: el admin suspende a S');
select roomly_test.ok(
  (public.admin_get_user('32000000-0000-0000-0000-00000000000a') ->> 'deletion_requested_at') is null,
  'SD0: sin solicitud, el panel no ve ninguna eliminación pendiente');
reset role;

-- SD1: la suspensión no impide pedir la eliminación.
set role service_role;
select roomly_test.ok(
  public.request_account_deletion('32000000-0000-0000-0000-00000000000a') ->> 'status' = 'pending',
  'SD1: una cuenta suspendida pide su eliminación');
reset role;

-- SD2: con la eliminación pendiente, el admin no puede reactivarla.
set role authenticated;
select roomly_test.login('32000000-0000-0000-0000-0000000000ad');
select roomly_test.ok(
  (public.admin_get_user('32000000-0000-0000-0000-00000000000a') ->> 'deletion_requested_at') is not null,
  'SD2: el panel ve la eliminación pendiente');
select roomly_test.expect_error_prefix(
  $$select public.admin_reactivate_user('32000000-0000-0000-0000-00000000000a', 'Revisado')$$,
  '23514', 'admin_state: la cuenta tiene una eliminación pendiente',
  'SD2: no se reactiva una cuenta con la eliminación pendiente');
reset role;
select roomly_test.ok(
  (select deleted_at is not null from public.profiles where id = '32000000-0000-0000-0000-00000000000a'),
  'SD2: sigue desactivada');
select roomly_test.ok(
  (select count(*) = 1 from public.admin_action_logs
   where target_id = '32000000-0000-0000-0000-00000000000a'),
  'SD2: el intento rechazado no deja rastro en la auditoría');

-- SD3: la eliminación termina igual que la de una cuenta no suspendida.
set role service_role;
select roomly_test.ok(
  public.delete_account_data('32000000-0000-0000-0000-00000000000a') ->> 'status' = 'deleted',
  'SD3: se borran sus datos');
reset role;
delete from auth.users where id = '32000000-0000-0000-0000-00000000000a';
set role service_role;
select roomly_test.ok(
  public.complete_account_deletion('32000000-0000-0000-0000-00000000000a'),
  'SD3: la solicitud se completa');
reset role;
select roomly_test.ok(
  not exists (select 1 from public.profiles where id = '32000000-0000-0000-0000-00000000000a'),
  'SD3: no queda su perfil (ni nombre ni bio)');

-- SD4: se conservan, con el UUID como seudónimo, la suspensión y el reporte.
select roomly_test.ok(
  (select count(*) = 1 from public.admin_action_logs
   where target_id = '32000000-0000-0000-0000-00000000000a' and action = 'user_suspended'
     and notes = 'Estafa reportada'),
  'SD4: la suspensión sigue en la auditoría, sin cambios');
select roomly_test.ok(
  (select reported_user_id = '32000000-0000-0000-0000-00000000000a'
   from public.reports where id = '32300000-0000-0000-0000-000000000001'),
  'SD4: el reporte recibido se conserva');

-- SD5: con la solicitud completada, la reactivación da «no existe», no otro error.
set role authenticated;
select roomly_test.login('32000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error(
  $$select public.admin_reactivate_user('32000000-0000-0000-0000-00000000000a', 'Revisado')$$,
  'P0002', 'SD5: la cuenta eliminada ya no existe para el panel');
reset role;
