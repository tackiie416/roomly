-- Sesión 87 — eliminación de la cuenta propia y exportación de los mensajes
-- propios (20261201120000_account_deletion.sql). Este archivo debe fallar si:
--   - un cliente (anon o authenticated) puede pedir, ejecutar o completar una
--     eliminación, o leer las solicitudes;
--   - se borran datos sin solicitud, con la cuenta activa o con fotos todavía
--     en Storage (el orden de docs/SECURITY.md, «Cascadas desde profiles y
--     Auth»);
--   - tras la eliminación quedan sus mensajes, su acceso a chats, sus
--     relaciones, habitaciones o datos de perfil, o desaparecen los mensajes
--     de la otra persona, los reportes o la auditoría;
--   - el proceso no es idempotente, o un reporte o una acción de admin
--     impiden borrar la cuenta en Auth;
--   - export_own_messages devuelve mensajes de otra persona o funciona sin
--     sesión;
--   - un reporte puede apuntar a una persona o habitación que no existe.
--
-- A: cuenta que se elimina (con habitación, foto, match y chat con B,
-- bloqueo a C, un reporte hecho y uno recibido). B: match de A. C: ajena.

reset role;
insert into auth.users (id, email) values
  ('31000000-0000-0000-0000-00000000000a', 'ad-a@test'),
  ('31000000-0000-0000-0000-00000000000b', 'ad-b@test'),
  ('31000000-0000-0000-0000-00000000000c', 'ad-c@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, bio) values
  ('31000000-0000-0000-0000-00000000000a', 'Borrar A', '2001-01-01', 'has_room_looking_for_roommate', 'Bio de A'),
  ('31000000-0000-0000-0000-00000000000b', 'Borrar B', '2001-01-01', 'looking_for_room', null),
  ('31000000-0000-0000-0000-00000000000c', 'Borrar C', '2001-01-01', 'looking_for_room', null);
insert into public.housing_preferences (profile_id, city_id)
  select p.id, c.id
  from public.cities c
  cross join (values
    ('31000000-0000-0000-0000-00000000000a'::uuid), ('31000000-0000-0000-0000-00000000000b'),
    ('31000000-0000-0000-0000-00000000000c')) p(id)
  where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
where id::text like '31000000-0000-0000-0000-00000000000%';
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms)
  select '31100000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-00000000000a',
         'Habitación de A', c.id, n.id, 500, '2026-11-01', 1, 2
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval'
  where c.slug = 'barcelona';
insert into public.room_addresses (room_id, address_exact)
  values ('31100000-0000-0000-0000-000000000001', 'Carrer de A 1');
set role service_role;
insert into public.room_images (id, room_id, storage_path, position) values
  ('31200000-0000-0000-0000-000000000001', '31100000-0000-0000-0000-000000000001',
   '31100000-0000-0000-0000-000000000001/31200000-0000-0000-0000-000000000001.webp', 0);
select roomly_test.ok(
  public.record_interest('31000000-0000-0000-0000-00000000000a', '31000000-0000-0000-0000-00000000000b', 80) = 'sent'
  and public.record_interest('31000000-0000-0000-0000-00000000000b', '31000000-0000-0000-0000-00000000000a', 80) = 'matched',
  'AD-prep: A y B tienen un match');
reset role;
insert into storage.objects (bucket_id, name)
  values ('room-images', '31100000-0000-0000-0000-000000000001/31200000-0000-0000-0000-000000000001.webp');
create temp table ad31 (k text primary key, id uuid);
grant select on ad31 to authenticated, service_role;
insert into ad31 (k, id)
  select 'conv', c.id from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where cp.user_id = '31000000-0000-0000-0000-00000000000a';

set role authenticated;
select roomly_test.login('31000000-0000-0000-0000-00000000000a');
insert into public.messages (conversation_id, sender_id, content)
  values ((select id from ad31 where k = 'conv'), '31000000-0000-0000-0000-00000000000a', 'Mensaje de A');
select roomly_test.login('31000000-0000-0000-0000-00000000000b');
insert into public.messages (conversation_id, sender_id, content)
  values ((select id from ad31 where k = 'conv'), '31000000-0000-0000-0000-00000000000b', 'Mensaje de B');
reset role;
insert into public.user_blocks (blocker_id, blocked_id)
  values ('31000000-0000-0000-0000-00000000000a', '31000000-0000-0000-0000-00000000000c');
insert into public.reports (id, reporter_id, reported_user_id, reason) values
  ('31300000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-00000000000a',
   '31000000-0000-0000-0000-00000000000c', 'spam'),
  ('31300000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-00000000000c',
   '31000000-0000-0000-0000-00000000000a', 'scam');
insert into public.reports (id, reporter_id, reported_room_id, reason) values
  ('31300000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-00000000000c',
   '31100000-0000-0000-0000-000000000001', 'scam');

