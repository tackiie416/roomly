-- H5 — Un propietario no puede deshacer la moderación de su habitación.
-- Debe fallar si alguien vuelve a permitir salir de 'removed' sin ser admin.

reset role;
insert into auth.users (id, email) values
  ('30000000-0000-0000-0000-00000000000b', 'h5-owner@test'),
  ('30000000-0000-0000-0000-00000000000d', 'h5-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('30000000-0000-0000-0000-00000000000b', 'Owner', '2000-01-01', 'looking_for_room');
-- El admin se crea como fixture de servidor: un cliente ya no puede darse role=admin (C1).
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('30000000-0000-0000-0000-00000000000d', 'Admin', '1990-01-01', 'looking_for_room', 'admin');

-- ---------- El propietario gestiona su habitación con normalidad ----------
set role authenticated;
select roomly_test.login('30000000-0000-0000-0000-00000000000b');

select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, status)
    select '31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000b',
           'Habitación luminosa', c.id, 450, '2026-10-01', 'active'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'H5: el propietario puede publicar su habitación');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'Habitación muy luminosa', price_month = 430
    where id = '31000000-0000-0000-0000-000000000001'$$,
  1, 'H5: el propietario puede editar título y precio');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'paused' where id = '31000000-0000-0000-0000-000000000001'$$,
  1, 'H5: el propietario puede pausar su habitación');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '31000000-0000-0000-0000-000000000001'$$,
  1, 'H5: el propietario puede reactivar una habitación pausada');
select roomly_test.expect_error(
  $$update public.rooms set status = 'removed' where id = '31000000-0000-0000-0000-000000000001'$$,
  '42501', 'H5: removed es estado de moderación: el propietario no lo fija él mismo');

-- ---------- Un admin la retira ----------
select roomly_test.login('30000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'removed' where id = '31000000-0000-0000-0000-000000000001'$$,
  1, 'H5: un admin puede marcar la habitación como removed');

-- ---------- El propietario intenta deshacerlo ----------
select roomly_test.login('30000000-0000-0000-0000-00000000000b');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active' where id = '31000000-0000-0000-0000-000000000001'$$,
  '42501', 'H5: el propietario NO puede reactivar una habitación removed');
select roomly_test.expect_error(
  $$update public.rooms set status = 'paused' where id = '31000000-0000-0000-0000-000000000001'$$,
  '42501', 'H5: ni pasarla a otro estado (paused) para luego activarla');
select roomly_test.expect_error(
  $$update public.rooms set status = 'active', deleted_at = null, title = 'x'
    where id = '31000000-0000-0000-0000-000000000001'$$,
  '42501', 'H5: ni combinando el cambio de status con otros campos');
select roomly_test.expect_affected(
  $$update public.rooms set description = 'corrijo la descripción'
    where id = '31000000-0000-0000-0000-000000000001'$$,
  1, 'H5: sí puede seguir editando campos que no son el estado');

reset role;
select roomly_test.ok(
  (select status = 'removed' from public.rooms where id = '31000000-0000-0000-0000-000000000001'),
  'H5: la habitación sigue removed tras los intentos del propietario');

-- ---------- Reactivación autorizada ----------
set role authenticated;
select roomly_test.login('30000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '31000000-0000-0000-0000-000000000001'$$,
  1, 'H5: un admin sí puede reactivarla');

reset role;
update public.rooms set status = 'removed' where id = '31000000-0000-0000-0000-000000000001';
set role service_role;
select roomly_test.login(null);
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '31000000-0000-0000-0000-000000000001'$$,
  1, 'H5: el servidor (service_role) también puede reactivarla');

reset role;
