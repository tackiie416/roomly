-- Fase 5.1 — «Me interesa» y match mutuo solo desde el servidor
-- (20261126120000_interests_matches_server_only.sql). Este archivo debe
-- fallar si:
--   - un cliente (anon o authenticated) vuelve a poder escribir en
--     `interests` o `matches` (criterio de aceptación de la Fase 5: un INSERT
--     directo en `matches` de un cliente autenticado falla);
--   - alguien que no sea service_role puede ejecutar record_interest o
--     withdraw_interest;
--   - un match se crea sin interés mutuo, o entre cuentas no válidas, también
--     con service_role;
--   - un interés va hacia (o desde) una cuenta desactivada, admin o sin
--     onboarding, o con una habitación que no es de quien lo recibe;
--   - la lectura deja de ser solo de los participantes.
--
-- A, B, D: cuentas activas con onboarding. C: desactivada. E: sin onboarding.
-- X: admin. Z: activa, ajena (no participa).

reset role;
insert into auth.users (id, email) values
  ('26000000-0000-0000-0000-00000000000a', 'im-a@test'),
  ('26000000-0000-0000-0000-00000000000b', 'im-b@test'),
  ('26000000-0000-0000-0000-00000000000c', 'im-c@test'),
  ('26000000-0000-0000-0000-00000000000d', 'im-d@test'),
  ('26000000-0000-0000-0000-00000000000e', 'im-e@test'),
  ('26000000-0000-0000-0000-0000000000a0', 'im-x@test'),
  ('26000000-0000-0000-0000-0000000000f0', 'im-z@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('26000000-0000-0000-0000-00000000000a', 'Interés A', '2001-01-01', 'looking_for_room', 'user'),
  ('26000000-0000-0000-0000-00000000000b', 'Interés B', '2001-01-01', 'looking_for_room', 'user'),
  ('26000000-0000-0000-0000-00000000000c', 'Interés C', '2001-01-01', 'looking_for_room', 'user'),
  ('26000000-0000-0000-0000-00000000000d', 'Interés D', '2001-01-01', 'has_room_looking_for_roommate', 'user'),
  ('26000000-0000-0000-0000-00000000000e', 'Interés E', '2001-01-01', 'looking_for_room', 'user'),
  ('26000000-0000-0000-0000-0000000000a0', 'Interés X', '2001-01-01', 'looking_for_room', 'admin'),
  ('26000000-0000-0000-0000-0000000000f0', 'Interés Z', '2001-01-01', 'looking_for_room', 'user');
insert into public.housing_preferences (profile_id, city_id)
  select p.id, c.id
  from public.cities c
  cross join (values
    ('26000000-0000-0000-0000-00000000000a'::uuid), ('26000000-0000-0000-0000-00000000000b'),
    ('26000000-0000-0000-0000-00000000000c'), ('26000000-0000-0000-0000-00000000000d'),
    ('26000000-0000-0000-0000-0000000000a0'), ('26000000-0000-0000-0000-0000000000f0')) p(id)
  where c.slug = 'barcelona';
update public.profiles set onboarding_completed_at = now()
where id in ('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000b',
             '26000000-0000-0000-0000-00000000000c', '26000000-0000-0000-0000-00000000000d',
             '26000000-0000-0000-0000-0000000000a0', '26000000-0000-0000-0000-0000000000f0');
update public.profiles set deleted_at = now() where id = '26000000-0000-0000-0000-00000000000c';
-- Habitaciones: activa de D, borrador de D y activa de Z.
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms, status)
  select v.id, v.owner_id, v.title, c.id, n.id, 500, '2026-11-01', 1, 2, v.status::public.room_status
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval',
  (values
    ('26100000-0000-0000-0000-000000000001'::uuid, '26000000-0000-0000-0000-00000000000d'::uuid, 'Activa D', 'active'),
    ('26100000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-00000000000d', 'Borrador D', 'draft'),
    ('26100000-0000-0000-0000-000000000003', '26000000-0000-0000-0000-0000000000f0', 'Activa Z', 'active')
  ) as v(id, owner_id, title, status)
  where c.slug = 'barcelona';

-- ------------------------------------------------------------
-- 0. Catálogo
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (
    select 1
    from unnest(array['public.interests', 'public.matches']) t
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('anon', t, p)),
  'IM0: anon no tiene ningún privilegio sobre interests ni matches');
