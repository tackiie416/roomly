-- Fase 4.1 — R7, decisión A del propietario (2026-10-15): `rooms.status` lo
-- actualiza el propietario, dentro de los límites que impone la base de datos.
-- Debe fallar si cambia la matriz de transiciones aprobada:
--   - la propietaria activa mueve su habitación entre draft, active, paused y
--     rented; `active` exige barrio y ocupación (chk_rooms_publishable);
--   - nadie salvo un admin activo o el servidor pone o quita `removed`
--     (trigger de moderación, H5);
--   - una cuenta desactivada no cambia el estado (RLS de la 4.0);
--   - el cliente no fija `status` al crear, y anon no escribe (GRANT);
--   - un admin activo y service_role conservan todas sus transiciones, y
--     service_role tampoco puede activar una habitación incompleta;
--   - una habitación activa no puede quedarse incompleta.
--
-- O: propietaria activa · X: admin activo · D: propietaria desactivada.
-- El barrio es sintético, solo de este test (no es un barrio real; R1).
--
-- Cada intento se clasifica por su motivo, sin depender del idioma de los
-- mensajes del servidor:
--   OK = 1 fila;
--   0f = 0 filas (la fila es visible: lo comprueba la sección 0);
--   H5 = 42501 con el mensaje propio `room_moderation:` del trigger;
--   R7 = 23514 con constraint_name = chk_rooms_publishable;
--   GR = otro 42501 (el GRANT: la sección 4 prueba que la RLS acepta la fila);
--   -- = el estado de partida ni siquiera se puede preparar (una habitación
--        incompleta no puede estar `active`, tampoco para el dueño).
-- Los fixtures son válidos: cada escritura rechazada se acepta en otra celda,
-- con otro actor o en los controles de la sección 5.

reset role;
insert into auth.users (id, email) values
  ('17000000-0000-0000-0000-00000000000a', 'status-o@test'),
  ('17000000-0000-0000-0000-0000000000ad', 'status-admin@test'),
  ('17000000-0000-0000-0000-00000000000d', 'status-d@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('17000000-0000-0000-0000-00000000000a', 'Propietaria O', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('17000000-0000-0000-0000-0000000000ad', 'Admin', '1990-01-01', 'looking_for_room', 'admin');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, deleted_at) values
  ('17000000-0000-0000-0000-00000000000d', 'Desactivada D', '2000-01-01', 'has_room_looking_for_roommate', now());
insert into public.neighborhoods (id, city_id, name, slug)
  select '17300000-0000-0000-0000-000000000001', id, 'Barrio estado test', 'barrio-estado-test'
  from public.cities where slug = 'barcelona';
-- C: completa, de O · I: incompleta (sin barrio ni ocupación), de O ·
-- DR: completa, de D. Todas nacen draft.
insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms)
  select v.id::uuid, v.owner::uuid, v.title, c.id, '17300000-0000-0000-0000-000000000001', 450,
         '2026-11-01', 2, 3
  from public.cities c,
       (values ('17100000-0000-0000-0000-00000000000c', '17000000-0000-0000-0000-00000000000a', 'Completa de O'),
               ('17100000-0000-0000-0000-0000000000dd', '17000000-0000-0000-0000-00000000000d', 'Completa de D'))
         as v(id, owner, title)
  where c.slug = 'barcelona';
insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
  select '17100000-0000-0000-0000-0000000000e1', '17000000-0000-0000-0000-00000000000a',
         'Incompleta de O', c.id, 450, '2026-11-01'
  from public.cities c where c.slug = 'barcelona';

