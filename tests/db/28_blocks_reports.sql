-- Fase 6 (sesión 83) — Bloqueos, reportes y límites contra el abuso de
-- intereses (20261128120000_blocks_reports_abuse_limits.sql). Este archivo
-- debe fallar si:
--   - un cliente escribe en user_blocks o lee los bloqueos que otra persona
--     le ha hecho (podría deducir quién la bloqueó), o lee interest_log;
--   - block_user, unblock_user o las funciones de conservación las ejecuta
--     alguien que no sea service_role;
--   - con un bloqueo, en cualquiera de los dos sentidos, se crea un interés,
--     un match o un mensaje (también service_role), o bloquear no borra el
--     match y los intereses ni cierra la conversación;
--   - retirar y reenviar intereses salta los límites, o se superan los 10
--     intereses por habitación en 24 h;
--   - un reporte duplicado, sobre una misma, con un motivo fuera del
--     catálogo o de una cuenta desactivada se acepta, la persona reportada lo
--     ve, o un admin lo resuelve en nombre de otro.
--
-- A, B, C, D, E: cuentas activas con onboarding. M: admin. B publica una
-- habitación activa.

reset role;
insert into auth.users (id, email) values
  ('28000000-0000-0000-0000-00000000000a', 'br-a@test'),
  ('28000000-0000-0000-0000-00000000000b', 'br-b@test'),
  ('28000000-0000-0000-0000-00000000000c', 'br-c@test'),
  ('28000000-0000-0000-0000-00000000000d', 'br-d@test'),
  ('28000000-0000-0000-0000-00000000000e', 'br-e@test'),
  ('28000000-0000-0000-0000-0000000000ad', 'br-m@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('28000000-0000-0000-0000-00000000000a', 'Bloq A', '2001-01-01', 'looking_for_room'),
  ('28000000-0000-0000-0000-00000000000b', 'Bloq B', '2001-01-01', 'has_room_looking_for_roommate'),
  ('28000000-0000-0000-0000-00000000000c', 'Bloq C', '2001-01-01', 'looking_for_room'),
  ('28000000-0000-0000-0000-00000000000d', 'Bloq D', '2001-01-01', 'looking_for_room'),
  ('28000000-0000-0000-0000-00000000000e', 'Bloq E', '2001-01-01', 'looking_for_room');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('28000000-0000-0000-0000-0000000000ad', 'Bloq Admin', '1990-01-01', 'looking_for_room', 'admin');
insert into public.housing_preferences (profile_id, city_id)
  select p.id, c.id
  from public.cities c
  cross join (values
    ('28000000-0000-0000-0000-00000000000a'::uuid), ('28000000-0000-0000-0000-00000000000b'),
    ('28000000-0000-0000-0000-00000000000c'), ('28000000-0000-0000-0000-00000000000d'),
    ('28000000-0000-0000-0000-00000000000e')) p(id)
  where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
where id::text like '28000000-0000-0000-0000-00000000000%';
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select '28100000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-00000000000b',
         'Activa B', c.id, n.id, 500, '2026-11-01', 1, 2, 'active'
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval'
  where c.slug = 'barcelona';

create temp table br28 (k text primary key, id uuid);
grant select on br28 to authenticated, service_role;

-- ------------------------------------------------------------
-- 0. Catálogo
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (
    select 1
    from unnest(array['public.user_blocks', 'public.interest_log']) t
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('anon', t, p))
  and has_table_privilege('authenticated', 'public.user_blocks', 'SELECT')
  and not exists (
    select 1 from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('authenticated', 'public.user_blocks', p))
  and not exists (
    select 1 from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('authenticated', 'public.interest_log', p)),
  'BR0: anon nada; authenticated solo lee user_blocks y no toca interest_log');