-- ------------------------------------------------------------
-- 0. Catálogo y privilegios
-- ------------------------------------------------------------
select roomly_test.ok(
  (select count(*) from pg_constraint
   where conrelid = 'public.reports'::regclass and contype = 'f') = 0,
  'AD0: reports ya no tiene FK (actor y destino seudónimos)');
select roomly_test.ok(
  not has_function_privilege('authenticated', 'public.request_account_deletion(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.request_account_deletion(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.delete_account_data(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.delete_account_data(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_account_deletion(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.request_account_deletion(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.delete_account_data(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.complete_account_deletion(uuid)', 'execute'),
  'AD0: las tres funciones de eliminación, solo para service_role');
select roomly_test.ok(
  has_function_privilege('authenticated', 'public.export_own_messages()', 'execute')
  and not has_function_privilege('anon', 'public.export_own_messages()', 'execute'),
  'AD0: export_own_messages, solo con sesión');
select roomly_test.ok(
  not has_table_privilege('authenticated', 'public.account_deletion_requests', 'select')
  and not has_table_privilege('anon', 'public.account_deletion_requests', 'select')
  and not has_table_privilege('service_role', 'public.account_deletion_requests', 'insert')
  and not has_table_privilege('service_role', 'public.account_deletion_requests', 'update')
  and not has_table_privilege('service_role', 'public.account_deletion_requests', 'delete'),
  'AD0: las solicitudes no las lee ningún cliente ni las escribe nadie a mano');

-- ------------------------------------------------------------
-- 1. Un cliente no pide ni ejecuta la eliminación
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('31000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$select public.request_account_deletion('31000000-0000-0000-0000-00000000000a')$$,
  '42501', 'AD1: A no llama a request_account_deletion desde el cliente');
select roomly_test.expect_error(
  $$select public.delete_account_data('31000000-0000-0000-0000-00000000000c')$$,
  '42501', 'AD1: ni a delete_account_data (tampoco sobre otra persona)');
reset role;

-- ------------------------------------------------------------
-- 2. Sin solicitud, nada
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.delete_account_data('31000000-0000-0000-0000-00000000000a')$$,
  '42501', 'account_deletion_not_requested', 'AD2: sin solicitud no se borra nada');
select roomly_test.expect_error_prefix(
  $$select public.request_account_deletion('31000000-0000-0000-0000-0000000000ff')$$,
  'P0002', 'account_not_found', 'AD2: una cuenta que no existe');
reset role;

-- ------------------------------------------------------------
-- 3. La solicitud desactiva y es idempotente
-- ------------------------------------------------------------
set role service_role;
select roomly_test.ok(
  public.request_account_deletion('31000000-0000-0000-0000-00000000000a')
  = '{"status": "pending", "rooms": ["31100000-0000-0000-0000-000000000001"]}'::jsonb,
  'AD3: pendiente, con su habitación para limpiar Storage');
select roomly_test.ok(
  public.request_account_deletion('31000000-0000-0000-0000-00000000000a') ->> 'status' = 'pending',
  'AD3: repetirla no falla');
reset role;
select roomly_test.ok(
  (select deleted_at is not null from public.profiles where id = '31000000-0000-0000-0000-00000000000a')
  and (select count(*) from public.account_deletion_requests
       where user_id = '31000000-0000-0000-0000-00000000000a' and completed_at is null) = 1,
  'AD3: la cuenta queda desactivada y la solicitud anotada una vez');

-- ------------------------------------------------------------
-- 4. Con fotos en Storage, no se borra nada
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.delete_account_data('31000000-0000-0000-0000-00000000000a')$$,
  '55000', 'account_deletion_storage_pending: 1 fotos', 'AD4: Storage primero');
reset role;
select roomly_test.ok(
  exists (select 1 from public.rooms where id = '31100000-0000-0000-0000-000000000001')
  and (select count(*) from public.messages where conversation_id = (select id from ad31 where k = 'conv')) = 2,
  'AD4: la habitación y los mensajes siguen');

-- ------------------------------------------------------------
-- 5. Con Storage vacío: borra lo de A y conserva lo de los demás
-- ------------------------------------------------------------
delete from storage.objects
  where name = '31100000-0000-0000-0000-000000000001/31200000-0000-0000-0000-000000000001.webp';
set role service_role;
select roomly_test.ok(
  public.delete_account_data('31000000-0000-0000-0000-00000000000a') ->> 'status' = 'deleted',
  'AD5: borrado');
reset role;
select roomly_test.ok(
  not exists (select 1 from public.messages where sender_id = '31000000-0000-0000-0000-00000000000a')
  and exists (select 1 from public.messages where sender_id = '31000000-0000-0000-0000-00000000000b'
              and content = 'Mensaje de B'),
  'AD5: sus mensajes se borran; los de B se quedan');
select roomly_test.ok(
  not exists (select 1 from public.conversation_participants
              where user_id = '31000000-0000-0000-0000-00000000000a')
  and (select closed_at is not null from public.conversations
       where id = (select id from ad31 where k = 'conv')),
  'AD5: A pierde el acceso al chat y la conversación queda cerrada para B');
