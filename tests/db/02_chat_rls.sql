-- C2 + C3 — Chat: fuga de mensajes entre conversaciones y recursión RLS
-- Escenario: A y B participan en la conversación 1; C participa en la 2.
-- Debe fallar si vuelve la tautología (cp.conversation_id = cp.conversation_id),
-- si vuelve la recursión infinita, o si un tercero puede leer/escribir en 1.

reset role;
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-00000000000a', 'c2-a@test'),
  ('20000000-0000-0000-0000-00000000000b', 'c2-b@test'),
  ('20000000-0000-0000-0000-00000000000c', 'c2-c@test');
insert into public.profiles (id, full_name, date_of_birth) values
  ('20000000-0000-0000-0000-00000000000a', 'A', '2000-01-01'),
  ('20000000-0000-0000-0000-00000000000b', 'B', '2000-01-01'),
  ('20000000-0000-0000-0000-00000000000c', 'C', '2000-01-01');
-- Conversaciones y participantes: solo los crea el servidor (no hay INSERT de cliente).
insert into public.conversations (id) values
  ('21000000-0000-0000-0000-000000000001'),
  ('21000000-0000-0000-0000-000000000002');
insert into public.conversation_participants (conversation_id, user_id) values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a'),
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000c');
insert into public.messages (conversation_id, sender_id, content) values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'privado A->B'),
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', 'privado B->A'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000c', 'nota de C');

-- ---------- Guardas estáticas (independientes de los datos) ----------
select roomly_test.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('messages', 'conversations', 'conversation_participants')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '')
          ~ '(\m\w+)\.conversation_id = \1\.conversation_id'
  ),
  'C2: ninguna política del chat compara conversation_id consigo misma (tautología)');

select roomly_test.ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc p where p.oid = 'public.is_conversation_participant(uuid)'::regprocedure),
  'C2: is_conversation_participant es SECURITY DEFINER con search_path vacío');

select roomly_test.ok(
  not has_function_privilege('anon', 'public.is_conversation_participant(uuid)', 'execute'),
  'C2: anon no puede ejecutar is_conversation_participant');

-- ---------- A (participante de 1) ----------
set role authenticated;
select roomly_test.login('20000000-0000-0000-0000-00000000000a');

-- expect_rows no captura errores: si vuelve la recursión (42P17), falla aquí.
select roomly_test.expect_rows(
  $$select 1 from public.conversation_participants$$, 2,
  'C3: A consulta conversation_participants sin recursión y solo ve los de su conversación');
select roomly_test.expect_rows(
  $$select 1 from public.messages where conversation_id = '21000000-0000-0000-0000-000000000001'$$, 2,
  'A puede leer los mensajes de la conversación 1');
select roomly_test.expect_rows($$select 1 from public.messages$$, 2,
  'A no ve ningún mensaje de la conversación 2');
select roomly_test.expect_rows($$select 1 from public.conversations$$, 1,
  'A solo ve la conversación 1');
select roomly_test.expect_affected(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'hola B')$$,
  1, 'A puede escribir en la conversación 1');
select roomly_test.expect_error(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', 'suplantando a B')$$,
  '42501', 'A no puede enviar un mensaje con sender_id de B');
select roomly_test.expect_error(
  $$update public.conversation_participants set conversation_id = '21000000-0000-0000-0000-000000000002'
    where user_id = '20000000-0000-0000-0000-00000000000a'$$,
  '42501', 'A no puede reasignar su fila de participante a otra conversación');
select roomly_test.expect_affected(
  $$update public.conversation_participants set last_read_at = now()
    where user_id = '20000000-0000-0000-0000-00000000000a'$$,
  1, 'A puede marcar como leída su conversación (last_read_at)');
select roomly_test.expect_affected(
  $$update public.conversation_participants set last_read_at = now()
    where user_id = '20000000-0000-0000-0000-00000000000b'$$,
  0, 'A no puede modificar la fila de participante de B');

-- ---------- B (participante de 1) ----------
select roomly_test.login('20000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows(
  $$select 1 from public.messages where conversation_id = '21000000-0000-0000-0000-000000000001'$$, 3,
  'B puede leer los mensajes de la conversación 1 (incluido el nuevo de A)');

-- ---------- C (participante solo de 2) ----------
select roomly_test.login('20000000-0000-0000-0000-00000000000c');
select roomly_test.expect_rows(
  $$select 1 from public.messages where conversation_id = '21000000-0000-0000-0000-000000000001'$$, 0,
  'C2: C NO puede leer mensajes de la conversación 1');
select roomly_test.expect_rows(
  $$select 1 from public.conversations where id = '21000000-0000-0000-0000-000000000001'$$, 0,
  'C NO ve la conversación 1 aunque conozca su UUID');
select roomly_test.expect_rows(
  $$select 1 from public.conversation_participants where conversation_id = '21000000-0000-0000-0000-000000000001'$$, 0,
  'C NO ve quién participa en la conversación 1');
select roomly_test.expect_error(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000c', 'intrusión')$$,
  '42501', 'C2: C NO puede insertar mensajes en la conversación 1');
select roomly_test.ok(
  not public.is_conversation_participant('21000000-0000-0000-0000-000000000001'),
  'is_conversation_participant(1) es false para C');
select roomly_test.expect_rows($$select 1 from public.messages$$, 1,
  'C accede a los mensajes de la conversación 2, en la que participa');
select roomly_test.expect_affected(
  $$insert into public.messages (conversation_id, sender_id, content)
    values ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000c', 'otra nota')$$,
  1, 'C puede escribir en la conversación 2');

-- ---------- Sin sesión ----------
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows($$select 1 from public.messages$$, 0, 'anon no lee ningún mensaje');

reset role;
select roomly_test.ok(
  (select count(*) = 0 from public.messages where content = 'intrusión'),
  'C2: en la base de datos no ha quedado ningún mensaje intruso');