-- ------------------------------------------------------------
-- 0. Permisos efectivos sobre `status` y fixtures
-- ------------------------------------------------------------
select roomly_test.ok(
  not has_column_privilege('authenticated', 'public.rooms', 'status', 'INSERT')
  and has_column_privilege('authenticated', 'public.rooms', 'status', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.rooms', 'INSERT')
  and not has_any_column_privilege('anon', 'public.rooms', 'UPDATE')
  and has_table_privilege('service_role', 'public.rooms', 'INSERT')
  and has_table_privilege('service_role', 'public.rooms', 'UPDATE'),
  'ST0: status: authenticated solo en el UPDATE; anon no escribe; service_role, en la tabla entera');
select roomly_test.ok(
  exists (select 1 from pg_trigger
          where tgname = 'trg_rooms_moderation' and tgrelid = 'public.rooms'::regclass
            and tgenabled = 'O')
  and exists (select 1 from pg_constraint
              where conrelid = 'public.rooms'::regclass and conname = 'chk_rooms_publishable'),
  'ST0: el trigger de moderación está activo y chk_rooms_publishable existe');
select roomly_test.ok(
  enum_range(null::public.room_status)::text[] = array['draft', 'active', 'paused', 'rented', 'removed'],
  'ST0: room_status tiene exactamente los 5 estados de la matriz: un estado nuevo exige revisarla');
select roomly_test.ok(
  (select count(*) = 3 from public.rooms
   where id in ('17100000-0000-0000-0000-00000000000c', '17100000-0000-0000-0000-0000000000dd',
                '17100000-0000-0000-0000-0000000000e1') and status = 'draft')
  and (select neighborhood_id is not null and total_roommates is not null and total_rooms is not null
       from public.rooms where id = '17100000-0000-0000-0000-00000000000c')
  and (select neighborhood_id is null and total_roommates is null and total_rooms is null
       from public.rooms where id = '17100000-0000-0000-0000-0000000000e1'),
  'ST0: fixtures: C y DR completas, I incompleta, las tres en draft');
set role authenticated;
select roomly_test.login('17000000-0000-0000-0000-00000000000d');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '17100000-0000-0000-0000-0000000000dd'$$,
  1, 'ST0: D ve su habitación: sus 0 filas de abajo vienen de la RLS de escritura');
select roomly_test.login('17000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '17100000-0000-0000-0000-00000000000c'$$,
  1, 'ST0: el admin ve la habitación de O');
reset role;