select roomly_test.ok(
  not exists (select 1 from public.matches
              where '31000000-0000-0000-0000-00000000000a' in (user_a_id, user_b_id))
  and not exists (select 1 from public.interests
                  where '31000000-0000-0000-0000-00000000000a' in (from_user_id, to_user_id))
  and not exists (select 1 from public.user_blocks
                  where '31000000-0000-0000-0000-00000000000a' in (blocker_id, blocked_id)),
  'AD5: sin matches, intereses ni bloqueos');
select roomly_test.ok(
  not exists (select 1 from public.rooms where owner_id = '31000000-0000-0000-0000-00000000000a')
  and not exists (select 1 from public.room_images where room_id = '31100000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.room_addresses where room_id = '31100000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.housing_preferences
                  where profile_id = '31000000-0000-0000-0000-00000000000a'),
  'AD5: sin habitaciones, fotos, dirección ni preferencias');
select roomly_test.ok(
  (select (full_name, bio, date_of_birth, email_notifications_enabled)
          is not distinct from ('Cuenta eliminada'::text, null::text, date '1900-01-01', false)
   from public.profiles where id = '31000000-0000-0000-0000-00000000000a'),
  'AD5: el perfil, mientras exista, queda anonimizado');
select roomly_test.ok(
  (select count(*) from public.reports where id::text like '31300000-%') = 3,
  'AD5: los tres reportes (hecho, recibido y sobre su habitación) se conservan');

-- ------------------------------------------------------------
-- 6. Idempotente y completable
-- ------------------------------------------------------------
set role service_role;
select roomly_test.ok(
  public.delete_account_data('31000000-0000-0000-0000-00000000000a') ->> 'status' = 'deleted',
  'AD6: repetir el borrado no falla');
select roomly_test.ok(
  public.complete_account_deletion('31000000-0000-0000-0000-00000000000a') is false,
  'AD6: no se completa mientras el usuario de Auth exista');
reset role;
delete from auth.users where id = '31000000-0000-0000-0000-00000000000a';
select roomly_test.ok(
  not exists (select 1 from public.profiles where id = '31000000-0000-0000-0000-00000000000a'),
  'AD6: borrar el usuario de Auth (con reportes hechos y recibidos) ya no falla');
set role service_role;
select roomly_test.ok(
  public.complete_account_deletion('31000000-0000-0000-0000-00000000000a') is true,
  'AD6: completada');
select roomly_test.ok(
  public.request_account_deletion('31000000-0000-0000-0000-00000000000a') ->> 'status' = 'profile_absent'
  and public.delete_account_data('31000000-0000-0000-0000-00000000000a') ->> 'status' = 'profile_absent',
  'AD6: repetir cualquier paso después no falla');
reset role;
select roomly_test.ok(
  (select completed_at is not null from public.account_deletion_requests
   where user_id = '31000000-0000-0000-0000-00000000000a')
  and (select reporter_id from public.reports where id = '31300000-0000-0000-0000-000000000001')
      = '31000000-0000-0000-0000-00000000000a',
  'AD6: la solicitud queda completada y los reportes conservan el UUID seudónimo');

-- ------------------------------------------------------------
-- 7. export_own_messages: solo lo propio, también de chats cerrados
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('31000000-0000-0000-0000-00000000000b');
select roomly_test.ok(
  (select array_agg(content) from public.export_own_messages()) = array['Mensaje de B']
  and (select bool_and(conversation_closed) and min(conversation_number) = 1
       from public.export_own_messages()),
  'AD7: B exporta su mensaje del chat cerrado, numerado y sin el de nadie más');
select roomly_test.login('31000000-0000-0000-0000-00000000000c');
select roomly_test.expect_rows($$select 1 from public.export_own_messages()$$, 0,
  'AD7: C, sin mensajes, no ve nada');
reset role;
set role anon;
select roomly_test.expect_error($$select 1 from public.export_own_messages()$$, '42501',
  'AD7: anon no la ejecuta');
reset role;

-- ------------------------------------------------------------
-- 8. Sin FK, el destino de un reporte nuevo tiene que existir
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('31000000-0000-0000-0000-00000000000c');
select roomly_test.expect_fk_violation(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('31000000-0000-0000-0000-00000000000c', '31000000-0000-0000-0000-00000000000a', 'spam')$$,
  'reports_reported_user_id_fkey', 'AD8: no se reporta a una cuenta que ya no existe');
select roomly_test.expect_fk_violation(
  $$insert into public.reports (reporter_id, reported_room_id, reason)
    values ('31000000-0000-0000-0000-00000000000c', '31100000-0000-0000-0000-000000000001', 'spam')$$,
  'reports_reported_room_id_fkey', 'AD8: ni una habitación que ya no existe');
reset role;