select roomly_test.ok(
  (select bool_and(has_table_privilege('authenticated', t, 'SELECT'))
   from unnest(array['public.interests', 'public.matches']) t)
  and not exists (
    select 1
    from unnest(array['public.interests', 'public.matches']) t
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('authenticated', t, p)),
  'IM0: authenticated solo tiene SELECT sobre interests y matches');
select roomly_test.ok(
  not exists (
    select 1
    from unnest(array['public.interests', 'public.matches']) t
    cross join unnest(array['INSERT', 'UPDATE']) p
    where has_any_column_privilege('authenticated', t, p) or has_any_column_privilege('anon', t, p)),
  'IM0: ni privilegios de columna de escritura');
select roomly_test.ok(
  (select array_agg(policyname::text order by policyname) from pg_policies
   where schemaname = 'public' and tablename in ('interests', 'matches'))
  = array['interests_select_participant', 'matches_select_participant'],
  'IM0: solo quedan las políticas de lectura de participante');
select roomly_test.ok(
  has_function_privilege('service_role', 'public.record_interest(uuid, uuid, integer, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.withdraw_interest(uuid, uuid)', 'EXECUTE')
  and not exists (
    select 1
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['public.record_interest(uuid, uuid, integer, uuid)',
                            'public.withdraw_interest(uuid, uuid)',
                            'public.enforce_interests_integrity()',
                            'public.enforce_matches_integrity()']) f
    where has_function_privilege(r, f, 'EXECUTE')),
  'IM0: record_interest y withdraw_interest, solo service_role; los triggers, nadie');
select roomly_test.ok(
  not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('public.record_interest(uuid, uuid, integer, uuid)'::regprocedure,
                    'public.withdraw_interest(uuid, uuid)'::regprocedure)
      and a.grantee = 0),
  'IM0: PUBLIC no ejecuta las funciones');

-- ------------------------------------------------------------
-- 1. Un cliente no escribe (criterio de aceptación de la Fase 5)
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('26000000-0000-0000-0000-00000000000a');
select roomly_test.expect_denied(
  $$insert into public.interests (from_user_id, to_user_id)
    values ('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000b')$$,
  'IM1: A no inserta un interés propio por PostgREST');
select roomly_test.expect_denied(
  $$insert into public.matches (user_a_id, user_b_id, compatibility_score)
    values ('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000b', 80)$$,
  'IM1: un INSERT directo en matches de un cliente autenticado falla');
select roomly_test.expect_denied(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a',
                                  '26000000-0000-0000-0000-00000000000b', 80)$$,
  'IM1: A no ejecuta record_interest');
select roomly_test.expect_denied(
  $$select public.withdraw_interest('26000000-0000-0000-0000-00000000000a',
                                    '26000000-0000-0000-0000-00000000000b')$$,
  'IM1: A no ejecuta withdraw_interest');
set role anon;
select roomly_test.login(null);
select roomly_test.expect_denied(
  $$select count(*) from public.interests$$, 'IM1: anon no lee interests');
select roomly_test.expect_denied(
  $$select count(*) from public.matches$$, 'IM1: anon no lee matches');

-- ------------------------------------------------------------
-- 2. record_interest: enviar, repetir y match mutuo
-- ------------------------------------------------------------
reset role;
set role service_role;
select roomly_test.ok(
  public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000b', 81) = 'sent',
  'IM2: A → B, interés nuevo: sent');
select roomly_test.ok(
  public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000b', 81) = 'already_sent',
  'IM2: repetirlo no duplica: already_sent');
select roomly_test.ok(
  (select count(*) from public.interests
   where from_user_id = '26000000-0000-0000-0000-00000000000a'
     and to_user_id = '26000000-0000-0000-0000-00000000000b') = 1
  and not exists (select 1 from public.matches
                  where '26000000-0000-0000-0000-00000000000a' in (user_a_id, user_b_id)),
  'IM2: una sola fila de interés y todavía sin match');
select roomly_test.ok(
  public.record_interest('26000000-0000-0000-0000-00000000000b', '26000000-0000-0000-0000-00000000000a', 81) = 'matched',
  'IM2: B → A completa el interés mutuo: matched');
select roomly_test.ok(
  (select count(*) from public.matches
   where user_a_id = '26000000-0000-0000-0000-00000000000a'
     and user_b_id = '26000000-0000-0000-0000-00000000000b'
     and compatibility_score = 81 and room_id is null) = 1,
  'IM2: un match en orden canónico (a < b), con el score del servidor');