-- ------------------------------------------------------------
-- 1. Matriz de transiciones (6 casos × 20 transiciones)
--    El estado de partida lo fija el dueño de las tablas; el intento se hace
--    con el rol del actor en una subtransacción que siempre se deshace, así
--    que las celdas no se influyen entre sí.
-- ------------------------------------------------------------
do $$
declare
  states text[] := array['draft', 'active', 'paused', 'rented', 'removed'];
  -- etiqueta, rol, usuario, habitación
  actors text[][] := array[
    ['propietaria, habitación completa', 'authenticated',
     '17000000-0000-0000-0000-00000000000a', '17100000-0000-0000-0000-00000000000c'],
    ['propietaria, habitación incompleta', 'authenticated',
     '17000000-0000-0000-0000-00000000000a', '17100000-0000-0000-0000-0000000000e1'],
    ['admin, habitación completa de O', 'authenticated',
     '17000000-0000-0000-0000-0000000000ad', '17100000-0000-0000-0000-00000000000c'],
    ['propietaria desactivada, su habitación completa', 'authenticated',
     '17000000-0000-0000-0000-00000000000d', '17100000-0000-0000-0000-0000000000dd'],
    ['service_role, habitación completa de O', 'service_role',
     '', '17100000-0000-0000-0000-00000000000c'],
    ['service_role, habitación incompleta de O', 'service_role',
     '', '17100000-0000-0000-0000-0000000000e1']];
  -- Resultado esperado [caso][desde][hacia], en el orden de `states`.
  expected text[][][] := array[
    [['·',  'OK', 'OK', 'OK', 'H5'],
     ['OK', '·',  'OK', 'OK', 'H5'],
     ['OK', 'OK', '·',  'OK', 'H5'],
     ['OK', 'OK', 'OK', '·',  'H5'],
     ['H5', 'H5', 'H5', 'H5', '·' ]],
    [['·',  'R7', 'OK', 'OK', 'H5'],
     ['--', '·',  '--', '--', '--'],
     ['OK', 'R7', '·',  'OK', 'H5'],
     ['OK', 'R7', 'OK', '·',  'H5'],
     ['H5', 'H5', 'H5', 'H5', '·' ]],
    [['·',  'OK', 'OK', 'OK', 'OK'],
     ['OK', '·',  'OK', 'OK', 'OK'],
     ['OK', 'OK', '·',  'OK', 'OK'],
     ['OK', 'OK', 'OK', '·',  'OK'],
     ['OK', 'OK', 'OK', 'OK', '·' ]],
    [['·',  '0f', '0f', '0f', '0f'],
     ['0f', '·',  '0f', '0f', '0f'],
     ['0f', '0f', '·',  '0f', '0f'],
     ['0f', '0f', '0f', '·',  '0f'],
     ['0f', '0f', '0f', '0f', '·' ]],
    [['·',  'OK', 'OK', 'OK', 'OK'],
     ['OK', '·',  'OK', 'OK', 'OK'],
     ['OK', 'OK', '·',  'OK', 'OK'],
     ['OK', 'OK', 'OK', '·',  'OK'],
     ['OK', 'OK', 'OK', 'OK', '·' ]],
    [['·',  'R7', 'OK', 'OK', 'OK'],
     ['--', '·',  '--', '--', '--'],
     ['OK', 'R7', '·',  'OK', 'OK'],
     ['OK', 'R7', 'OK', '·',  'OK'],
     ['OK', 'R7', 'OK', 'OK', '·' ]]];
  meaning text;
  got text;
  violated text;
  rows bigint;
  a int;
  f int;
  t int;
begin
  for a in 1..array_length(actors, 1) loop
    for f in 1..5 loop
      for t in 1..5 loop
        continue when f = t;
        got := null;
        -- Estado de partida, como dueño de las tablas (sin RLS ni trigger).
        begin
          execute format('update public.rooms set status = %L where id = %L',
                         states[f], actors[a][4]);
        exception when others then
          get stacked diagnostics violated = constraint_name;
          got := case when sqlstate = '23514' and violated = 'chk_rooms_publishable' then '--'
                      else 'partida: ' || sqlstate || ': ' || sqlerrm end;
        end;
        if got is null then
          begin
            execute format('set local role %I', actors[a][2]);
            perform roomly_test.login(nullif(actors[a][3], '')::uuid);
            execute format('update public.rooms set status = %L where id = %L',
                           states[t], actors[a][4]);
            get diagnostics rows = row_count;
            got := case rows when 1 then 'OK' when 0 then '0f' else rows::text || ' filas' end;
            raise exception using errcode = 'P0001', message = 'roomly_test: deshacer';
          exception
            when sqlstate 'P0001' then null;
            when others then
              get stacked diagnostics violated = constraint_name;
              got := case
                when sqlstate = '42501' and sqlerrm like 'room_moderation:%' then 'H5'
                when sqlstate = '23514' and violated = 'chk_rooms_publishable' then 'R7'
                else sqlstate || ': ' || sqlerrm
              end;
          end;
        end if;
        meaning := case expected[a][f][t]
          when 'OK' then 'se permite'
          when 'H5' then 'lo rechaza el trigger de moderación'
          when 'R7' then 'lo rechaza chk_rooms_publishable'
          when '0f' then '0 filas (RLS de la 4.0)'
          when '--' then 'ni se puede preparar: incompleta no puede estar active'
        end;
        perform roomly_test.ok(
          got = expected[a][f][t],
          format('ST1: %s: %s → %s, %s%s', actors[a][1], states[f], states[t], meaning,
                 case when got = expected[a][f][t] then '' else ' (obtenido: ' || got || ')' end));
      end loop;
    end loop;
    -- La habitación vuelve a draft para el caso y las secciones siguientes.
    execute format('update public.rooms set status = %L where id = %L', 'draft', actors[a][4]);
  end loop;
