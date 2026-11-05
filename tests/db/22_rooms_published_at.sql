-- Fase 4.4 (sesión 71) — Fecha de publicación de las habitaciones
-- (20261031120000_rooms_published_at.sql).
-- Debe fallar si:
--   - la columna, el trigger, su función, el CHECK o el índice parcial faltan
--     o cambian (seguridad de la función, EXECUTE, predicado del índice);
--   - un cliente puede escribir `published_at`, o el trigger deja que alguien
--     (también service_role o un admin) la fije a mano;
--   - publicar (desde borrador, pausada, alquilada o retirada) no registra una
--     fecha nueva, o una edición ordinaria o una pausa la cambian;
--   - H5 deja de proteger `removed`, o su rechazo deja una fecha cambiada;
--   - una habitación activa puede quedar sin fecha.
--
-- O: propietaria · X: admin. Habitaciones 22100000-…: P1 nace borrador.

reset role;
insert into auth.users (id, email) values
  ('22000000-0000-0000-0000-00000000000a', 'pa-o@test'),
  ('22000000-0000-0000-0000-0000000000ad', 'pa-x@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('22000000-0000-0000-0000-00000000000a', 'PA O', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('22000000-0000-0000-0000-0000000000ad', 'PA X', '1990-01-01', 'looking_for_room', 'admin');

-- Fechas observadas, para comparar antes y después (solo el superusuario).
create temporary table pa_seen (step text primary key, published_at timestamptz);

-- ------------------------------------------------------------
-- 0. Estructura
-- ------------------------------------------------------------
select roomly_test.ok(
  (select a.atttypid = 'timestamptz'::regtype and not a.attnotnull and not a.atthasdef
   from pg_attribute a
   where a.attrelid = 'public.rooms'::regclass and a.attname = 'published_at'),
  'PA0: rooms.published_at es timestamptz, admite NULL y no tiene valor por defecto');
select roomly_test.ok(
  (select t.tgenabled = 'O'
          and t.tgfoid = 'public.set_room_published_at()'::regprocedure
          and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE ON public.rooms FOR EACH ROW%'
   from pg_trigger t
   where t.tgrelid = 'public.rooms'::regclass and t.tgname = 'trg_rooms_published_at'),
  'PA0: trg_rooms_published_at es BEFORE INSERT OR UPDATE, por fila, activo');
select roomly_test.ok(
  (select not p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc p where p.oid = 'public.set_room_published_at()'::regprocedure)
  and not has_function_privilege('anon', 'public.set_room_published_at()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.set_room_published_at()', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.set_room_published_at()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PA0: set_room_published_at es SECURITY INVOKER, con search_path vacío y sin EXECUTE para anon, authenticated ni PUBLIC');
select roomly_test.ok(
  (select c.convalidated
          and pg_get_constraintdef(c.oid) = 'CHECK (((status <> ''active''::room_status) OR (published_at IS NOT NULL)))'
   from pg_constraint c
   where c.conrelid = 'public.rooms'::regclass and c.conname = 'chk_rooms_published_at'),
  'PA0: chk_rooms_published_at validada: activa ⇒ con fecha de publicación');
select roomly_test.ok(
  (select indexdef = 'CREATE INDEX idx_rooms_public_recent ON public.rooms USING btree (city_id, published_at DESC, id DESC) WHERE ((status = ''active''::room_status) AND (deleted_at IS NULL))'
   from pg_indexes where schemaname = 'public' and indexname = 'idx_rooms_public_recent'),
  'PA0: índice parcial (city_id, published_at desc, id desc) sobre las activas sin borrado lógico');
select roomly_test.ok(
  not has_column_privilege('authenticated', 'public.rooms', 'published_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.rooms', 'published_at', 'UPDATE')
  and not has_column_privilege('anon', 'public.rooms', 'published_at', 'INSERT')
  and not has_column_privilege('anon', 'public.rooms', 'published_at', 'UPDATE'),
  'PA0: ningún cliente tiene INSERT ni UPDATE de published_at');

-- ------------------------------------------------------------
-- 1. Nace borrador, sin fecha; publicar la registra
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, published_at)
    select '22100000-0000-0000-0000-0000000000f1', '22000000-0000-0000-0000-00000000000a',
           'Con fecha a mano', c.id, 450, '2026-11-01', now()
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'PA1: la propietaria no puede enviar published_at al crear');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                              available_from, total_roommates, total_rooms)
    select '22100000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-00000000000a',
           'P1', c.id, n.id, 450, '2026-11-01', 1, 2
    from public.cities c join public.neighborhoods n on n.city_id = c.id and n.slug = 'la-vila-de-gracia'
    where c.slug = 'barcelona'$$,
  1, 'PA1: la propietaria crea un borrador');
reset role;
select roomly_test.ok(
  (select status = 'draft' and published_at is null
   from public.rooms where id = '22100000-0000-0000-0000-000000000001'),
  'PA1: el borrador no tiene fecha de publicación');

set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA2: la propietaria la publica');
reset role;
insert into pa_seen select 'published', published_at from public.rooms
  where id = '22100000-0000-0000-0000-000000000001';
select roomly_test.ok(
  (select r.published_at is not null and r.published_at >= r.created_at
   from public.rooms r where r.id = '22100000-0000-0000-0000-000000000001'),
  'PA2: borrador → activa registra la fecha de publicación');

