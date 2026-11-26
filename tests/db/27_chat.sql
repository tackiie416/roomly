-- Fase 6 — Chat entre matches, deshacer un match e interés por habitación
-- (20261127120000_chat_between_matches.sql). Este archivo debe fallar si:
--   - anon vuelve a tener algún privilegio sobre el chat, o authenticated
--     puede crear conversaciones o participantes, o modificar o borrar
--     mensajes (criterio de la Fase 6: un tercero no lee la conversación ni
--     aunque conozca el UUID);
--   - un match no abre su conversación, o deshacerlo no la cierra;
--   - alguien escribe (también service_role) en una conversación cerrada, sin
--     ser parte del match, con una cuenta desactivada, con más de 2000
--     caracteres, repitiendo el mismo client_token o más de 30 veces por
--     minuto;
--   - undo_match o room_interest_owner los ejecuta alguien que no sea
--     service_role, o room_interest_owner revela a la propietaria de una
--     habitación que no es pública.
--
-- A, B, D: cuentas activas con onboarding. C: activa, ajena. D se desactiva
-- en la sección 6.

reset role;
insert into auth.users (id, email) values
  ('27000000-0000-0000-0000-00000000000a', 'ch-a@test'),
  ('27000000-0000-0000-0000-00000000000b', 'ch-b@test'),
  ('27000000-0000-0000-0000-00000000000c', 'ch-c@test'),
  ('27000000-0000-0000-0000-00000000000d', 'ch-d@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('27000000-0000-0000-0000-00000000000a', 'Chat A', '2001-01-01', 'looking_for_room'),
  ('27000000-0000-0000-0000-00000000000b', 'Chat B', '2001-01-01', 'has_room_looking_for_roommate'),
  ('27000000-0000-0000-0000-00000000000c', 'Chat C', '2001-01-01', 'looking_for_room'),
  ('27000000-0000-0000-0000-00000000000d', 'Chat D', '2001-01-01', 'looking_for_room');
insert into public.housing_preferences (profile_id, city_id)
  select p.id, c.id
  from public.cities c
  cross join (values
    ('27000000-0000-0000-0000-00000000000a'::uuid), ('27000000-0000-0000-0000-00000000000b'),
    ('27000000-0000-0000-0000-00000000000c'), ('27000000-0000-0000-0000-00000000000d')) p(id)
  where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
where id::text like '27000000-0000-0000-0000-00000000000%';
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select v.id, v.owner_id, v.title, c.id, n.id, 500, '2026-11-01', 1, 2, v.status::public.room_status
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval',
  (values
    ('27100000-0000-0000-0000-000000000001'::uuid, '27000000-0000-0000-0000-00000000000b'::uuid, 'Activa B', 'active'),
    ('27100000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-00000000000b', 'Borrador B', 'draft')
  ) as v(id, owner_id, title, status)
  where c.slug = 'barcelona';

-- Ids generados por la base de datos, para usarlos con cualquier rol.
create temp table ch27 (k text primary key, id uuid);
grant select on ch27 to authenticated, service_role;

-- ------------------------------------------------------------
-- 0. Catálogo
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (
    select 1
    from unnest(array['public.conversations', 'public.conversation_participants', 'public.messages']) t
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('anon', t, p) or has_any_column_privilege('anon', t, 'SELECT')),
  'CH0: anon no tiene ningún privilegio sobre el chat');
select roomly_test.ok(
  (select bool_and(has_table_privilege('authenticated', t, 'SELECT'))
   from unnest(array['public.conversations', 'public.conversation_participants', 'public.messages']) t)
  and not exists (
    select 1
    from unnest(array['public.conversations', 'public.conversation_participants', 'public.messages']) t
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('authenticated', t, p)),
  'CH0: authenticated solo tiene SELECT de tabla sobre el chat');