select roomly_test.ok(
  (select bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
   from unnest(array['public.block_user(uuid, uuid)', 'public.unblock_user(uuid, uuid)',
                     'public.purge_interest_log()',
                     'public.purge_closed_conversation_messages(timestamptz)']) f)
  and not exists (
    select 1
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['public.block_user(uuid, uuid)', 'public.unblock_user(uuid, uuid)',
                            'public.purge_interest_log()',
                            'public.purge_closed_conversation_messages(timestamptz)',
                            'public.enforce_interests_abuse_limits()', 'public.log_interest()',
                            'public.enforce_matches_not_blocked()',
                            'public.enforce_reports_integrity()']) f
    where has_function_privilege(r, f, 'EXECUTE'))
  and (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
       from pg_proc p
       where p.oid in ('public.block_user(uuid, uuid)'::regprocedure,
                       'public.unblock_user(uuid, uuid)'::regprocedure,
                       'public.purge_interest_log()'::regprocedure,
                       'public.purge_closed_conversation_messages(timestamptz)'::regprocedure,
                       'public.enforce_interests_abuse_limits()'::regprocedure,
                       'public.log_interest()'::regprocedure,
                       'public.enforce_matches_not_blocked()'::regprocedure,
                       'public.enforce_reports_integrity()'::regprocedure)),
  'BR0: funciones nuevas solo de service_role, SECURITY INVOKER y search_path vacío');
select roomly_test.ok(
  (select array_agg(a.attname::text order by a.attname)
   from pg_attribute a
   where a.attrelid = 'public.reports'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', 'public.reports', a.attname, 'UPDATE'))
  = array['resolution_notes', 'resolved_at', 'resolved_by', 'status']
  and not has_table_privilege('authenticated', 'public.reports', 'DELETE')
  and not has_any_column_privilege('anon', 'public.reports', 'UPDATE'),
  'BR0: authenticated solo actualiza la resolución de reports (y la RLS, solo un admin), sin DELETE');

-- ------------------------------------------------------------
-- 1. Bloquear borra el match y los intereses y cierra el chat
-- ------------------------------------------------------------
set role service_role;
select roomly_test.ok(
  public.record_interest('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b', 70) = 'sent'
  and public.record_interest('28000000-0000-0000-0000-00000000000b', '28000000-0000-0000-0000-00000000000a', 70) = 'matched',
  'BR1: A y B hacen match');
reset role;
insert into br28 (k, id)
  select 'ab', c.id from public.conversations c
  join public.matches m on m.id = c.match_id
  where m.user_a_id = '28000000-0000-0000-0000-00000000000a'
    and m.user_b_id = '28000000-0000-0000-0000-00000000000b';
insert into public.messages (conversation_id, sender_id, content)
  values ((select id from br28 where k = 'ab'), '28000000-0000-0000-0000-00000000000b', 'antes del bloqueo');

set role authenticated;
select roomly_test.login('28000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$select public.block_user('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b')$$,
  '42501', 'BR1: authenticated no ejecuta block_user');
select roomly_test.expect_denied(
  $$insert into public.user_blocks (blocker_id, blocked_id)
    values ('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b')$$,
  'BR1: authenticated no inserta en user_blocks');

reset role;
set role service_role;
select roomly_test.ok(
  public.block_user('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b') = 'blocked',
  'BR1: A bloquea a B');
select roomly_test.ok(
  public.block_user('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b') = 'already_blocked',
  'BR1: bloquear otra vez no duplica');
select roomly_test.ok(
  not exists (select 1 from public.matches m
              where m.user_a_id = '28000000-0000-0000-0000-00000000000a'
                and m.user_b_id = '28000000-0000-0000-0000-00000000000b')
  and not exists (select 1 from public.interests i
                  where i.from_user_id in ('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b')
                    and i.to_user_id in ('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b'))
  and (select c.closed_at is not null and c.match_id is null from public.conversations c
       where c.id = (select id from br28 where k = 'ab')),
  'BR1: sin match ni intereses, y la conversación cerrada');
select roomly_test.expect_error_prefix(
  $$select public.block_user('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000a')$$,
  '22004', 'block_invalid:', 'BR1: nadie se bloquea a sí misma');

-- ------------------------------------------------------------
-- 2. Quién ve el bloqueo
-- ------------------------------------------------------------
reset role;
set role authenticated;
select roomly_test.login('28000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows($$select 1 from public.user_blocks$$, 1, 'BR2: A ve su bloqueo');
select roomly_test.login('28000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows($$select 1 from public.user_blocks$$, 0,
  'BR2: B no ve que A la ha bloqueado');
select roomly_test.expect_rows($$select 1 from public.conversations$$, 0,
  'BR2: B ya no ve la conversación');
select roomly_test.expect_rows($$select 1 from public.messages$$, 0,
  'BR2: ni sus mensajes');
select roomly_test.expect_error_prefix(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ((select id from br28 where k = 'ab'), '28000000-0000-0000-0000-00000000000b', 'después')$$,
  '23514', 'message_conversation_closed:', 'BR2: B no escribe en la conversación cerrada');

-- ------------------------------------------------------------
-- 3. Con el bloqueo, nada nuevo en ningún sentido (también service_role)
-- ------------------------------------------------------------
reset role;
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.record_interest('28000000-0000-0000-0000-00000000000b', '28000000-0000-0000-0000-00000000000a', 70)$$,
  '23514', 'interest_party_invalid:', 'BR3: B (bloqueada) no envía interés a A, con el error de una cuenta no disponible');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b', 70)$$,
  '23514', 'interest_party_invalid:', 'BR3: A (que bloquea) tampoco envía a B');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b', 70,
                                  '28100000-0000-0000-0000-000000000001')$$,
  '23514', 'interest_party_invalid:', 'BR3: ni por su habitación');