-- ------------------------------------------------------------
-- 2. Las ediciones ordinarias no la cambian; nadie la fija a mano
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set title = 'P1 editada', price_month = 480
    where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA3: la propietaria edita la activa');
select roomly_test.expect_error(
  $$update public.rooms set published_at = now() + interval '1 day'
    where id = '22100000-0000-0000-0000-000000000001'$$,
  '42501', 'PA3: pero no puede escribir published_at');
reset role;
select roomly_test.ok(
  (select r.published_at = s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'published'),
  'PA3: la edición no cambia la fecha de publicación');

set role service_role;
select roomly_test.expect_affected(
  $$update public.rooms set published_at = '2000-01-01T00:00:00Z'
    where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA4: service_role intenta fijar la fecha a mano');
reset role;
select roomly_test.ok(
  (select r.published_at = s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'published'),
  'PA4: el trigger conserva la fecha (tampoco service_role la fija)');

-- ------------------------------------------------------------
-- 3. Pausar la conserva; volver a publicar registra otra
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'paused' where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA5: la propietaria la pausa');
reset role;
select roomly_test.ok(
  (select r.published_at = s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'published'),
  'PA5: pausar conserva la fecha anterior');
set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA6: y la vuelve a publicar');
reset role;
select roomly_test.ok(
  (select r.published_at > s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'published'),
  'PA6: pausada → activa registra una fecha nueva');
insert into pa_seen select 'republished', published_at from public.rooms
  where id = '22100000-0000-0000-0000-000000000001';

set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'rented' where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA7: la marca como alquilada');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA7: y la vuelve a anunciar');
reset role;
select roomly_test.ok(
  (select r.published_at > s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'republished'),
  'PA7: alquilada → activa registra una fecha nueva');
delete from pa_seen where step = 'republished';
insert into pa_seen select 'republished', published_at from public.rooms
  where id = '22100000-0000-0000-0000-000000000001';

-- ------------------------------------------------------------
-- 4. H5 sigue igual; la restauración del admin es una publicación nueva
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error_prefix(
  $$update public.rooms set status = 'removed' where id = '22100000-0000-0000-0000-000000000001'$$,
  '42501', 'room_moderation:', 'PA8: H5: la propietaria no la retira');
select roomly_test.login('22000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'removed' where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA8: el admin la retira');
reset role;
select roomly_test.ok(
  (select r.status = 'removed' and r.published_at = s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'republished'),
  'PA8: retirar conserva la fecha (no es una publicación)');
set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error_prefix(
  $$update public.rooms set status = 'active' where id = '22100000-0000-0000-0000-000000000001'$$,
  '42501', 'room_moderation:', 'PA9: H5: la propietaria no la restaura');
reset role;
select roomly_test.ok(
  (select r.status = 'removed' and r.published_at = s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'republished'),
  'PA9: el rechazo de H5 no deja la fecha cambiada');
set role authenticated;
select roomly_test.login('22000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '22100000-0000-0000-0000-000000000001'$$,
  1, 'PA9: el admin la restaura');
reset role;
select roomly_test.ok(
  (select r.published_at > s.published_at
   from public.rooms r, pa_seen s
   where r.id = '22100000-0000-0000-0000-000000000001' and s.step = 'republished'),
  'PA9: retirada → activa (por el admin) registra una fecha nueva');

-- ------------------------------------------------------------
-- 5. Insertar ya activa (servidor); nunca activa sin fecha
-- ------------------------------------------------------------
set role service_role;
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                              available_from, total_roommates, total_rooms, status, published_at)
    select '22100000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-00000000000a',
           'P2 activa', c.id, n.id, 500, '2026-11-01', 1, 2, 'active', '2000-01-01T00:00:00Z'
    from public.cities c join public.neighborhoods n on n.city_id = c.id and n.slug = 'la-vila-de-gracia'
    where c.slug = 'barcelona'$$,
  1, 'PA10: el servidor inserta una habitación ya activa, con una fecha inventada');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, published_at)
    select '22100000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-00000000000a',
           'P3 borrador', c.id, 500, '2026-11-01', '2000-01-01T00:00:00Z'
    from public.cities c where c.slug = 'barcelona'$$,
  1, 'PA10: y un borrador, también con fecha inventada');
reset role;
select roomly_test.ok(
  (select published_at > '2026-01-01T00:00:00Z' from public.rooms
   where id = '22100000-0000-0000-0000-000000000002')
  and (select published_at is null from public.rooms
       where id = '22100000-0000-0000-0000-000000000003'),
  'PA10: activa → la hora de la publicación; borrador → NULL (la fecha enviada se ignora)');

begin;
alter table public.rooms disable trigger trg_rooms_published_at;
select roomly_test.expect_check_violation(
  $$update public.rooms set published_at = null where id = '22100000-0000-0000-0000-000000000002'$$,
  'chk_rooms_published_at', 'PA11: sin el trigger, el CHECK impide una activa sin fecha');
rollback;
select roomly_test.ok(
  (select t.tgenabled = 'O' from pg_trigger t
   where t.tgrelid = 'public.rooms'::regclass and t.tgname = 'trg_rooms_published_at'),
  'PA11: el trigger sigue activo después del control');