select roomly_test.ok(
  (select array_agg(a.attname::text order by a.attname)
   from pg_attribute a
   where a.attrelid = 'public.messages'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', 'public.messages', a.attname, 'INSERT'))
  = array['client_token', 'content', 'conversation_id', 'sender_id']
  and not has_any_column_privilege('authenticated', 'public.messages', 'UPDATE')
  and not has_any_column_privilege('authenticated', 'public.conversations', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.conversations', 'UPDATE')
  and not has_any_column_privilege('authenticated', 'public.conversation_participants', 'INSERT')
  and (select array_agg(a.attname::text)
       from pg_attribute a
       where a.attrelid = 'public.conversation_participants'::regclass and a.attnum > 0
         and not a.attisdropped
         and has_column_privilege('authenticated', 'public.conversation_participants', a.attname, 'UPDATE'))
      = array['last_read_at'],
  'CH0: authenticated solo inserta 4 columnas de messages y solo actualiza last_read_at');
select roomly_test.ok(
  has_function_privilege('service_role', 'public.undo_match(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.room_interest_owner(uuid)', 'EXECUTE')
  and not exists (
    select 1
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['public.undo_match(uuid, uuid)',
                            'public.room_interest_owner(uuid)',
                            'public.open_match_conversation()',
                            'public.close_match_conversation()',
                            'public.enforce_messages_integrity()',
                            'public.touch_conversation_on_message()']) f
    where has_function_privilege(r, f, 'EXECUTE'))
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('public.undo_match(uuid, uuid)'::regprocedure,
                    'public.room_interest_owner(uuid)'::regprocedure)
      and a.grantee = 0),
  'CH0: undo_match y room_interest_owner, solo service_role; los triggers, nadie');
select roomly_test.ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.oid in ('public.enforce_messages_integrity()'::regprocedure,
                   'public.touch_conversation_on_message()'::regprocedure,
                   'public.is_conversation_participant(uuid)'::regprocedure))
  and (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
       from pg_proc p
       where p.oid in ('public.undo_match(uuid, uuid)'::regprocedure,
                       'public.room_interest_owner(uuid)'::regprocedure,
                       'public.open_match_conversation()'::regprocedure,
                       'public.close_match_conversation()'::regprocedure)),
  'CH0: SECURITY DEFINER solo donde hace falta, todas con search_path vacío');
select roomly_test.ok(
  (select array_agg(policyname::text order by policyname) from pg_policies
   where schemaname = 'public'
     and tablename in ('conversations', 'conversation_participants', 'messages'))
  = array['conversations_select_participant', 'messages_insert_participant',
          'messages_select_participant', 'participants_select_own_conversations',
          'participants_update_own'],
  'CH0: las políticas del chat no cambian (5)');

-- ------------------------------------------------------------
-- 1. Un match abre su conversación
-- ------------------------------------------------------------
set role service_role;
select roomly_test.ok(
  public.record_interest('27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000b', 77) = 'sent'
  and not exists (select 1 from public.conversations c
                  join public.conversation_participants cp on cp.conversation_id = c.id
                  where cp.user_id = '27000000-0000-0000-0000-00000000000a'),
  'CH1: sin match no hay conversación');
select roomly_test.ok(
  public.record_interest('27000000-0000-0000-0000-00000000000b', '27000000-0000-0000-0000-00000000000a', 77) = 'matched',
  'CH1: B → A crea el match');
reset role;
insert into ch27 (k, id)
  select 'ab1', c.id
  from public.conversations c
  join public.matches m on m.id = c.match_id
  where m.user_a_id = '27000000-0000-0000-0000-00000000000a'
    and m.user_b_id = '27000000-0000-0000-0000-00000000000b';
select roomly_test.ok(
  (select count(*) from ch27 where k = 'ab1') = 1
  and (select array_agg(cp.user_id::text order by cp.user_id)
       from public.conversation_participants cp
       where cp.conversation_id = (select id from ch27 where k = 'ab1'))
      = array['27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000b']
  and (select c.closed_at is null from public.conversations c
       where c.id = (select id from ch27 where k = 'ab1')),
  'CH1: el match abre una conversación con las dos personas como participantes');
select roomly_test.expect_error(
  $$insert into public.conversations (match_id)
    select c.match_id from public.conversations c where c.id = (select id from ch27 where k = 'ab1')$$,
  '23505', 'CH1: una sola conversación por match (uq_conversations_match)');

