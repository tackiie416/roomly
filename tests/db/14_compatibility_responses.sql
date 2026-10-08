-- Fase 3.1 — `compatibility_responses` (20261007120000_compatibility_responses_hardening.sql).
-- Debe fallar si anon vuelve a tener acceso, si un usuario autenticado lee
-- respuestas ajenas o vuelve a poder escribir directamente (PostgREST), si
-- una cuenta eliminada puede escribir aunque sea con service_role, o si se
-- rompen las reglas S1–S6 y los casos D7.1–D7.5 de la especificación.
--
-- A y B: cuentas activas. C: eliminada desde el principio. D: se elimina a
-- mitad del test. Las escrituras legítimas se hacen como service_role (el
-- servidor), que es el único escritor.

reset role;
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-00000000000a', 'cr-a@test'),
  ('e0000000-0000-0000-0000-00000000000b', 'cr-b@test'),
  ('e0000000-0000-0000-0000-00000000000c', 'cr-c@test'),
  ('e0000000-0000-0000-0000-00000000000d', 'cr-d@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('e0000000-0000-0000-0000-00000000000a', 'Respuestas A', '2000-01-01', 'looking_for_room'),
  ('e0000000-0000-0000-0000-00000000000b', 'Respuestas B', '2000-01-01', 'looking_for_room'),
  ('e0000000-0000-0000-0000-00000000000d', 'Respuestas D', '2000-01-01', 'looking_for_room');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, deleted_at) values
  ('e0000000-0000-0000-0000-00000000000c', 'Respuestas C', '2000-01-01', 'looking_for_room', now());

-- ------------------------------------------------------------
-- 1. Esquema: S1 y S2.
-- ------------------------------------------------------------
select roomly_test.ok(
  (select column_default is null from information_schema.columns
   where table_schema = 'public' and table_name = 'compatibility_responses'
     and column_name = 'questionnaire_version'),
  'CR1: questionnaire_version no tiene DEFAULT');
select roomly_test.ok(
  (select is_nullable = 'YES' and column_default is null from information_schema.columns
   where table_schema = 'public' and table_name = 'compatibility_responses'
     and column_name = 'completed_at'),
  'CR2: completed_at admite NULL y no tiene DEFAULT');

set role service_role;
select roomly_test.expect_error(
  $$insert into public.compatibility_responses (profile_id, answers)
    values ('e0000000-0000-0000-0000-00000000000a', '{}')$$,
  '23502', 'CR1: un INSERT sin versión falla (no hay 1 por defecto)');
select roomly_test.expect_error(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers)
    values ('e0000000-0000-0000-0000-00000000000a', 0, '{}')$$,
  '23514', 'CR1: versión 0 rechazada (CHECK >= 1)');
select roomly_test.expect_error(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers)
    values ('e0000000-0000-0000-0000-00000000000a', 1, '[]')$$,
  '23514', 'CR1: answers sigue teniendo que ser un objeto');

-- ------------------------------------------------------------
-- 2. D7.1 y borrador: el servidor crea filas.
-- ------------------------------------------------------------
select roomly_test.expect_affected(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers, completed_at)
    values ('e0000000-0000-0000-0000-00000000000a', 1, '{"clean_frequency": 3}', null)$$,
  1, 'CR3: borrador (completed_at NULL) creado por el servidor');
select roomly_test.expect_affected(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers, completed_at)
    values ('e0000000-0000-0000-0000-00000000000b', 1, '{"clean_frequency": 2}', '2026-10-01T10:00:00Z')$$,
  1, 'CR4 (D7.1): primer completado directamente en el INSERT');

-- ------------------------------------------------------------
-- 3. anon: ningún acceso.
-- ------------------------------------------------------------
reset role;
select roomly_test.ok(
  not has_table_privilege('anon', 'public.compatibility_responses', 'SELECT')
  and not has_table_privilege('anon', 'public.compatibility_responses', 'INSERT')
  and not has_table_privilege('anon', 'public.compatibility_responses', 'UPDATE')
  and not has_table_privilege('anon', 'public.compatibility_responses', 'DELETE')
  and not has_table_privilege('anon', 'public.compatibility_responses', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.compatibility_responses', 'REFERENCES')
  and not has_table_privilege('anon', 'public.compatibility_responses', 'TRIGGER')
  and not has_any_column_privilege('anon', 'public.compatibility_responses', 'SELECT')
  and not has_any_column_privilege('anon', 'public.compatibility_responses', 'INSERT')
  and not has_any_column_privilege('anon', 'public.compatibility_responses', 'UPDATE'),
  'CR5: anon no tiene ningún privilegio de tabla ni de columna');
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$select 1 from public.compatibility_responses$$,
  '42501', 'CR5: anon no lee respuestas');