reset role;
-- Aunque alguien desactivara el trigger de intereses, un match no se crea.
alter table public.interests disable trigger trg_interests_abuse_limits;
insert into public.interests (from_user_id, to_user_id) values
  ('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b'),
  ('28000000-0000-0000-0000-00000000000b', '28000000-0000-0000-0000-00000000000a');
alter table public.interests enable trigger trg_interests_abuse_limits;
set role service_role;
select roomly_test.expect_error_prefix(
  $$insert into public.matches (user_a_id, user_b_id, compatibility_score)
    values ('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b', 70)$$,
  '23514', 'match_party_invalid:', 'BR3: con un bloqueo no hay match (trg_matches_not_blocked)');
delete from public.interests
where from_user_id in ('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b')
  and to_user_id in ('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b');

-- ------------------------------------------------------------
-- 4. Desbloquear
-- ------------------------------------------------------------
select roomly_test.ok(
  public.unblock_user('28000000-0000-0000-0000-00000000000b', '28000000-0000-0000-0000-00000000000a') = 'not_found',
  'BR4: B no puede quitar un bloqueo que no es suyo');
select roomly_test.ok(
  public.unblock_user('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b') = 'unblocked',
  'BR4: A desbloquea a B');
select roomly_test.ok(
  public.record_interest('28000000-0000-0000-0000-00000000000b', '28000000-0000-0000-0000-00000000000a', 70) = 'sent',
  'BR4: después, B puede volver a enviar un interés');
select roomly_test.ok(
  not exists (select 1 from public.matches m
              where m.user_a_id = '28000000-0000-0000-0000-00000000000a'
                and m.user_b_id = '28000000-0000-0000-0000-00000000000b')
  and (select c.closed_at is not null from public.conversations c
       where c.id = (select id from br28 where k = 'ab')),
  'BR4: desbloquear no devuelve el match ni abre la conversación');
-- El bloqueo de B a A también impide (sentido contrario).
select roomly_test.ok(
  public.block_user('28000000-0000-0000-0000-00000000000b', '28000000-0000-0000-0000-00000000000a') = 'blocked',
  'BR4: ahora B bloquea a A (y su interés se borra)');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('28000000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-00000000000b', 70)$$,
  '23514', 'interest_party_invalid:', 'BR4: A no envía interés a quien la bloqueó');

-- ------------------------------------------------------------
-- 5. Límites del registro de intereses
-- ------------------------------------------------------------
-- Retirar y reenviar: máximo 3 envíos a la misma persona en 30 días.
select roomly_test.ok(
  public.record_interest('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d', 60) = 'sent'
  and public.withdraw_interest('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d') = 'withdrawn'
  and public.record_interest('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d', 60) = 'sent'
  and public.withdraw_interest('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d') = 'withdrawn'
  and public.record_interest('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d', 60) = 'sent'
  and public.withdraw_interest('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d') = 'withdrawn',
  'BR5: tres envíos a la misma persona, con retiradas entre medias');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d', 60)$$,
  'P0001', 'rate_limit_exceeded:', 'BR5: el cuarto envío a la misma persona en 30 días se rechaza');