-- ------------------------------------------------------------
-- 2. Enviar y leer, solo las dos personas del match
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('27000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows($$select 1 from public.conversations$$, 1, 'CH2: A ve su conversación');
select roomly_test.expect_affected(
  $$insert into public.messages (conversation_id, sender_id, content, client_token)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', 'Hola, B',
            '27200000-0000-0000-0000-000000000001')$$,
  1, 'CH2: A escribe a B');
select roomly_test.expect_error(
  $$insert into public.messages (conversation_id, sender_id, content, client_token)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', 'Hola, B',
            '27200000-0000-0000-0000-000000000001')$$,
  '23505', 'CH2: repetir el envío con el mismo client_token no duplica el mensaje');
select roomly_test.expect_rows($$select 1 from public.messages$$, 1, 'CH2: un solo mensaje');
select roomly_test.expect_check_violation(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', repeat('x', 2001))$$,
  'chk_messages_content_length', 'CH2: más de 2000 caracteres, rechazado');
select roomly_test.expect_affected(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', repeat('y', 2000))$$,
  1, 'CH2: 2000 caracteres justos, aceptado');
select roomly_test.expect_check_violation(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', '   ')$$,
  'chk_content_not_empty', 'CH2: un mensaje vacío, rechazado');
select roomly_test.expect_error(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000b', 'suplantando a B')$$,
  '42501', 'CH2: A no envía como B');
select roomly_test.expect_denied(
  $$insert into public.messages (conversation_id, sender_id, content, created_at)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', 'del futuro', now() + interval '1 day')$$,
  'CH2: A no fija la fecha del mensaje');
select roomly_test.expect_denied(
  $$update public.messages set content = 'editado'$$, 'CH2: A no edita mensajes');
select roomly_test.expect_denied(
  $$delete from public.messages$$, 'CH2: A no borra mensajes');
select roomly_test.expect_denied(
  $$insert into public.conversations (match_id) values (null)$$, 'CH2: A no crea conversaciones');
select roomly_test.expect_denied(
  $$insert into public.conversation_participants (conversation_id, user_id)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000c')$$,
  'CH2: A no añade participantes');
select roomly_test.expect_denied(
  $$update public.conversations set closed_at = now()$$, 'CH2: A no cierra conversaciones');

select roomly_test.login('27000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows($$select 1 from public.messages$$, 2, 'CH2: B lee los dos mensajes de A');
reset role;
select roomly_test.ok(
  (select c.last_message_at is not null from public.conversations c
   where c.id = (select id from ch27 where k = 'ab1'))
  and (select cp.last_read_at is not null from public.conversation_participants cp
       where cp.conversation_id = (select id from ch27 where k = 'ab1')
         and cp.user_id = '27000000-0000-0000-0000-00000000000a')
  and (select cp.last_read_at is null from public.conversation_participants cp
       where cp.conversation_id = (select id from ch27 where k = 'ab1')
         and cp.user_id = '27000000-0000-0000-0000-00000000000b'),
  'CH2: enviar actualiza last_message_at y deja el chat leído solo para quien envía');

-- ------------------------------------------------------------
-- 3. Un tercero, ni con el UUID
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('27000000-0000-0000-0000-00000000000c');
select roomly_test.expect_rows(
  $$select 1 from public.conversations where id = (select id from ch27 where k = 'ab1')$$, 0,
  'CH3: C no ve la conversación de A y B aunque conozca su UUID');
select roomly_test.expect_rows(
  $$select 1 from public.messages where conversation_id = (select id from ch27 where k = 'ab1')$$, 0,
  'CH3: C no lee sus mensajes');
select roomly_test.expect_rows(
  $$select 1 from public.conversation_participants where conversation_id = (select id from ch27 where k = 'ab1')$$, 0,
  'CH3: C no ve quién participa');
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000c', 'intrusión')$$,
  '23514', 'message_sender_invalid:', 'CH3: C no escribe en ella');