select roomly_test.expect_error(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers)
    values ('e0000000-0000-0000-0000-00000000000a', 1, '{}')$$,
  '42501', 'CR5: anon no escribe respuestas');

-- ------------------------------------------------------------
-- 4. authenticated: solo SELECT de la fila propia; nunca escribe.
-- ------------------------------------------------------------
reset role;
select roomly_test.ok(
  has_table_privilege('authenticated', 'public.compatibility_responses', 'SELECT')
  and not has_table_privilege('authenticated', 'public.compatibility_responses', 'INSERT')
  and not has_table_privilege('authenticated', 'public.compatibility_responses', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.compatibility_responses', 'DELETE')
  and not has_table_privilege('authenticated', 'public.compatibility_responses', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.compatibility_responses', 'REFERENCES')
  and not has_table_privilege('authenticated', 'public.compatibility_responses', 'TRIGGER')
  and not has_any_column_privilege('authenticated', 'public.compatibility_responses', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.compatibility_responses', 'UPDATE'),
  'CR6: authenticated solo tiene SELECT (ni tabla ni columnas de escritura)');

set role authenticated;
select roomly_test.login('e0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.compatibility_responses
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  1, 'CR7: A lee su propia fila');
select roomly_test.expect_rows(
  $$select 1 from public.compatibility_responses
    where profile_id <> 'e0000000-0000-0000-0000-00000000000a'$$,
  0, 'CR7: A no lee ninguna fila ajena');
select roomly_test.expect_rows(
  $$select 1 from public.compatibility_responses
    where profile_id = 'e0000000-0000-0000-0000-00000000000b'$$,
  0, 'CR7: ni conociendo el id de B');
select roomly_test.expect_error(
  $$update public.compatibility_responses set completed_at = now()
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '42501', 'CR8: A no puede marcar su test como completado (UPDATE directo)');
select roomly_test.expect_error(
  $$update public.compatibility_responses set questionnaire_version = 99
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '42501', 'CR8: ni cambiar la versión');
select roomly_test.expect_error(
  $$update public.compatibility_responses set answers = '{}'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '42501', 'CR8: ni las respuestas');
select roomly_test.expect_error(
  $$delete from public.compatibility_responses
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '42501', 'CR8: ni borrar su fila');
select roomly_test.login('e0000000-0000-0000-0000-00000000000d');
select roomly_test.expect_error(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers, completed_at)
    values ('e0000000-0000-0000-0000-00000000000d', 1, '{}', now())$$,
  '42501', 'CR8: D no puede crear su fila (INSERT directo)');

reset role;
select roomly_test.ok(
  (select array_agg(policyname::text || ':' || cmd::text || ':' || array_to_string(roles, ','))
          = array['compatibility_responses_select_own:SELECT:authenticated']
   from pg_policies where schemaname = 'public' and tablename = 'compatibility_responses'),
  'CR9: una sola política, SELECT, solo para authenticated');
select roomly_test.ok(
  (select count(*) = 37 from pg_policies where schemaname = 'public'),
  'CR9: siguen siendo 37 políticas en public');

-- ------------------------------------------------------------
-- 5. S4 / D7.2: con la misma versión, completed_at no cambia una vez fijado.
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_affected(
  $$update public.compatibility_responses set answers = '{"clean_frequency": 4}'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  1, 'CR10: el borrador se puede volver a guardar');
select roomly_test.expect_affected(
  $$update public.compatibility_responses set completed_at = '2026-10-02T10:00:00Z'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  1, 'CR11 (D7.1): primer completado de un borrador');
select roomly_test.expect_error(
  $$update public.compatibility_responses set completed_at = '2026-10-03T10:00:00Z'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '23514', 'CR12 (S4): la fecha de completado no se cambia en la misma versión');
select roomly_test.expect_error(
  $$update public.compatibility_responses set completed_at = null
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '23514', 'CR12 (S4): ni vuelve a NULL en la misma versión');
select roomly_test.expect_affected(
  $$update public.compatibility_responses
    set answers = '{"clean_frequency": 5}', completed_at = '2026-10-02T10:00:00Z'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  1, 'CR13 (D7.2): rehacer el test conserva la misma fecha (reescribirla está permitido)');
select roomly_test.expect_affected(
  $$update public.compatibility_responses set answers = '{"clean_frequency": 1}'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  1, 'CR13 (D7.2): sin tocar completed_at también');
select roomly_test.expect_rows(
  $$select 1 from public.compatibility_responses
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'
      and completed_at = '2026-10-02T10:00:00Z'$$,
  1, 'CR13 (D7.2): la fecha original se conserva');

-- ------------------------------------------------------------
-- 6. S5 / D7.3 y D7.4: subir de versión.
-- ------------------------------------------------------------
select roomly_test.expect_affected(
  $$update public.compatibility_responses
    set questionnaire_version = 2, completed_at = '2026-10-05T10:00:00Z'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  1, 'CR14 (D7.3): subir de versión y completar en la misma escritura');
select roomly_test.expect_affected(
  $$update public.compatibility_responses
    set questionnaire_version = 2, completed_at = null
    where profile_id = 'e0000000-0000-0000-0000-00000000000b'$$,
  1, 'CR15 (D7.4): subir de versión dejando un borrador (completed_at NULL)');
select roomly_test.expect_affected(
  $$update public.compatibility_responses set completed_at = '2026-10-06T10:00:00Z'
    where profile_id = 'e0000000-0000-0000-0000-00000000000b'$$,
  1, 'CR15 (D7.4): ese borrador de la versión nueva se completa después');

-- ------------------------------------------------------------
-- 7. S3 / D7.5: no se baja de versión; S6: profile_id inmutable.
-- ------------------------------------------------------------
select roomly_test.expect_error(
  $$update public.compatibility_responses set questionnaire_version = 1
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '23514', 'CR16 (S3, D7.5): bajar de versión se rechaza');
select roomly_test.expect_error(
  $$update public.compatibility_responses
    set questionnaire_version = 1, completed_at = null
    where profile_id = 'e0000000-0000-0000-0000-00000000000b'$$,
  '23514', 'CR16 (S3): tampoco bajando y vaciando a la vez');
select roomly_test.expect_error(
  $$update public.compatibility_responses
    set profile_id = 'e0000000-0000-0000-0000-00000000000d'
    where profile_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  '23514', 'CR17 (S6): profile_id no cambia');

-- ------------------------------------------------------------
-- 8. Cuentas eliminadas: bloqueadas también para service_role y el dueño.
-- ------------------------------------------------------------
select roomly_test.expect_error(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers)
    values ('e0000000-0000-0000-0000-00000000000c', 1, '{}')$$,
  '23514', 'CR18: service_role no crea respuestas de una cuenta eliminada');

select roomly_test.expect_affected(
  $$insert into public.compatibility_responses (profile_id, questionnaire_version, answers)
    values ('e0000000-0000-0000-0000-00000000000d', 1, '{}')$$,
  1, 'CR19: D, todavía activa, tiene su borrador');
reset role;
update public.profiles set deleted_at = now()
  where id = 'e0000000-0000-0000-0000-00000000000d';
set role service_role;
select roomly_test.expect_error(
  $$update public.compatibility_responses set answers = '{"clean_frequency": 2}'
    where profile_id = 'e0000000-0000-0000-0000-00000000000d'$$,
  '23514', 'CR19: tras eliminarse D, service_role ya no escribe sus respuestas');
reset role;
select roomly_test.expect_error(
  $$update public.compatibility_responses set completed_at = now()
    where profile_id = 'e0000000-0000-0000-0000-00000000000d'$$,
  '23514', 'CR19: ni el dueño de las tablas');

-- ------------------------------------------------------------
-- 9. La función del trigger: SECURITY INVOKER, search_path vacío, sin EXECUTE.
-- ------------------------------------------------------------
select roomly_test.ok(
  (select not p.prosecdef and p.proconfig = array['search_path=""']
   from pg_proc p
   where p.oid = 'public.enforce_compatibility_responses_integrity()'::regprocedure),
  'CR20: el trigger es SECURITY INVOKER con search_path vacío');
select roomly_test.ok(
  not has_function_privilege('anon', 'public.enforce_compatibility_responses_integrity()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enforce_compatibility_responses_integrity()', 'EXECUTE'),
  'CR20: anon y authenticated no pueden ejecutar la función');