select roomly_test.ok(
  (select count(*) from public.interest_log l
   where l.from_user_id = '28000000-0000-0000-0000-00000000000c'
     and l.to_user_id = '28000000-0000-0000-0000-00000000000d') = 3,
  'BR5: el registro conserva los envíos retirados (y no el rechazado)');

reset role;
-- 10 intereses por habitación en 24 h (E): registro sembrado.
insert into public.interest_log (from_user_id, to_user_id, room_id)
  select '28000000-0000-0000-0000-00000000000e', '28000000-0000-0000-0000-00000000000c', gen_random_uuid()
  from generate_series(1, 10);
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.record_interest('28000000-0000-0000-0000-00000000000e', '28000000-0000-0000-0000-00000000000b', 60,
                                  '28100000-0000-0000-0000-000000000001')$$,
  'P0001', 'rate_limit_exceeded:', 'BR5: el interés por habitación número 11 en 24 h se rechaza');
select roomly_test.ok(
  public.record_interest('28000000-0000-0000-0000-00000000000e', '28000000-0000-0000-0000-00000000000b', 60) = 'sent',
  'BR5: un interés sin habitación sí pasa (otro límite)');
reset role;
-- 30 en 24 h contando los retirados (antes bastaba con retirarlos).
insert into public.interest_log (from_user_id, to_user_id)
  select '28000000-0000-0000-0000-00000000000e', '28000000-0000-0000-0000-00000000000c'
  from generate_series(1, 19);
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.record_interest('28000000-0000-0000-0000-00000000000e', '28000000-0000-0000-0000-00000000000d', 60)$$,
  'P0001', 'rate_limit_exceeded:', 'BR5: con 30 envíos en 24 h (aunque se hayan retirado), el siguiente se rechaza');

-- ------------------------------------------------------------
-- 6. Reportes
-- ------------------------------------------------------------
reset role;
set role authenticated;
select roomly_test.login('28000000-0000-0000-0000-00000000000c');
select roomly_test.expect_affected(
  $$insert into public.reports (reporter_id, reported_user_id, reason, description)
    values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d', 'harassment', 'me insulta')$$,
  1, 'BR6: C reporta a D');
select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d', 'spam')$$,
  '23505', 'BR6: un segundo reporte abierto a la misma persona se rechaza (uq_reports_open_user)');
select roomly_test.expect_check_violation(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000e', 'no me cae bien')$$,
  'chk_reports_reason', 'BR6: un motivo fuera del catálogo, rechazado');
select roomly_test.expect_check_violation(
  $$insert into public.reports (reporter_id, reported_user_id, reason, description)
    values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000e', 'other', repeat('x', 1001))$$,
  'chk_reports_description_length', 'BR6: una descripción de más de 1000 caracteres, rechazada');
select roomly_test.expect_check_violation(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000c', 'spam')$$,
  'chk_reports_not_self', 'BR6: nadie se reporta a sí misma');
select roomly_test.expect_error(
  $$update public.reports set reason = 'spam' where reporter_id = '28000000-0000-0000-0000-00000000000c'$$,
  '42501', 'BR6: quien reporta no cambia el motivo (sin GRANT)');
select roomly_test.expect_affected(
  $$update public.reports set status = 'dismissed' where reporter_id = '28000000-0000-0000-0000-00000000000c'$$,
  0, 'BR6: ni lo cierra (la RLS solo deja a un admin)');
select roomly_test.expect_denied(
  $$delete from public.reports where reporter_id = '28000000-0000-0000-0000-00000000000c'$$,
  'BR6: ni lo borra');
select roomly_test.login('28000000-0000-0000-0000-00000000000d');
select roomly_test.expect_rows($$select 1 from public.reports$$, 0,
  'BR6: D no ve que la han reportado');

-- El admin lo resuelve con su cuenta; los datos del reporte no cambian.
select roomly_test.login('28000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_error(
  $$update public.reports set description = 'otra cosa' where reporter_id = '28000000-0000-0000-0000-00000000000c'$$,
  '42501', 'BR6: un admin tampoco cambia la descripción (sin GRANT)');