select roomly_test.expect_affected(
  $$update public.conversation_participants set last_read_at = now()$$, 0,
  'CH3: C no marca como leída una conversación ajena');

-- ------------------------------------------------------------
-- 4. El trigger también frena a service_role
-- ------------------------------------------------------------
reset role;
set role service_role;
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000c', 'desde el servidor')$$,
  '23514', 'message_sender_invalid:', 'CH4: ni service_role escribe como alguien ajeno al match');
select roomly_test.expect_error_prefix(
  $$update public.messages set content = 'editado' where sender_id = '27000000-0000-0000-0000-00000000000a'$$,
  '23514', 'message_immutable:', 'CH4: ni service_role modifica un mensaje');
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values (gen_random_uuid(), '27000000-0000-0000-0000-00000000000a', 'a ninguna parte')$$,
  '23514', 'message_conversation_closed:', 'CH4: ni a una conversación inexistente');

-- ------------------------------------------------------------
-- 5. room_interest_owner
-- ------------------------------------------------------------
select roomly_test.ok(
  public.room_interest_owner('27100000-0000-0000-0000-000000000001') = '27000000-0000-0000-0000-00000000000b'
  and public.room_interest_owner('27100000-0000-0000-0000-000000000002') is null
  and public.room_interest_owner(gen_random_uuid()) is null,
  'CH5: room_interest_owner solo responde con una habitación pública');
reset role;
set role authenticated;
select roomly_test.login('27000000-0000-0000-0000-00000000000a');
select roomly_test.expect_denied(
  $$select public.room_interest_owner('27100000-0000-0000-0000-000000000001')$$,
  'CH5: A no ejecuta room_interest_owner');
select roomly_test.expect_denied(
  $$select public.undo_match('27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000b')$$,
  'CH5: A no ejecuta undo_match');
set role anon;
select roomly_test.login(null);
select roomly_test.expect_denied(
  $$select public.room_interest_owner('27100000-0000-0000-0000-000000000001')$$,
  'CH5: anon no ejecuta room_interest_owner');
-- Un interés por habitación llega con su contexto y cuenta para el match.
reset role;
set role service_role;
select roomly_test.ok(
  public.record_interest('27000000-0000-0000-0000-00000000000c', '27000000-0000-0000-0000-00000000000b', 60,
                         '27100000-0000-0000-0000-000000000001') = 'sent',
  'CH5: C envía un interés por la habitación de B');
select roomly_test.ok(
  (select i.room_id from public.interests i
       where i.from_user_id = '27000000-0000-0000-0000-00000000000c'
         and i.to_user_id = '27000000-0000-0000-0000-00000000000b') = '27100000-0000-0000-0000-000000000001',
  'CH5: el interés de C por la habitación de B guarda la habitación');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('27000000-0000-0000-0000-00000000000d', '27000000-0000-0000-0000-00000000000b', 60,
                                  '27100000-0000-0000-0000-000000000002')$$,
  '23514', 'interest_room_invalid:', 'CH5: un borrador no admite intereses');

-- ------------------------------------------------------------
-- 6. Una cuenta desactivada bloquea el envío
-- ------------------------------------------------------------
select roomly_test.ok(
  public.record_interest('27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000d', 70) = 'sent'
  and public.record_interest('27000000-0000-0000-0000-00000000000d', '27000000-0000-0000-0000-00000000000a', 70) = 'matched',
  'CH6: match A–D');
reset role;
insert into ch27 (k, id)
  select 'ad', c.id
  from public.conversations c
  join public.matches m on m.id = c.match_id
  where m.user_a_id = '27000000-0000-0000-0000-00000000000a'
    and m.user_b_id = '27000000-0000-0000-0000-00000000000d';
update public.profiles set deleted_at = now() where id = '27000000-0000-0000-0000-00000000000d';
set role authenticated;
select roomly_test.login('27000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ad'), '27000000-0000-0000-0000-00000000000a', '¿Sigues ahí?')$$,
  '23514', 'message_sender_invalid:', 'CH6: no se escribe a una cuenta desactivada');