end $$;
select roomly_test.ok(
  (select count(*) = 3 from public.rooms
   where id in ('17100000-0000-0000-0000-00000000000c', '17100000-0000-0000-0000-0000000000dd',
                '17100000-0000-0000-0000-0000000000e1') and status = 'draft'),
  'ST1: la matriz deja las tres habitaciones en draft');

-- ------------------------------------------------------------
-- 2. El flujo de la propietaria, persistido paso a paso
--    (los pasos aceptados se quedan; los rechazados no cambian nada)
-- ------------------------------------------------------------
reset role;
update public.rooms set status = 'draft' where id = '17100000-0000-0000-0000-00000000000c';
set role authenticated;
select roomly_test.login('17000000-0000-0000-0000-00000000000a');
do $$
declare
  steps text[][] := array[
    ['publica su habitación completa', 'status = ''active''', 'OK'],
    ['la pausa', 'status = ''paused''', 'OK'],
    ['la reactiva (sigue completa)', 'status = ''active''', 'OK'],
    ['activa, no la deja sin total_rooms: chk_rooms_publishable', 'total_rooms = null', 'R7'],
    ['ni sin total_roommates', 'total_roommates = null', 'R7'],
    ['ni sin barrio', 'neighborhood_id = null', 'R7'],
    ['no la marca removed con una actualización directa: trigger de moderación',
     'status = ''removed''', 'H5'],
    ['edita otro campo sin tocar el estado', 'title = ''Completa de O, editada''', 'OK'],
    ['la marca como alquilada', 'status = ''rented''', 'OK']];
  s text[];
  got text;
  violated text;
  rows bigint;
begin
  foreach s slice 1 in array steps loop
    begin
      execute format('update public.rooms set %s where id = %L',
                     s[2], '17100000-0000-0000-0000-00000000000c');
      get diagnostics rows = row_count;
      got := case rows when 1 then 'OK' when 0 then '0f' else rows::text || ' filas' end;
    exception when others then
      get stacked diagnostics violated = constraint_name;
      got := case
        when sqlstate = '42501' and sqlerrm like 'room_moderation:%' then 'H5'
        when sqlstate = '23514' and violated = 'chk_rooms_publishable' then 'R7'
        else sqlstate || ': ' || sqlerrm
      end;
    end;
    perform roomly_test.ok(got = s[3],
      format('ST2: la propietaria %s%s', s[1],
             case when got = s[3] then '' else ' (obtenido: ' || got || ')' end));
  end loop;
end $$;
reset role;
select roomly_test.ok(
  (select status = 'rented' and title = 'Completa de O, editada'
          and neighborhood_id = '17300000-0000-0000-0000-000000000001'
          and total_roommates = 2 and total_rooms = 3
   from public.rooms where id = '17100000-0000-0000-0000-00000000000c'),
  'ST2: queda rented y completa: los rechazos no cambiaron nada');

-- ------------------------------------------------------------
-- 3. Moderación persistida: el admin retira, la propietaria no la
--    recupera, el admin la devuelve a paused y la propietaria la reactiva
-- ------------------------------------------------------------
set role authenticated;
do $$
declare
  o constant text := '17000000-0000-0000-0000-00000000000a';
  x constant text := '17000000-0000-0000-0000-0000000000ad';
  -- etiqueta, usuario, nuevo estado, esperado
  steps text[][] := array[
    ['el admin la retira (removed)', x, 'removed', 'OK'],
    ['la propietaria no la reactiva', o, 'active', 'H5'],
    ['ni la pasa a draft', o, 'draft', 'H5'],
    ['el admin la devuelve a paused', x, 'paused', 'OK'],
    ['la propietaria la reactiva', o, 'active', 'OK']];
  s text[];
  got text;
  violated text;
  rows bigint;