select roomly_test.expect_error_prefix(
  $$update public.reports set status = 'resolved', resolved_by = '28000000-0000-0000-0000-00000000000c'
    where reporter_id = '28000000-0000-0000-0000-00000000000c'$$,
  '23514', 'report_immutable:', 'BR6: no se resuelve en nombre de otra persona');
select roomly_test.expect_affected(
  $$update public.reports set status = 'in_review' where reporter_id = '28000000-0000-0000-0000-00000000000c'$$,
  1, 'BR6: el admin lo pasa a revisión');
select roomly_test.expect_affected(
  $$update public.reports set status = 'resolved', resolution_notes = 'avisada'
    where reporter_id = '28000000-0000-0000-0000-00000000000c'$$,
  1, 'BR6: y lo resuelve');
select roomly_test.ok(
  (select resolved_by = '28000000-0000-0000-0000-0000000000ad' and resolved_at is not null
   from public.reports where reporter_id = '28000000-0000-0000-0000-00000000000c'),
  'BR6: resolved_by es el admin y resolved_at se fija solo');

-- Resuelto, se puede volver a reportar; diez en 24 h como máximo.
select roomly_test.login('28000000-0000-0000-0000-00000000000c');
select roomly_test.expect_affected(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000d', 'spam')$$,
  1, 'BR6: con el anterior resuelto, un reporte nuevo a D se acepta');
reset role;
insert into public.reports (reporter_id, reported_room_id, reason)
  select '28000000-0000-0000-0000-00000000000c', '28100000-0000-0000-0000-000000000001', 'scam'
  from generate_series(1, 1);
insert into public.reports (reporter_id, reported_user_id, reason, status)
  select '28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000e', 'spam', 'dismissed'
  from generate_series(1, 7);
set role authenticated;
select roomly_test.login('28000000-0000-0000-0000-00000000000c');
select roomly_test.expect_error_prefix(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000e', 'spam')$$,
  'P0001', 'rate_limit_exceeded:', 'BR6: el reporte número 11 en 24 h se rechaza');

-- Una cuenta desactivada no reporta.
reset role;
update public.profiles set deleted_at = now() where id = '28000000-0000-0000-0000-00000000000e';
set role authenticated;
select roomly_test.login('28000000-0000-0000-0000-00000000000e');
select roomly_test.expect_error_prefix(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('28000000-0000-0000-0000-00000000000e', '28000000-0000-0000-0000-00000000000d', 'spam')$$,
  '23514', 'report_invalid:', 'BR6: una cuenta desactivada no reporta');

-- ------------------------------------------------------------
-- 7. Conservación (preparada, sin uso en la app)
-- ------------------------------------------------------------
reset role;
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.purge_closed_conversation_messages(now())$$,
  '22023', 'purge_invalid:', 'BR7: no se purgan conversaciones cerradas hace menos de 30 días');
select roomly_test.ok(
  public.purge_closed_conversation_messages(now() - interval '31 days') = 0
  and (select count(*) from public.messages where conversation_id = (select id from br28 where k = 'ab')) = 1,
  'BR7: la conversación cerrada hoy conserva sus mensajes');
reset role;
update public.conversations set closed_at = now() - interval '60 days'
where id = (select id from br28 where k = 'ab');
insert into public.interest_log (from_user_id, to_user_id, created_at)
  values ('28000000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-00000000000a', now() - interval '31 days');
set role service_role;
-- Cada comprobación en su sentencia: la instantánea de una sentencia no ve lo
-- que borra una función llamada en ella.
select roomly_test.ok(
  public.purge_closed_conversation_messages(now() - interval '31 days') = 1,
  'BR7: se purga el mensaje de la conversación cerrada hace 60 días');
select roomly_test.ok(
  not exists (select 1 from public.messages where conversation_id = (select id from br28 where k = 'ab')),
  'BR7: y ya no está');
select roomly_test.ok(public.purge_interest_log() >= 1, 'BR7: se purga el registro de más de 30 días');
select roomly_test.ok(
  not exists (select 1 from public.interest_log where created_at < now() - interval '30 days'),
  'BR7: y no queda ninguna fila antigua');
select roomly_test.ok(
  exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
          where c.closed_at is null)
  or not exists (select 1 from public.conversations c where c.closed_at is null),
  'BR7: las conversaciones abiertas no se tocan');

reset role;
drop table br28;