select roomly_test.ok(
  public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000b', 50) = 'matched'
  and (select compatibility_score from public.matches
       where user_a_id = '26000000-0000-0000-0000-00000000000a'
         and user_b_id = '26000000-0000-0000-0000-00000000000b') = 81,
  'IM2: repetir con match ya hecho devuelve matched y no cambia nada');

-- ------------------------------------------------------------
-- 3. Lectura: solo los participantes
-- ------------------------------------------------------------
reset role;
set role authenticated;
select roomly_test.login('26000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.interests where '26000000-0000-0000-0000-00000000000a' in (from_user_id, to_user_id)$$,
  2, 'IM3: A ve el interés que envió y el que recibió');
select roomly_test.expect_rows($$select 1 from public.matches$$, 1, 'IM3: A ve su match');
select roomly_test.login('26000000-0000-0000-0000-0000000000f0');
select roomly_test.expect_rows($$select 1 from public.interests$$, 0, 'IM3: Z no ve intereses ajenos');
select roomly_test.expect_rows($$select 1 from public.matches$$, 0, 'IM3: Z no ve matches ajenos');
select roomly_test.login('26000000-0000-0000-0000-0000000000a0');
select roomly_test.expect_rows($$select 1 from public.matches$$, 0, 'IM3: un admin tampoco, desde el cliente');

-- ------------------------------------------------------------
-- 4. withdraw_interest
-- ------------------------------------------------------------
reset role;
set role service_role;
select roomly_test.ok(
  public.withdraw_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000b') = 'matched'
  and (select count(*) from public.interests
       where '26000000-0000-0000-0000-00000000000a' in (from_user_id, to_user_id)) = 2,
  'IM4: con match, el interés no se retira');
select roomly_test.ok(
  public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000d', 70) = 'sent',
  'IM4: A → D: sent');
-- Cada comprobación de datos, en su propia sentencia: la instantánea de una
-- sentencia no ve lo que cambia una función llamada en ella.
select roomly_test.ok(
  public.withdraw_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000d') = 'withdrawn',
  'IM4: sin match, se retira: withdrawn');
select roomly_test.ok(
  not exists (select 1 from public.interests
              where from_user_id = '26000000-0000-0000-0000-00000000000a'
                and to_user_id = '26000000-0000-0000-0000-00000000000d'),
  'IM4: la fila ya no está');
select roomly_test.ok(
  public.withdraw_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000d') = 'not_found',
  'IM4: retirarlo otra vez: not_found');
select roomly_test.ok(
  public.withdraw_interest('26000000-0000-0000-0000-00000000000d', '26000000-0000-0000-0000-00000000000a') = 'not_found',
  'IM4: solo se retira el interés propio (D no tenía ninguno hacia A)');

-- ------------------------------------------------------------
-- 5. Cuentas no válidas, también con service_role
-- ------------------------------------------------------------
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000c', 70)$$,
  '23514', 'interest_party_invalid:', 'IM5: hacia una cuenta desactivada');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000c', '26000000-0000-0000-0000-00000000000a', 70)$$,
  '23514', 'interest_party_invalid:', 'IM5: desde una cuenta desactivada');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000e', 70)$$,
  '23514', 'interest_party_invalid:', 'IM5: hacia una cuenta sin onboarding');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-0000000000a0', 70)$$,
  '23514', 'interest_party_invalid:', 'IM5: hacia un admin');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-000000000099', 70)$$,
  '23514', 'interest_party_invalid:', 'IM5: hacia un id que no existe (sin revelar nada más)');
select roomly_test.expect_error_prefix(
  $$insert into public.interests (from_user_id, to_user_id)
    values ('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000c')$$,
  '23514', 'interest_party_invalid:', 'IM5: el INSERT directo de service_role tampoco salta el trigger');

-- ------------------------------------------------------------
-- 6. Argumentos
-- ------------------------------------------------------------
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000a', 70)$$,
  '22004', 'interest_invalid:', 'IM6: consigo mismo');