begin
  foreach s slice 1 in array steps loop
    perform roomly_test.login(s[2]::uuid);
    begin
      execute format('update public.rooms set status = %L where id = %L',
                     s[3], '17100000-0000-0000-0000-00000000000c');
      get diagnostics rows = row_count;
      got := case rows when 1 then 'OK' when 0 then '0f' else rows::text || ' filas' end;
    exception when others then
      get stacked diagnostics violated = constraint_name;
      got := case
        when sqlstate = '42501' and sqlerrm like 'room_moderation:%' then 'H5'
        when sqlstate = '23514' and violated = 'chk_rooms_publishable' then 'R7'
        else sqlstate || ': ' || sqlerrm
      end;
    end;
    perform roomly_test.ok(got = s[4],
      format('ST3: %s%s', s[1],
             case when got = s[4] then '' else ' (obtenido: ' || got || ')' end));
  end loop;
end $$;
reset role;
select roomly_test.ok(
  (select status = 'active' from public.rooms where id = '17100000-0000-0000-0000-00000000000c'),
  'ST3: termina active');

-- ------------------------------------------------------------
-- 4. Al crear y sin sesión: el GRANT
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('17000000-0000-0000-0000-00000000000a');
do $$
declare
  steps text[][] := array[
    ['ST4: el cliente no fija status al crear, ni siquiera draft (GRANT)',
     'insert into public.rooms (id, owner_id, title, city_id, price_month, available_from, status) '
     || 'select ''17100000-0000-0000-0000-0000000000f1'', ''17000000-0000-0000-0000-00000000000a'', '
     || '''Nueva de O'', c.id, 450, ''2026-11-01'', ''draft'' from public.cities c where c.slug = ''barcelona''',
     'GR'],
    ['ST4: ni active',
     'insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month, available_from, '
     || 'total_roommates, total_rooms, status) '
     || 'select ''17100000-0000-0000-0000-0000000000f1'', ''17000000-0000-0000-0000-00000000000a'', '
     || '''Nueva de O'', c.id, ''17300000-0000-0000-0000-000000000001'', 450, ''2026-11-01'', 2, 3, ''active'' '
     || 'from public.cities c where c.slug = ''barcelona''',
     'GR'],
    ['ST4-control: la misma fila sin status entra: la RLS la acepta',
     'insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month, available_from, '
     || 'total_roommates, total_rooms) '
     || 'select ''17100000-0000-0000-0000-0000000000f1'', ''17000000-0000-0000-0000-00000000000a'', '
     || '''Nueva de O'', c.id, ''17300000-0000-0000-0000-000000000001'', 450, ''2026-11-01'', 2, 3 '
     || 'from public.cities c where c.slug = ''barcelona''',
     'OK']];
  s text[];
  got text;
  rows bigint;
begin
  foreach s slice 1 in array steps loop
    begin
      execute s[2];
      get diagnostics rows = row_count;
      got := case rows when 1 then 'OK' when 0 then '0f' else rows::text || ' filas' end;
    exception when others then
      got := case
        when sqlstate = '42501' and sqlerrm not like 'room_moderation:%' then 'GR'
        else sqlstate || ': ' || sqlerrm
      end;
    end;
    perform roomly_test.ok(got = s[3],
      s[1] || case when got = s[3] then '' else ' (obtenido: ' || got || ')' end);
  end loop;
end $$;
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '17100000-0000-0000-0000-0000000000f1' and status = 'draft'$$,
  1, 'ST4: y nace draft');
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.rooms where id = '17100000-0000-0000-0000-00000000000c'$$,
  1, 'ST4: anon ve la habitación activa');