reset role;
update public.profiles set deleted_at = null where id = '27000000-0000-0000-0000-00000000000d';

-- ------------------------------------------------------------
-- 7. Deshacer el match cierra el chat
-- ------------------------------------------------------------
set role service_role;
select roomly_test.ok(
  public.undo_match('27000000-0000-0000-0000-00000000000b', '27000000-0000-0000-0000-00000000000a') = 'undone',
  'CH7: B deshace el match con A');
select roomly_test.ok(
  not exists (select 1 from public.matches
              where user_a_id = '27000000-0000-0000-0000-00000000000a'
                and user_b_id = '27000000-0000-0000-0000-00000000000b')
  and not exists (select 1 from public.interests
                  where from_user_id in ('27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000b')
                    and to_user_id in ('27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000b'))
  and (select c.closed_at is not null and c.match_id is null from public.conversations c
       where c.id = (select id from ch27 where k = 'ab1')),
  'CH7: sin match, sin los dos intereses y con la conversación cerrada');
select roomly_test.ok(
  public.undo_match('27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000b') = 'not_found',
  'CH7: deshacerlo otra vez: not_found');
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', 'tarde')$$,
  '23514', 'message_conversation_closed:', 'CH7: ni service_role escribe en un chat cerrado');
reset role;
set role authenticated;
select roomly_test.login('27000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.conversations where id = (select id from ch27 where k = 'ab1')$$, 0,
  'CH7: A ya no ve la conversación cerrada');
select roomly_test.expect_rows(
  $$select 1 from public.messages where conversation_id = (select id from ch27 where k = 'ab1')$$, 0,
  'CH7: ni sus mensajes');
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab1'), '27000000-0000-0000-0000-00000000000a', '¿Hola?')$$,
  '23514', 'message_conversation_closed:', 'CH7: ni escribe en ella');
select roomly_test.login('27000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.messages where conversation_id = (select id from ch27 where k = 'ab1')$$, 0,
  'CH7: B tampoco la lee');
reset role;
select roomly_test.expect_check_violation(
  $$update public.conversations set closed_at = null where id = (select id from ch27 where k = 'ab1')$$,
  'chk_conversations_open_has_match', 'CH7: una conversación sin match no se reabre');

-- Volver a hacer match abre una conversación nueva, vacía.
set role service_role;
select roomly_test.ok(
  public.record_interest('27000000-0000-0000-0000-00000000000a', '27000000-0000-0000-0000-00000000000b', 77) = 'sent'
  and public.record_interest('27000000-0000-0000-0000-00000000000b', '27000000-0000-0000-0000-00000000000a', 77) = 'matched',
  'CH7: nuevo match A–B');
reset role;
insert into ch27 (k, id)
  select 'ab2', c.id
  from public.conversations c
  join public.matches m on m.id = c.match_id
  where m.user_a_id = '27000000-0000-0000-0000-00000000000a'
    and m.user_b_id = '27000000-0000-0000-0000-00000000000b';
set role authenticated;
select roomly_test.login('27000000-0000-0000-0000-00000000000a');
select roomly_test.ok(
  (select id from ch27 where k = 'ab2') <> (select id from ch27 where k = 'ab1'),
  'CH7: la conversación nueva no es la cerrada');
select roomly_test.expect_rows(
  $$select 1 from public.messages where conversation_id = (select id from ch27 where k = 'ab2')$$, 0,
  'CH7: y no trae los mensajes anteriores');

-- ------------------------------------------------------------
-- 8. Ritmo: 30 mensajes por minuto y remitente
-- ------------------------------------------------------------
reset role;
set role service_role;
do $$
begin
  for i in 1..30 loop
    insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab2'), '27000000-0000-0000-0000-00000000000b', 'mensaje ' || i);
  end loop;
end $$;
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from ch27 where k = 'ab2'), '27000000-0000-0000-0000-00000000000b', 'uno de más')$$,
  'P0001', 'rate_limit_exceeded:', 'CH8: el mensaje 31 en un minuto se rechaza');

reset role;
drop table ch27;