select roomly_test.expect_error_prefix(
  $$select public.record_interest(null, '26000000-0000-0000-0000-00000000000a', 70)$$,
  '22004', 'interest_invalid:', 'IM6: sin quien envía');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000d', 101)$$,
  '22003', 'interest_score_invalid:', 'IM6: score fuera de 0–100');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000a', '26000000-0000-0000-0000-00000000000d', null)$$,
  '22003', 'interest_score_invalid:', 'IM6: sin score');

-- ------------------------------------------------------------
-- 7. Matches: solo con interés mutuo, e inmutables
-- ------------------------------------------------------------
select roomly_test.ok(
  public.record_interest('26000000-0000-0000-0000-00000000000d', '26000000-0000-0000-0000-0000000000f0', 60) = 'sent',
  'IM7: D → Z, sin respuesta');
select roomly_test.expect_error_prefix(
  $$insert into public.matches (user_a_id, user_b_id, compatibility_score)
    values ('26000000-0000-0000-0000-00000000000d', '26000000-0000-0000-0000-0000000000f0', 60)$$,
  '23514', 'match_not_mutual:', 'IM7: service_role no crea un match con un solo interés');
select roomly_test.expect_error_prefix(
  $$update public.matches set compatibility_score = 99
    where user_a_id = '26000000-0000-0000-0000-00000000000a'$$,
  '23514', 'match_immutable:', 'IM7: un match no se modifica');
select roomly_test.expect_error_prefix(
  $$update public.interests set room_id = null
    where from_user_id = '26000000-0000-0000-0000-00000000000a'$$,
  '23514', 'interest_immutable:', 'IM7: un interés no se modifica');

-- Z responde y después se desactiva: el match directo ya no vale.
select roomly_test.expect_affected(
  $$insert into public.interests (from_user_id, to_user_id)
    values ('26000000-0000-0000-0000-0000000000f0', '26000000-0000-0000-0000-00000000000d')$$,
  1, 'IM7-control: el INSERT directo de service_role con cuentas válidas funciona');
reset role;
update public.profiles set deleted_at = now() where id = '26000000-0000-0000-0000-0000000000f0';
set role service_role;
select roomly_test.expect_error_prefix(
  $$insert into public.matches (user_a_id, user_b_id, compatibility_score)
    values ('26000000-0000-0000-0000-00000000000d', '26000000-0000-0000-0000-0000000000f0', 60)$$,
  '23514', 'match_party_invalid:', 'IM7: sin match si una cuenta está desactivada, aunque haya interés mutuo');
reset role;
update public.profiles set deleted_at = null where id = '26000000-0000-0000-0000-0000000000f0';

-- ------------------------------------------------------------
-- 8. Contexto de habitación
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000b', '26000000-0000-0000-0000-00000000000d', 70,
                                  '26100000-0000-0000-0000-000000000003')$$,
  '23514', 'interest_room_invalid:', 'IM8: la habitación no es de quien recibe el interés');
select roomly_test.expect_error_prefix(
  $$select public.record_interest('26000000-0000-0000-0000-00000000000b', '26000000-0000-0000-0000-00000000000d', 70,
                                  '26100000-0000-0000-0000-000000000002')$$,
  '23514', 'interest_room_invalid:', 'IM8: un borrador no sirve de contexto');
select roomly_test.ok(
  public.record_interest('26000000-0000-0000-0000-00000000000b', '26000000-0000-0000-0000-00000000000d', 70,
                         '26100000-0000-0000-0000-000000000001') = 'sent',
  'IM8: con una habitación activa de quien recibe, el interés se envía');
select roomly_test.ok(
  (select room_id from public.interests
       where from_user_id = '26000000-0000-0000-0000-00000000000b'
         and to_user_id = '26000000-0000-0000-0000-00000000000d') = '26100000-0000-0000-0000-000000000001',
  'IM8: y guarda el contexto de la habitación');

-- ------------------------------------------------------------
-- 9. Rate limit (20260925120000) sigue aplicándose por record_interest
-- ------------------------------------------------------------
reset role;
select roomly_test.ok(
  exists (select 1 from pg_trigger where tgname = 'trg_interests_rate_limit' and not tgisinternal and tgenabled <> 'D')
  and exists (select 1 from pg_trigger where tgname = 'trg_interests_integrity' and not tgisinternal and tgenabled <> 'D')
  and exists (select 1 from pg_trigger where tgname = 'trg_matches_integrity' and not tgisinternal and tgenabled <> 'D'),
  'IM9: los triggers de rate limit e integridad están activos');

reset role;
select roomly_test.login(null);