select roomly_test.expect_error(
  $$update public.rooms set status = 'paused' where id = '17100000-0000-0000-0000-00000000000c'$$,
  '42501', 'ST4: pero no cambia su estado');
select roomly_test.expect_error(
  $$insert into public.rooms (id, owner_id, title, city_id, price_month, available_from)
    select '17100000-0000-0000-0000-0000000000f2', '17000000-0000-0000-0000-00000000000a',
           'Anónima', c.id, 450, '2026-11-01'
    from public.cities c where c.slug = 'barcelona'$$,
  '42501', 'ST4: ni crea habitaciones');
reset role;
select roomly_test.ok(
  (select status = 'active' from public.rooms where id = '17100000-0000-0000-0000-00000000000c')
  and not exists (select 1 from public.rooms where id = '17100000-0000-0000-0000-0000000000f2'),
  'ST4: los intentos de anon no cambiaron nada');

-- ------------------------------------------------------------
-- 5. Controles: cada rechazo depende de su causa, no de un fixture roto
-- ------------------------------------------------------------
-- 5a. Sin el trigger de moderación, la propietaria pondría removed.
reset role;
begin;
alter table public.rooms disable trigger trg_rooms_moderation;
set role authenticated;
select roomly_test.login('17000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'removed' where id = '17100000-0000-0000-0000-00000000000c'$$,
  1, 'ST5: sin el trigger, la propietaria podría marcar removed');
reset role;
rollback;
select roomly_test.ok(
  exists (select 1 from pg_trigger
          where tgname = 'trg_rooms_moderation' and tgrelid = 'public.rooms'::regclass
            and tgenabled = 'O')
  and (select status = 'active' from public.rooms where id = '17100000-0000-0000-0000-00000000000c'),
  'ST5: el trigger vuelve a estar activo y la habitación sigue active');

-- 5b. Reactivada, D sí cambia el estado de su habitación: sus 0 filas
--     vienen de la desactivación.
begin;
update public.profiles set deleted_at = null where id = '17000000-0000-0000-0000-00000000000d';
set role authenticated;
select roomly_test.login('17000000-0000-0000-0000-00000000000d');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '17100000-0000-0000-0000-0000000000dd'$$,
  1, 'ST5: reactivada, D publicaría su habitación');
reset role;
rollback;
select roomly_test.ok(
  (select deleted_at is not null from public.profiles where id = '17000000-0000-0000-0000-00000000000d')
  and (select status = 'draft' from public.rooms where id = '17100000-0000-0000-0000-0000000000dd'),
  'ST5: D vuelve a estar desactivada y su habitación sigue draft');

-- 5c. Completada, la habitación I sí se publica: su rechazo venía de que
--     estaba incompleta. Pausada, puede volver a quedarse sin esos datos.
reset role;
update public.rooms set status = 'draft' where id = '17100000-0000-0000-0000-0000000000e1';
set role authenticated;
select roomly_test.login('17000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.rooms set neighborhood_id = '17300000-0000-0000-0000-000000000001',
                            total_roommates = 1, total_rooms = 2
    where id = '17100000-0000-0000-0000-0000000000e1'$$,
  1, 'ST5: la propietaria completa la habitación I en draft');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '17100000-0000-0000-0000-0000000000e1'$$,
  1, 'ST5: y ya la puede publicar');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'paused' where id = '17100000-0000-0000-0000-0000000000e1'$$,
  1, 'ST5: la pausa');
select roomly_test.expect_affected(
  $$update public.rooms set neighborhood_id = null, total_roommates = null, total_rooms = null
    where id = '17100000-0000-0000-0000-0000000000e1'$$,
  1, 'ST5: pausada, puede volver a dejarla incompleta');
reset role;
select roomly_test.ok(
  (select status = 'paused' and neighborhood_id is null and total_rooms is null
   from public.rooms where id = '17100000-0000-0000-0000-0000000000e1'),
  'ST5: chk_rooms_publishable solo exige esos datos cuando está active');
