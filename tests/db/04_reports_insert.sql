-- M2 — Quien crea un reporte no puede fijar campos administrativos.
-- Debe fallar si alguien vuelve a permitir crear reportes "ya resueltos".

reset role;
insert into auth.users (id, email) values
  ('40000000-0000-0000-0000-00000000000c', 'm2-reporter@test'),
  ('40000000-0000-0000-0000-00000000000b', 'm2-reported@test'),
  ('40000000-0000-0000-0000-00000000000d', 'm2-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('40000000-0000-0000-0000-00000000000c', 'Reporter', '2000-01-01', 'looking_for_room'),
  ('40000000-0000-0000-0000-00000000000b', 'Reported', '2000-01-01', 'looking_for_room');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('40000000-0000-0000-0000-00000000000d', 'Admin', '1990-01-01', 'looking_for_room', 'admin');

set role authenticated;
select roomly_test.login('40000000-0000-0000-0000-00000000000c');

select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason, status)
    values ('40000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-00000000000b', 'spam', 'resolved')$$,
  '42501', 'M2: no se puede crear un reporte con status=resolved');
select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason, resolved_by)
    values ('40000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-00000000000b', 'spam', '40000000-0000-0000-0000-00000000000d')$$,
  '42501', 'M2: no se puede fijar resolved_by');
select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason, resolution_notes)
    values ('40000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-00000000000b', 'spam', 'cerrado')$$,
  '42501', 'M2: no se puede fijar resolution_notes');
select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason, resolved_at)
    values ('40000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-00000000000b', 'spam', now())$$,
  '42501', 'M2: no se puede fijar resolved_at');
select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason, status)
    values ('40000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-00000000000b', 'spam', 'pending')$$,
  '42501', 'M2: status no se envía en absoluto (se aplica el default)');
select roomly_test.expect_error(
  $$insert into public.reports (reporter_id, reported_user_id, reason)
    values ('40000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000c', 'spam')$$,
  '42501', 'M2: no se puede crear un reporte en nombre de otra persona');

select roomly_test.expect_affected(
  $$insert into public.reports (reporter_id, reported_user_id, reason, description)
    values ('40000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-00000000000b', 'spam', 'me envía spam')$$,
  1, 'M2: el flujo normal de reportar sigue funcionando');
select roomly_test.ok(
  (select status = 'pending' and resolved_by is null from public.reports
   where reporter_id = '40000000-0000-0000-0000-00000000000c'),
  'M2: el reporte nace pending y sin resolver');
select roomly_test.expect_affected(
  $$update public.reports set status = 'dismissed' where reporter_id = '40000000-0000-0000-0000-00000000000c'$$,
  0, 'M2: quien reporta no puede cerrar su propio reporte después');

-- La persona reportada no ve el reporte (comportamiento ya existente, se protege aquí).
select roomly_test.login('40000000-0000-0000-0000-00000000000b');
select roomly_test.expect_rows($$select 1 from public.reports$$, 0,
  'la persona reportada no puede ver quién la reportó');

-- El admin resuelve.
select roomly_test.login('40000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$update public.reports
    set status = 'resolved', resolved_by = '40000000-0000-0000-0000-00000000000d',
        resolved_at = now(), resolution_notes = 'revisado'
    where reporter_id = '40000000-0000-0000-0000-00000000000c'$$,
  1, 'M2: un admin sí puede resolver el reporte');

reset role;
