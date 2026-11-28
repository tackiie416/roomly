-- Validación contra Supabase real — comprobaciones de infraestructura P0–P6.
-- Solo lectura de catálogo: no crea, modifica ni borra nada (ni tablas temporales).
-- Se ejecuta como el rol de conexión del proyecto (postgres). Cualquier
-- comprobación fallida lanza una excepción y psql termina con exit != 0.
-- Ver docs/SUPABASE_VALIDATION.md.

-- ============================================================
-- P0 — Identidad del proyecto (F1). Va primero: si la base de datos no
-- lleva una marca de validación permitida (y, cuando el runner la declara,
-- la marca esperada exacta), no se comprueba ni se ejecuta nada más.
-- (guard.sh ya lo verifica antes de conectar a nada destructivo; esto lo
-- repite dentro de la misma sesión que ejecuta preflight.)
--
-- Allow-list F1: se aceptan EXCLUSIVAMENTE roomly-validation-3 (compatibilidad)
-- y roomly-validation-4 (instalación limpia, D2). Quedan fuera los proyectos de
-- validación anteriores (Fase 2.8 y Fase 1), producción y cualquier marca
-- desconocida. run-preflight.sh pasa además la marca esperada con
-- -v expected_marker=<marca>, y entonces P0 exige coincidencia exacta.
-- ============================================================
\if :{?expected_marker}
\else
\set expected_marker ''
\endif
-- La marca esperada se pasa a una GUC FUERA del bloque $$ (psql no interpola
-- variables dentro de los cuerpos $$). run-preflight.sh la fija con
-- -v expected_marker=<marca>; sin ella queda vacía (solo se comprueba la allow-list).
select set_config('roomly.expected_marker', :'expected_marker', false);
do $$
declare
  db_marker text := coalesce(
    (select shobj_description(d.oid, 'pg_database')
     from pg_database d where d.datname = current_database()), '');
  expected  text := coalesce(current_setting('roomly.expected_marker', true), '');
begin
  if db_marker not in ('roomly-validation-3', 'roomly-validation-4') then
    raise exception 'FALLO P0: el destino NO es un proyecto de validación permitido (su marca no está en la allow-list roomly-validation-3 / roomly-validation-4). Abortado.';
  end if;
  if expected <> '' and db_marker <> expected then
    raise exception 'FALLO P0: el destino no coincide con la marca esperada del proyecto declarada por el Environment. Abortado.';
  end if;
  raise notice 'ok - P0: destino % en la allow-list de validación%',
    db_marker,
    case when expected <> '' then ' y coincide con la marca esperada' else '' end;
end $$;

-- ============================================================
-- P1 — Versión real y migraciones aplicadas
-- ============================================================
do $$
declare
  n_tables int;
begin
  raise notice 'P1 info - %', version();

  select count(*) into n_tables from pg_tables where schemaname = 'public';
  -- 20 desde 20261128120000 (user_blocks e interest_log); 21 desde
  -- 20261201120000 (account_deletion_requests).
  if n_tables <> 21 then
    raise exception 'FALLO P1: se esperaban 21 tablas en public, hay %', n_tables;
  end if;

  if to_regprocedure('public.is_conversation_participant(uuid)') is null then
    raise exception 'FALLO P1: falta public.is_conversation_participant(uuid) (migración 20260926120000 no aplicada)';
  end if;
  if to_regprocedure('public.enforce_room_moderation()') is null then
    raise exception 'FALLO P1: falta public.enforce_room_moderation()';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_rooms_moderation' and not tgisinternal) then
    raise exception 'FALLO P1: falta el trigger trg_rooms_moderation';
  end if;
  if to_regprocedure('public.delete_own_room(uuid, uuid)') is null then
    raise exception 'FALLO P1: falta public.delete_own_room(uuid, uuid) (migración 20261030120000 no aplicada)';
  end if;
  if not exists (select 1 from public.cities where slug = 'barcelona' and is_active) then
    raise exception 'FALLO P1: falta la ciudad barcelona activa (la crean la migración 20261016120000 y el seed)';
  end if;

  -- Fase 4.1, R1 (20261016120000): Barcelona tiene exactamente los 73 barrios
  -- oficiales del Ajuntament de Barcelona. La huella es el md5 de «slug|nombre»
  -- ordenados por slug; validation-infra comprueba que es la de la migración.
  declare
    n_barcelona int;
    fingerprint text;
  begin
    select count(*), md5(string_agg(n.slug || '|' || n.name, chr(10) order by n.slug collate "C"))
      into n_barcelona, fingerprint
    from public.neighborhoods n
    join public.cities c on c.id = n.city_id
    where c.slug = 'barcelona';
    if n_barcelona <> 73 or fingerprint is distinct from '9847876cf9e43791d3ad0a206f28813a' then
      raise exception 'FALLO P1: los barrios de Barcelona no son los 73 oficiales (migración 20261016120000): hay %, con la huella %', n_barcelona, fingerprint;
    end if;
  end;

  -- Fase 4.1 (20261015120000): las restricciones de integridad de rooms
  -- existen y están validadas, la FK compuesta une (barrio, ciudad) y el
  -- catálogo de características es exactamente el aprobado (R6).
  declare
    missing text;
    catalog text[];
  begin
    select string_agg(v.conname, ', ' order by v.conname) into missing
    from (values ('chk_rooms_features_catalog'), ('chk_rooms_features_unique'),
                 ('chk_rooms_total_roommates'), ('chk_rooms_total_rooms'),
                 ('chk_rooms_publishable'), ('fk_rooms_neighborhood_city')) as v(conname)
    where not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.rooms'::regclass and c.conname = v.conname and c.convalidated
    );
    if missing is not null then
      raise exception 'FALLO P1: faltan o no están validadas restricciones de rooms de la Fase 4.1 (migración 20261015120000): %', missing;
    end if;
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.rooms'::regclass and c.conname = 'fk_rooms_neighborhood_city'
        and c.contype = 'f' and c.confrelid = 'public.neighborhoods'::regclass
        and (select array_agg(a.attname::text order by k.ord)
             from unnest(c.conkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
            = array['neighborhood_id', 'city_id']
        and (select array_agg(a.attname::text order by k.ord)
             from unnest(c.confkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
            = array['id', 'city_id']
    ) then
      raise exception 'FALLO P1: fk_rooms_neighborhood_city no une (neighborhood_id, city_id) con neighborhoods(id, city_id)';
    end if;
    select array_agg(m[1] order by m[1]) into catalog
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') as m
    where c.conrelid = 'public.rooms'::regclass and c.conname = 'chk_rooms_features_catalog';
    if catalog is distinct from array[
      'air_conditioning', 'balcony', 'desk', 'dishwasher', 'double_bed', 'elevator',
      'exterior', 'furnished', 'heating', 'private_bathroom', 'washing_machine', 'wifi'
    ] then
      raise exception 'FALLO P1: el catálogo de características de chk_rooms_features_catalog no es el aprobado: %', catalog;
    end if;
  end;

  -- Fase 4.2 (20261024120000 y 20261025120000): R7 y las restricciones de
  -- room_images (ruta canónica room_id/id.webp y posición ≥ 0), validadas y
  -- con esa definición, y el bucket room-images de Storage: privado (D1), un
  -- solo bucket con id = nombre, 5 MiB y solo image/webp. Si la RLS de
  -- storage.buckets pudiera ocultar filas al rol que conecta, no se puede
  -- comprobar (L6_N2): «no lo veo» no es «no existe».
  declare
    missing text;
    can_bypass boolean;
    hidden text;
  begin
    if to_regprocedure('public.is_room_publicly_visible(uuid)') is null then
      raise exception 'FALLO P1: falta public.is_room_publicly_visible(uuid) (R7, migración 20261024120000)';
    end if;
    select string_agg(v.conname, ', ' order by v.conname) into missing
    from (values ('chk_room_images_position', '^CHECK \(\("position" >= 0\)\)$'),
                 ('chk_room_images_storage_path',
                  '^CHECK \(\(storage_path = \(\(\(\(room_id\)::text \|\| ''/''::text\) \|\| \(id\)::text\) \|\| ''\.webp''::text\)\)\)$'))
         as v(conname, definition)
    where not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.room_images'::regclass and c.conname = v.conname
        and c.contype = 'c' and c.convalidated
        and pg_get_constraintdef(c.oid) ~ v.definition
    );
    if missing is not null then
      raise exception 'FALLO P1: faltan, no están validadas o tienen otra definición restricciones de room_images de la Fase 4.2 (migración 20261024120000): %', missing;
    end if;
    if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
      raise exception 'FALLO P1: faltan storage.buckets o storage.objects (Supabase Storage)';
    end if;
    select r.rolsuper or r.rolbypassrls into can_bypass from pg_roles r where r.rolname = current_user;
    select string_agg(c.oid::regclass::text, ', ' order by c.relname) into hidden
    from pg_class c
    where c.oid in ('storage.buckets'::regclass, 'storage.objects'::regclass)
      and c.relrowsecurity and not coalesce(can_bypass, false)
      and (c.relforcerowsecurity or pg_get_userbyid(c.relowner) <> current_user);
    if hidden is not null then
      raise exception 'FALLO P1: no se puede comprobar %: tiene la RLS activa y el rol % no es su dueño ni tiene BYPASSRLS, así que podría no ver todas las filas', hidden, current_user;
    end if;
    if not exists (
      select 1 from storage.buckets b
      where b.id = 'room-images' and b.name = 'room-images' and b.public is false
        and b.file_size_limit = 5242880
        and b.allowed_mime_types = array['image/webp']::text[]
    ) then
      raise exception 'FALLO P1: falta el bucket room-images privado con 5242880 bytes e image/webp (migraciones 20261024120000 y 20261025120000)';
    end if;
    if exists (select 1 from storage.buckets b where b.name = 'room-images' and b.id <> 'room-images') then
      raise exception 'FALLO P1: hay un bucket llamado room-images con otro id';
    end if;
  end;

  -- Fase 4.4 (20261031120000, sesión 71): fecha de publicación. La columna,
  -- el CHECK validado (activa ⇒ con fecha) y el índice parcial del orden por
  -- defecto de la búsqueda pública. El trigger y su función, en P6.
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.rooms'::regclass and a.attname = 'published_at'
      and a.atttypid = 'timestamptz'::regtype and not a.attisdropped
  ) then
    raise exception 'FALLO P1: falta rooms.published_at (timestamptz, migración 20261031120000)';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.rooms'::regclass and c.conname = 'chk_rooms_published_at'
      and c.contype = 'c' and c.convalidated
      and pg_get_constraintdef(c.oid) = 'CHECK (((status <> ''active''::room_status) OR (published_at IS NOT NULL)))'
  ) then
    raise exception 'FALLO P1: falta chk_rooms_published_at validada (migración 20261031120000)';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'rooms' and indexname = 'idx_rooms_public_recent'
      and indexdef = 'CREATE INDEX idx_rooms_public_recent ON public.rooms USING btree (city_id, published_at DESC, id DESC) WHERE ((status = ''active''::room_status) AND (deleted_at IS NULL))'
  ) then
    raise exception 'FALLO P1: falta el índice parcial idx_rooms_public_recent (migración 20261031120000)';
  end if;

  raise notice 'ok - P1: 18 tablas, funciones y trigger de la migración de seguridad presentes, Barcelona con sus 73 barrios oficiales, restricciones de rooms de la Fase 4.1 presentes, R7, restricciones de room_images y bucket room-images privado de la Fase 4.2 presentes, y published_at con su CHECK y su índice (4.4)';
end $$;

-- ============================================================
-- P2 — Dueño común y sin FORCE RLS (base de is_conversation_participant)
-- ============================================================
do $$
declare
  fn_owner regrole;
  cp_owner regrole;
  forced text;
  owner_bypass boolean;
begin
  select p.proowner::regrole into fn_owner
  from pg_proc p where p.oid = 'public.is_conversation_participant(uuid)'::regprocedure;
  select c.relowner::regrole into cp_owner
  from pg_class c where c.oid = 'public.conversation_participants'::regclass;

  if fn_owner <> cp_owner then
    raise exception 'FALLO P2: is_conversation_participant pertenece a % y conversation_participants a %', fn_owner, cp_owner;
  end if;

  select string_agg(c.relname, ', ') into forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity;
  if forced is not null then
    raise exception 'FALLO P2: FORCE ROW LEVEL SECURITY activo en: %', forced;
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = 'public.is_conversation_participant(uuid)'::regprocedure) then
    raise exception 'FALLO P2: is_conversation_participant no es SECURITY DEFINER';
  end if;
  if not (select p.proconfig @> array['search_path=""'] from pg_proc p
          where p.oid = 'public.is_conversation_participant(uuid)'::regprocedure) then
    raise exception 'FALLO P2: is_conversation_participant no tiene search_path vacío';
  end if;

  -- R7 (Fase 4.2): is_room_publicly_visible lee rooms y profiles con los
  -- derechos de su dueño; tiene que ser el de las dos tablas (sin FORCE RLS,
  -- arriba), SECURITY DEFINER y con search_path vacío.
  if (select p.proowner from pg_proc p where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure)
       is distinct from (select c.relowner from pg_class c where c.oid = 'public.rooms'::regclass)
     or (select p.proowner from pg_proc p where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure)
       is distinct from (select c.relowner from pg_class c where c.oid = 'public.profiles'::regclass) then
    raise exception 'FALLO P2: is_room_publicly_visible no es del mismo dueño que rooms y profiles';
  end if;
  if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
          where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure) then
    raise exception 'FALLO P2: is_room_publicly_visible no es SECURITY DEFINER con search_path vacío';
  end if;

  select r.rolbypassrls into owner_bypass from pg_roles r where r.oid = cp_owner::oid;
  raise notice 'P2 info - dueño de tablas y función: % (rolbypassrls=%)', cp_owner, owner_bypass;
  raise notice 'ok - P2: funciones y tablas con el mismo dueño, sin FORCE RLS, SECURITY DEFINER con search_path vacío (is_conversation_participant e is_room_publicly_visible)';
end $$;

-- ============================================================
-- P3 — RLS activa en todas las tablas y conjunto EXACTO de políticas
-- ============================================================
-- Lista derivada de supabase/migrations (Fase 2.8): 35 de 20260925120100,
-- sustituciones sin cambio de número en 20260926120000, 20260929120000 y
-- 20260930140000, en 20260930130000 `housing_preferences_own` pasa a ser
-- cuatro políticas (select/insert/update/delete_own) y en 20261004120100
-- (Fase 2.9, H4) se elimina `profiles_select_authenticated`. En 20261007120000
-- (Fase 3.1) `compatibility_responses_own` (ALL) se sustituye por
-- `compatibility_responses_select_own` (SELECT). En 20261013120000 (Fase
-- 4.0) `rooms_owner_write`, `room_addresses_owner_only` y
-- `room_images_owner_write` (ALL) se dividen por comando: −3 +10. En
-- 20261024120000 (Fase 4.2) se eliminan las tres de escritura de room_images
-- y se añade `room_images_admin_select`: −3 +1. En 20261030120000 (sesión
-- 65) se elimina `rooms_delete_own`: el borrado lo hace el servidor. En
-- 20261031120100 (sesión 71) `room_images_select` se divide en
-- `room_images_select_public` y `room_images_select_own` (solo
-- authenticated): −1 +2. En 20261126120000 (Fase 5.1) se eliminan
-- `interests_insert_own` e `interests_delete_own`: el interés lo escribe el
-- servidor. En 20261128120000 (sesión 83) se añaden `user_blocks_select_own`
-- e `interest_log_no_client_access`. Total: 42 en 20 tablas. En 20261201120000 se añade
-- `account_deletion_requests_no_client_access`. Total: 43 en 21 tablas.
-- Se compara (tabla, política, comando) en los dos sentidos: falta o sobra
-- cualquiera → fallo, con el nombre. Además (Fase 4.0), cada política de
-- escritura de rooms, room_addresses y room_images exige la cuenta activa
-- (`deleted_at IS NULL`) en todas sus expresiones. Y desde la Fase 4.2 (R7),
-- la lectura pública de habitaciones y fotos pasa por
-- is_room_publicly_visible, la del admin es solo SELECT con is_admin(),
-- storage.objects y storage.buckets tienen la RLS activa, storage.objects no
-- tiene ninguna política y storage.buckets ninguna de escritura.
do $$
declare
  no_rls text;
  missing text;
  unexpected text;
  n_expected int;
  writes_without_account text;
begin
  select string_agg(tablename, ', ') into no_rls
  from pg_tables where schemaname = 'public' and not rowsecurity;
  if no_rls is not null then
    raise exception 'FALLO P3: tablas de public sin RLS: %', no_rls;
  end if;

  with expected(tablename, policyname, cmd) as (values
    ('admin_action_logs', 'admin_action_logs_admin_select', 'SELECT'),
    ('cities', 'cities_admin_write', 'ALL'),
    ('cities', 'cities_select_all', 'SELECT'),
    ('compatibility_responses', 'compatibility_responses_select_own', 'SELECT'),
    ('conversation_participants', 'participants_select_own_conversations', 'SELECT'),
    ('conversation_participants', 'participants_update_own', 'UPDATE'),
    ('conversations', 'conversations_select_participant', 'SELECT'),
    ('favorites', 'favorites_own', 'ALL'),
    ('housing_preferences', 'housing_preferences_delete_own', 'DELETE'),
    ('housing_preferences', 'housing_preferences_insert_own', 'INSERT'),
    ('housing_preferences', 'housing_preferences_select_own', 'SELECT'),
    ('housing_preferences', 'housing_preferences_update_own', 'UPDATE'),
    ('interest_log', 'interest_log_no_client_access', 'SELECT'),
    ('account_deletion_requests', 'account_deletion_requests_no_client_access', 'SELECT'),
    ('interests', 'interests_select_participant', 'SELECT'),
    ('matches', 'matches_select_participant', 'SELECT'),
    ('messages', 'messages_insert_participant', 'INSERT'),
    ('messages', 'messages_select_participant', 'SELECT'),
    ('neighborhoods', 'neighborhoods_admin_write', 'ALL'),
    ('neighborhoods', 'neighborhoods_select_all', 'SELECT'),
    ('notifications', 'notifications_own', 'ALL'),
    ('profiles', 'profiles_admin_select', 'SELECT'),
    ('profiles', 'profiles_insert_own', 'INSERT'),
    ('profiles', 'profiles_select_own_even_if_deleted', 'SELECT'),
    ('profiles', 'profiles_update_own', 'UPDATE'),
    ('reports', 'reports_admin_select', 'SELECT'),
    ('reports', 'reports_insert_own', 'INSERT'),
    ('reports', 'reports_select_own', 'SELECT'),
    ('room_addresses', 'room_addresses_delete_own', 'DELETE'),
    ('room_addresses', 'room_addresses_insert_own', 'INSERT'),
    ('room_addresses', 'room_addresses_select_own', 'SELECT'),
    ('room_addresses', 'room_addresses_update_own', 'UPDATE'),
    ('room_images', 'room_images_admin_select', 'SELECT'),
    ('room_images', 'room_images_select_own', 'SELECT'),
    ('room_images', 'room_images_select_public', 'SELECT'),
    ('rooms', 'rooms_admin_select', 'SELECT'),
    ('rooms', 'rooms_insert_own', 'INSERT'),
    ('rooms', 'rooms_select_active_public', 'SELECT'),
    ('rooms', 'rooms_select_own', 'SELECT'),
    ('rooms', 'rooms_update_own', 'UPDATE'),
    ('universities', 'universities_admin_write', 'ALL'),
    ('user_blocks', 'user_blocks_select_own', 'SELECT'),
    ('universities', 'universities_select_all', 'SELECT')
  ),
  actual as (
    select tablename::text, policyname::text, cmd::text from pg_policies where schemaname = 'public'
  )
  select
    (select count(*) from expected),
    (select string_agg(format('%s.%s (%s)', e.tablename, e.policyname, e.cmd), ', '
                       order by e.tablename, e.policyname)
     from (select * from expected except select * from actual) e),
    (select string_agg(format('%s.%s (%s)', a.tablename, a.policyname, a.cmd), ', '
                       order by a.tablename, a.policyname)
     from (select * from actual except select * from expected) a)
  into n_expected, missing, unexpected;

  if n_expected <> 43 then
    raise exception 'FALLO P3: la lista esperada no tiene 43 entradas (error del propio preflight)';
  end if;
  if missing is not null or unexpected is not null then
    raise exception 'FALLO P3: políticas distintas de las esperadas. Faltan: %. Sobran: %',
      coalesce(missing, 'ninguna'), coalesce(unexpected, 'ninguna');
  end if;

  -- Fase 4.0: WITH CHECK en INSERT, USING y WITH CHECK en UPDATE, USING en
  -- DELETE. `rooms_admin_select` es solo de lectura (Fase 7).
  select string_agg(format('%s.%s (%s)', p.tablename, p.policyname, p.cmd), ', '
                    order by p.tablename, p.policyname)
  into writes_without_account
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('rooms', 'room_addresses', 'room_images')
    and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
    and not (
      (p.cmd = 'INSERT' or coalesce(p.qual, '') like '%deleted_at IS NULL%')
      and (p.cmd = 'DELETE' or coalesce(p.with_check, '') like '%deleted_at IS NULL%')
    );
  if writes_without_account is not null then
    raise exception 'FALLO P3: políticas de escritura de habitaciones sin la comprobación de cuenta activa: %',
      writes_without_account;
  end if;

  -- Fase 4.2 (R7): la lectura pública mira la cuenta del propietario.
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'rooms' and p.policyname = 'rooms_select_active_public'
      and p.qual like '%is_room_publicly_visible(id)%'
  ) or not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'room_images' and p.policyname = 'room_images_select_public'
      and p.qual = 'is_room_publicly_visible(room_id)'
  ) then
    raise exception 'FALLO P3: la lectura pública de rooms o de room_images no pasa por is_room_publicly_visible (R7)';
  end if;
  -- Desde 20261031120100: la lectura de las fotos propias es solo de
  -- authenticated, para que ninguna política que se aplique a anon lea
  -- rooms.owner_id (anon ya no tiene SELECT en esa columna).
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'room_images' and p.policyname = 'room_images_select_own'
      and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[] and p.qual like '%owner_id = auth.uid()%'
  ) then
    raise exception 'FALLO P3: room_images_select_own no es solo SELECT de authenticated sobre las fotos propias';
  end if;
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'room_images' and p.policyname = 'room_images_admin_select'
      and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[] and p.qual = 'is_admin()'
  ) then
    raise exception 'FALLO P3: room_images_admin_select no es solo SELECT de authenticated con is_admin()';
  end if;

  -- Fase 4.2 (Storage): ningún cliente escribe, lista ni descarga objetos.
  -- Las fotos las sube el servidor y las sirve con URL firmadas (D1), así que
  -- storage.objects no necesita ninguna política; storage.buckets, ninguna de
  -- escritura (podría volver a hacer público el bucket). Las dos, con la RLS
  -- activa: sin ella, no tener políticas no protege nada.
  declare
    storage_policies text;
  begin
    if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
      raise exception 'FALLO P3: no se pueden comprobar las políticas de Storage: falta storage.objects o storage.buckets';
    end if;
    if not coalesce((select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass), false) then
      raise exception 'FALLO P3: storage.objects no tiene la RLS activa';
    end if;
    if not coalesce((select c.relrowsecurity from pg_class c where c.oid = 'storage.buckets'::regclass), false) then
      raise exception 'FALLO P3: storage.buckets no tiene la RLS activa';
    end if;
    select string_agg(p.policyname || ' (' || p.cmd || ')', ', ' order by p.policyname) into storage_policies
    from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects';
    if storage_policies is not null then
      raise exception 'FALLO P3: storage.objects tiene políticas (la escritura y la lectura de room-images son solo del servidor): %',
        storage_policies;
    end if;
    select string_agg(p.policyname || ' (' || p.cmd || ')', ', ' order by p.policyname) into storage_policies
    from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'buckets' and p.cmd <> 'SELECT';
    if storage_policies is not null then
      raise exception 'FALLO P3: storage.buckets tiene políticas de escritura: %', storage_policies;
    end if;
  end;

  raise notice 'ok - P3: RLS activa en las 21 tablas, exactamente las 43 políticas esperadas, las escrituras de habitaciones exigen cuenta activa, la lectura pública de habitaciones y fotos aplica R7, storage.objects y storage.buckets tienen la RLS activa, storage.objects no tiene políticas y storage.buckets ninguna de escritura';
end $$;

-- ============================================================
-- P4 — Permisos reales (privilegios por defecto de Supabase incluidos)
-- ============================================================
do $$
declare
  failures text[] := '{}';
  col text;
  grantee text;
begin
  -- profiles: role y deleted_at fuera de INSERT y UPDATE para authenticated
  foreach col in array array['role', 'deleted_at'] loop
    if has_column_privilege('authenticated', 'public.profiles', col, 'INSERT') then
      failures := failures || format('authenticated puede INSERT profiles.%s', col);
    end if;
    if has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE') then
      failures := failures || format('authenticated puede UPDATE profiles.%s', col);
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'INSERT')
     or not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    failures := failures || 'authenticated NO puede INSERT/UPDATE profiles.full_name (fix demasiado restrictivo)'::text;
  end if;

  -- anon sin escritura en profiles
  if has_any_column_privilege('anon', 'public.profiles', 'INSERT') then
    failures := failures || 'anon puede INSERT en profiles'::text;
  end if;
  if has_any_column_privilege('anon', 'public.profiles', 'UPDATE') then
    failures := failures || 'anon puede UPDATE en profiles'::text;
  end if;

  -- reports: campos administrativos fuera del INSERT
  foreach col in array array['status', 'resolved_by', 'resolved_at', 'resolution_notes'] loop
    if has_column_privilege('authenticated', 'public.reports', col, 'INSERT') then
      failures := failures || format('authenticated puede INSERT reports.%s', col);
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.reports', 'reason', 'INSERT') then
    failures := failures || 'authenticated NO puede INSERT reports.reason (fix demasiado restrictivo)'::text;
  end if;

  -- conversation_participants: solo last_read_at actualizable
  if has_column_privilege('authenticated', 'public.conversation_participants', 'conversation_id', 'UPDATE') then
    failures := failures || 'authenticated puede UPDATE conversation_participants.conversation_id'::text;
  end if;
  if not has_column_privilege('authenticated', 'public.conversation_participants', 'last_read_at', 'UPDATE') then
    failures := failures || 'authenticated NO puede UPDATE conversation_participants.last_read_at'::text;
  end if;

  -- is_conversation_participant: solo authenticated (ni anon ni PUBLIC)
  if not has_function_privilege('authenticated', 'public.is_conversation_participant(uuid)', 'EXECUTE') then
    failures := failures || 'authenticated NO puede ejecutar is_conversation_participant'::text;
  end if;
  if has_function_privilege('anon', 'public.is_conversation_participant(uuid)', 'EXECUTE') then
    failures := failures || 'anon puede ejecutar is_conversation_participant'::text;
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.is_conversation_participant(uuid)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    failures := failures || 'PUBLIC puede ejecutar is_conversation_participant'::text;
  end if;

  -- housing_preferences (20260929120000): anon sin ningún privilegio;
  -- authenticated solo INSERT/UPDATE por columnas (profile_id fuera del
  -- UPDATE, updated_at fuera de los dos), SELECT y DELETE sujetos a RLS.
  foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.housing_preferences', col) then
      failures := failures || format('anon tiene %s en housing_preferences', col);
    end if;
  end loop;
  if has_any_column_privilege('anon', 'public.housing_preferences', 'SELECT')
     or has_any_column_privilege('anon', 'public.housing_preferences', 'INSERT')
     or has_any_column_privilege('anon', 'public.housing_preferences', 'UPDATE') then
    failures := failures || 'anon tiene privilegios de columna en housing_preferences'::text;
  end if;
  if has_table_privilege('authenticated', 'public.housing_preferences', 'INSERT')
     or has_table_privilege('authenticated', 'public.housing_preferences', 'UPDATE') then
    failures := failures || 'authenticated tiene INSERT/UPDATE de tabla completa en housing_preferences'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.housing_preferences', 'SELECT')
     or not has_table_privilege('authenticated', 'public.housing_preferences', 'DELETE') then
    failures := failures || 'authenticated NO tiene SELECT/DELETE en housing_preferences (fix demasiado restrictivo)'::text;
  end if;
  declare
    got_insert text;
    got_update text;
  begin
    select string_agg(a.attname, ',' order by a.attname) into got_insert
    from pg_attribute a
    where a.attrelid = 'public.housing_preferences'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT');
    select string_agg(a.attname, ',' order by a.attname) into got_update
    from pg_attribute a
    where a.attrelid = 'public.housing_preferences'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE');
    if got_insert is distinct from 'budget_max,budget_min,city_id,field_of_study,move_in_date,move_out_date,preferred_neighborhood_ids,profile_id,roommates_wanted_max,roommates_wanted_min,university_id' then
      failures := failures || format('INSERT de authenticated en housing_preferences: columnas inesperadas (%s)', got_insert);
    end if;
    if got_update is distinct from 'budget_max,budget_min,city_id,field_of_study,move_in_date,move_out_date,preferred_neighborhood_ids,roommates_wanted_max,roommates_wanted_min,university_id' then
      failures := failures || format('UPDATE de authenticated en housing_preferences: columnas inesperadas (%s)', got_update);
    end if;
  end;

  -- compatibility_responses (20261007120000, Fase 3.1): anon sin ningún
  -- privilegio; authenticated solo SELECT (su fila, por RLS), sin ninguna
  -- escritura ni de tabla ni de columna: el único escritor es el servidor.
  foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.compatibility_responses', col) then
      failures := failures || format('anon tiene %s en compatibility_responses', col);
    end if;
  end loop;
  if has_any_column_privilege('anon', 'public.compatibility_responses', 'SELECT')
     or has_any_column_privilege('anon', 'public.compatibility_responses', 'INSERT')
     or has_any_column_privilege('anon', 'public.compatibility_responses', 'UPDATE') then
    failures := failures || 'anon tiene privilegios de columna en compatibility_responses'::text;
  end if;
  foreach col in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.compatibility_responses', col) then
      failures := failures || format('authenticated tiene %s en compatibility_responses', col);
    end if;
  end loop;
  if has_any_column_privilege('authenticated', 'public.compatibility_responses', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.compatibility_responses', 'UPDATE') then
    failures := failures || 'authenticated tiene escritura de columna en compatibility_responses'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.compatibility_responses', 'SELECT') then
    failures := failures || 'authenticated NO tiene SELECT en compatibility_responses (no podría leer su estado)'::text;
  end if;

  -- rooms (20261015120000, Fase 4.1): authenticated escribe por columnas
  -- (sin status al crear; sin deleted_at, created_at, updated_at, approx_lat
  -- ni approx_lng; id y owner_id fuera del UPDATE) y conserva SELECT (RLS);
  -- desde 20261030120000 (sesión 65), ni authenticated ni anon tienen DELETE
  -- ni TRUNCATE: el borrado lo hace el servidor con delete_own_room. anon,
  -- solo SELECT; service_role, tabla completa.
  if has_table_privilege('authenticated', 'public.rooms', 'INSERT')
     or has_table_privilege('authenticated', 'public.rooms', 'UPDATE') then
    failures := failures || 'authenticated tiene INSERT/UPDATE de tabla completa en rooms'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.rooms', 'SELECT') then
    failures := failures || 'authenticated NO tiene SELECT en rooms (fix demasiado restrictivo)'::text;
  end if;
  if has_table_privilege('authenticated', 'public.rooms', 'DELETE')
     or has_table_privilege('authenticated', 'public.rooms', 'TRUNCATE') then
    failures := failures || 'authenticated puede borrar rooms directamente (DELETE o TRUNCATE)'::text;
  end if;
  if has_any_column_privilege('anon', 'public.rooms', 'INSERT')
     or has_any_column_privilege('anon', 'public.rooms', 'UPDATE')
     or has_table_privilege('anon', 'public.rooms', 'DELETE')
     or has_table_privilege('anon', 'public.rooms', 'TRUNCATE') then
    failures := failures || 'anon tiene escritura en rooms'::text;
  end if;
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.rooms'::regclass
      and a.grantee = 0 and a.privilege_type in ('DELETE', 'TRUNCATE')
  ) then
    failures := failures || 'PUBLIC puede borrar rooms (DELETE o TRUNCATE)'::text;
  end if;
  -- Desde 20261031120100 (sesión 71): anon lee solo las 20 columnas de los
  -- DTO públicos, sin SELECT de tabla, REFERENCES ni TRIGGER; PUBLIC, nada.
  if has_table_privilege('anon', 'public.rooms', 'SELECT')
     or has_table_privilege('anon', 'public.rooms', 'REFERENCES')
     or has_table_privilege('anon', 'public.rooms', 'TRIGGER')
     or has_any_column_privilege('anon', 'public.rooms', 'REFERENCES') then
    failures := failures || 'anon tiene SELECT de tabla, REFERENCES o TRIGGER en rooms'::text;
  end if;
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.rooms'::regclass and a.grantee = 0
  ) or exists (
    select 1 from pg_attribute att, aclexplode(att.attacl) a
    where att.attrelid = 'public.rooms'::regclass and att.attacl is not null and a.grantee = 0
  ) then
    failures := failures || 'PUBLIC tiene privilegios en rooms'::text;
  end if;
  declare
    got_anon text;
  begin
    select string_agg(a.attname, ',' order by a.attname) into got_anon
    from pg_attribute a
    where a.attrelid = 'public.rooms'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT');
    if got_anon is distinct from 'available_from,city_id,deposit_amount,description,expenses_included,features,house_rules,id,max_stay_months,min_stay_months,neighborhood_id,pets_allowed,price_month,published_at,roommate_preferences,smoking_allowed,students_only,title,total_roommates,total_rooms' then
      failures := failures || format('SELECT de anon en rooms: columnas inesperadas (%s)', got_anon);
    end if;
  end;
  if not has_table_privilege('service_role', 'public.rooms', 'INSERT')
     or not has_table_privilege('service_role', 'public.rooms', 'UPDATE')
     or not has_table_privilege('service_role', 'public.rooms', 'DELETE') then
    failures := failures || 'service_role sin INSERT/UPDATE/DELETE de tabla completa en rooms'::text;
  end if;
  declare
    got_insert text;
    got_update text;
  begin
    select string_agg(a.attname, ',' order by a.attname) into got_insert
    from pg_attribute a
    where a.attrelid = 'public.rooms'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT');
    select string_agg(a.attname, ',' order by a.attname) into got_update
    from pg_attribute a
    where a.attrelid = 'public.rooms'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE');
    if got_insert is distinct from 'available_from,city_id,deposit_amount,description,expenses_included,features,house_rules,id,max_stay_months,min_stay_months,neighborhood_id,owner_id,pets_allowed,price_month,roommate_preferences,smoking_allowed,students_only,title,total_roommates,total_rooms' then
      failures := failures || format('INSERT de authenticated en rooms: columnas inesperadas (%s)', got_insert);
    end if;
    if got_update is distinct from 'available_from,city_id,deposit_amount,description,expenses_included,features,house_rules,max_stay_months,min_stay_months,neighborhood_id,pets_allowed,price_month,roommate_preferences,smoking_allowed,status,students_only,title,total_roommates,total_rooms' then
      failures := failures || format('UPDATE de authenticated en rooms: columnas inesperadas (%s)', got_update);
    end if;
  end;

  -- room_images (20261024120000, Fase 4.2): solo escribe el servidor. anon y
  -- authenticated conservan SELECT (RLS), sin ninguna escritura ni de tabla
  -- ni de columna; service_role, INSERT, UPDATE y DELETE.
  foreach col in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.room_images', col) then
      failures := failures || format('anon tiene %s en room_images', col);
    end if;
    if has_table_privilege('authenticated', 'public.room_images', col) then
      failures := failures || format('authenticated tiene %s en room_images', col);
    end if;
  end loop;
  if has_any_column_privilege('anon', 'public.room_images', 'INSERT')
     or has_any_column_privilege('anon', 'public.room_images', 'UPDATE')
     or has_any_column_privilege('authenticated', 'public.room_images', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.room_images', 'UPDATE') then
    failures := failures || 'anon o authenticated tienen escritura de columna en room_images'::text;
  end if;
  if not has_table_privilege('anon', 'public.room_images', 'SELECT')
     or not has_table_privilege('authenticated', 'public.room_images', 'SELECT') then
    failures := failures || 'anon o authenticated NO tienen SELECT en room_images (rompería la lectura de fotos)'::text;
  end if;
  if not has_table_privilege('service_role', 'public.room_images', 'INSERT')
     or not has_table_privilege('service_role', 'public.room_images', 'UPDATE')
     or not has_table_privilege('service_role', 'public.room_images', 'DELETE') then
    failures := failures || 'service_role sin INSERT/UPDATE/DELETE en room_images (el servidor no podría guardar fotos)'::text;
  end if;

  -- delete_own_room (20261030120000, sesión 65): solo service_role. Ni
  -- PUBLIC, ni anon, ni authenticated.
  if not has_function_privilege('service_role', 'public.delete_own_room(uuid, uuid)', 'EXECUTE') then
    failures := failures || 'service_role NO puede ejecutar delete_own_room (el servidor no podría borrar habitaciones)'::text;
  end if;
  if has_function_privilege('anon', 'public.delete_own_room(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_own_room(uuid, uuid)', 'EXECUTE') then
    failures := failures || 'anon o authenticated pueden ejecutar delete_own_room'::text;
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.delete_own_room(uuid, uuid)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    failures := failures || 'PUBLIC puede ejecutar delete_own_room'::text;
  end if;

  -- is_room_publicly_visible (R7): solo anon y authenticated, que la llaman
  -- desde la lectura pública. Ni PUBLIC ni service_role.
  if not has_function_privilege('anon', 'public.is_room_publicly_visible(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_room_publicly_visible(uuid)', 'EXECUTE') then
    failures := failures || 'anon o authenticated NO pueden ejecutar is_room_publicly_visible (rompería la lectura pública)'::text;
  end if;
  if has_function_privilege('service_role', 'public.is_room_publicly_visible(uuid)', 'EXECUTE') then
    failures := failures || 'service_role puede ejecutar is_room_publicly_visible'::text;
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.is_room_publicly_visible(uuid)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    failures := failures || 'PUBLIC puede ejecutar is_room_publicly_visible'::text;
  end if;
  -- public_profile_previews (hotfix 20261014120000): PUBLIC, anon y
  -- authenticated sin ningún privilegio, ni de tabla ni de columna. Es
  -- `security_invoker = false` y actualizable: escribir por ella se saltaba
  -- la RLS y el GRANT por columnas de profiles.
  foreach grantee in array array['public', 'anon', 'authenticated'] loop
    foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(grantee, 'public.public_profile_previews', col) then
        failures := failures || format('%s tiene %s en public_profile_previews', grantee, col);
      end if;
    end loop;
    foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege(grantee, 'public.public_profile_previews', col) then
        failures := failures || format('%s tiene %s de columna en public_profile_previews', grantee, col);
      end if;
    end loop;
  end loop;

  -- public_profile_previews (20261031120100, sesión 71): ni anon ni PUBLIC;
  -- authenticated solo SELECT. Es `security_invoker = false` y actualizable:
  -- cualquier escritura por ella saltaría la RLS y el GRANT de profiles.
  foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.public_profile_previews', col) then
      failures := failures || format('anon tiene %s en public_profile_previews', col);
    end if;
    if col <> 'SELECT' and has_table_privilege('authenticated', 'public.public_profile_previews', col) then
      failures := failures || format('authenticated tiene %s en public_profile_previews', col);
    end if;
  end loop;
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.public_profile_previews'::regclass and a.grantee = 0
  ) then
    failures := failures || 'PUBLIC tiene privilegios en public_profile_previews'::text;
  end if;

  -- interests y matches (20261126120000, Fase 5.1): solo los escribe el
  -- servidor. anon, nada; authenticated, solo SELECT; record_interest y
  -- withdraw_interest, solo service_role.
  foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.interests', col)
       or has_table_privilege('anon', 'public.matches', col) then
      failures := failures || format('anon tiene %s en interests o matches', col);
    end if;
    if col <> 'SELECT' and (has_table_privilege('authenticated', 'public.interests', col)
                            or has_table_privilege('authenticated', 'public.matches', col)) then
      failures := failures || format('authenticated tiene %s en interests o matches', col);
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.interests', 'SELECT')
     or not has_table_privilege('authenticated', 'public.matches', 'SELECT') then
    failures := failures || 'authenticated no puede leer interests o matches (sus políticas de participante)'::text;
  end if;
  if not has_function_privilege('service_role', 'public.record_interest(uuid, uuid, integer, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.withdraw_interest(uuid, uuid)', 'EXECUTE') then
    failures := failures || 'service_role no puede ejecutar record_interest o withdraw_interest'::text;
  end if;

  -- Chat (20261127120000, Fase 6): anon, nada; authenticated lee, envía
  -- mensajes por columnas y marca como leído; nada más. undo_match y
  -- room_interest_owner, solo service_role.
  foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.conversations', col)
       or has_table_privilege('anon', 'public.conversation_participants', col)
       or has_table_privilege('anon', 'public.messages', col) then
      failures := failures || format('anon tiene %s en el chat', col);
    end if;
    if col <> 'SELECT' and (has_table_privilege('authenticated', 'public.conversations', col)
                            or has_table_privilege('authenticated', 'public.conversation_participants', col)
                            or has_table_privilege('authenticated', 'public.messages', col)) then
      failures := failures || format('authenticated tiene %s de tabla en el chat', col);
    end if;
  end loop;
  if has_any_column_privilege('authenticated', 'public.messages', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.messages', 'id', 'INSERT')
     or not has_column_privilege('authenticated', 'public.messages', 'content', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.conversations', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.conversations', 'UPDATE')
     or has_any_column_privilege('authenticated', 'public.conversation_participants', 'INSERT') then
    failures := failures || 'privilegios de columna del chat distintos de los esperados (Fase 6)'::text;
  end if;
  if not has_function_privilege('service_role', 'public.undo_match(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.room_interest_owner(uuid)', 'EXECUTE') then
    failures := failures || 'service_role no puede ejecutar undo_match o room_interest_owner'::text;
  end if;

  -- Sesión 83 (20261128120000): bloqueos solo del servidor; nadie lee
  -- interest_log; reports, solo la resolución actualizable y sin DELETE.
  foreach col in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.user_blocks', col)
       or has_table_privilege('anon', 'public.interest_log', col)
       or has_table_privilege('authenticated', 'public.interest_log', col)
       or (col <> 'SELECT' and has_table_privilege('authenticated', 'public.user_blocks', col)) then
      failures := failures || format('privilegio %s inesperado en user_blocks o interest_log', col);
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.reports', 'DELETE')
     or has_column_privilege('authenticated', 'public.reports', 'reason', 'UPDATE')
     or has_column_privilege('authenticated', 'public.reports', 'reporter_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.reports', 'description', 'UPDATE')
     or has_column_privilege('authenticated', 'public.reports', 'status', 'UPDATE') then
    -- Fase 7 (20261129120000): sin UPDATE de reports para clientes; se
    -- resuelven con admin_set_report_status.
    failures := failures || 'privilegios de reports distintos de los esperados (sesión 83 y Fase 7)'::text;
  end if;
  -- Fase 7: admin_action_logs solo lo lee authenticated (RLS: admin) y nadie
  -- borra perfiles desde un cliente.
  foreach col in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('authenticated', 'public.admin_action_logs', col)
       or has_table_privilege('anon', 'public.admin_action_logs', col) then
      failures := failures || format('privilegio %s inesperado en admin_action_logs', col);
    end if;
  end loop;
  -- Sesión 85 (20261130120000): service_role tampoco añade ni edita filas
  -- del registro, y el actor ya no es FK (un admin que actuó se puede borrar).
  foreach col in array array['INSERT', 'UPDATE', 'TRUNCATE'] loop
    if has_table_privilege('service_role', 'public.admin_action_logs', col) then
      failures := failures || format('service_role tiene %s en admin_action_logs', col);
    end if;
  end loop;
  if exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and ((c.conrelid = 'public.admin_action_logs'::regclass and a.attname = 'admin_id')
        or (c.conrelid = 'public.reports'::regclass and a.attname = 'resolved_by'))) then
    failures := failures || 'admin_action_logs.admin_id o reports.resolved_by siguen siendo FK'::text;
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     or has_table_privilege('anon', 'public.profiles', 'DELETE')
     or has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
     or has_table_privilege('anon', 'public.profiles', 'TRUNCATE') then
    failures := failures || 'un cliente puede borrar perfiles (Fase 7)'::text;
  end if;
  -- 20261201120000: reports sin FK (actor y destino seudónimos) y las
  -- solicitudes de eliminación sin acceso de clientes.
  if exists (select 1 from pg_constraint
             where conrelid = 'public.reports'::regclass and contype = 'f') then
    failures := failures || 'reports vuelve a tener FK (impedirían borrar cuentas)'::text;
  end if;
  if has_table_privilege('authenticated', 'public.account_deletion_requests', 'SELECT')
     or has_table_privilege('anon', 'public.account_deletion_requests', 'SELECT')
     or has_table_privilege('service_role', 'public.account_deletion_requests', 'INSERT')
     or has_table_privilege('service_role', 'public.account_deletion_requests', 'UPDATE')
     or has_table_privilege('service_role', 'public.account_deletion_requests', 'DELETE') then
    failures := failures || 'account_deletion_requests con privilegios de más'::text;
  end if;
  if not has_function_privilege('service_role', 'public.delete_account_data(uuid)', 'EXECUTE') then
    failures := failures || 'service_role no puede ejecutar delete_account_data'::text;
  end if;
  if not has_function_privilege('service_role', 'public.block_user(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.unblock_user(uuid, uuid)', 'EXECUTE') then
    failures := failures || 'service_role no puede ejecutar block_user o unblock_user'::text;
  end if;

  if array_length(failures, 1) > 0 then
    raise exception 'FALLO P4: %', array_to_string(failures, '; ');
  end if;
  raise notice 'ok - P4: permisos de columna y de función como se esperaba (incluidos housing_preferences, compatibility_responses, rooms sin borrado de clientes, room_images, delete_own_room, is_room_publicly_visible, la lectura de anon por columnas en rooms, public_profile_previews sin privilegios de clientes, interests y matches solo escritos por el servidor, el chat de la Fase 6, los bloqueos y reportes de la sesión 83, la administración de la Fase 7 y la eliminación de cuentas)';
end $$;

-- ============================================================
-- P5 — Equivalente SQL de los lints de seguridad del Security Advisor
-- (el panel del Advisor se revisa además manualmente, ver docs)
-- ============================================================
do $$
declare
  definer_views text;
  unsafe_views text;
  mutable_fns text;
  rls_no_policy text;
begin
  -- security_definer_view: solo se acepta public_profile_previews (H3, ya conocido)
  select string_agg(c.relname, ', ') into definer_views
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false)
    and not coalesce(c.reloptions @> array['security_invoker=on'], false)
    and c.relname <> 'public_profile_previews';
  if definer_views is not null then
    raise exception 'FALLO P5: vistas SECURITY DEFINER no esperadas: %', definer_views;
  end if;

  -- Guardas generales de vistas (sesión 73, tras el hotfix 20261014120000),
  -- por privilegios EFECTIVOS (directos, heredados o de PUBLIC), de tabla o
  -- de columna, para PUBLIC, anon y authenticated:
  --   - ninguna vista ni vista materializada les da INSERT, UPDATE, DELETE
  --     ni TRUNCATE, aunque sea security_invoker = true (no se da por hecho
  --     que la RLS de la tabla de debajo lo cubre);
  --   - una vista security_invoker = false (también la aprobada) o una vista
  --     materializada (sin RLS) no les da ningún privilegio, ni SELECT.
  select string_agg(distinct format('%s (%s: %s)', c.relname, r.rol, p.priv), ', ')
    into unsafe_views
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['public', 'anon', 'authenticated']) r(rol)
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and (has_table_privilege(r.rol, c.oid, p.priv)
         or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
             and has_any_column_privilege(r.rol, c.oid, p.priv)))
    and (p.priv in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
         or c.relkind = 'm'
         or not coalesce((select bool_or(opt ~* '^security_invoker=(true|on|yes|1)$')
                          from unnest(c.reloptions) opt), false));
  if unsafe_views is not null then
    raise exception 'FALLO P5: vistas con privilegios de clientes indebidos: %', unsafe_views;
  end if;

  -- function_search_path_mutable: toda función PROPIA de public debe fijar
  -- search_path. Como en el linter de Supabase, se excluyen las funciones que
  -- pertenecen a una extensión (p. ej. pgcrypto, si estuviera en public).
  select string_agg(p.proname, ', ') into mutable_fns
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  if mutable_fns is not null then
    raise exception 'FALLO P5: funciones de public sin search_path fijo: %', mutable_fns;
  end if;

  -- rls_enabled_no_policy: tabla con RLS pero sin ninguna política
  select string_agg(t.tablename, ', ') into rls_no_policy
  from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename);
  if rls_no_policy is not null then
    raise exception 'FALLO P5: tablas con RLS y sin políticas: %', rls_no_policy;
  end if;

  raise notice 'P5 info - vista SECURITY DEFINER conocida y aceptada por ahora: public_profile_previews (H3), sin privilegios de clientes desde el hotfix 20261014120000 (P4)';
  raise notice 'ok - P5: sin lints de seguridad inesperados';
end $$;

-- ============================================================
-- P6 — Fases 2 y 3: triggers y funciones propias (conjunto exacto)
-- ============================================================
-- Derivado de supabase/migrations: triggers de 20260925120000 (updated_at,
-- rate limit), 20260926120000 (moderación), 20260929120000 (barrios),
-- 20260930120000 (onboarding), 20260930140000 (ciudad y universidad),
-- 20261007120000 (integridad de compatibility_responses, Fase 3.1) y
-- 20261024120000 (integridad de room_images, Fase 4.2) y 20261031120000
-- (fecha de publicación, sesión 71), y 20261126120000 (integridad de interests
-- y matches, Fase 5.1) y 20261127120000 (conversación de cada match e
-- integridad de messages, Fase 6) y 20261128120000 (bloqueos, registro y
-- límites de intereses e integridad de reports, sesión 83). Funciones: además, delete_own_room
-- (20261030120000, sesión 65), record_interest y withdraw_interest (Fase 5.1),
-- undo_match y room_interest_owner (Fase 6), SECURITY INVOKER.
-- Seguridad de funciones según cada migración: SECURITY DEFINER solo
-- is_admin, is_conversation_participant, enforce_neighborhood_not_referenced,
-- is_room_publicly_visible y, desde la Fase 6, las dos funciones de trigger de
-- messages (enforce_messages_integrity y touch_conversation_on_message, sin
-- EXECUTE de clientes); search_path fijo; EXECUTE revocado donde la
-- migración lo revoca.
do $$
declare
  missing text;
  unexpected text;
  failures text[] := '{}';
  fn record;
begin
  with expected(tablename, tgname, fn) as (values
    ('compatibility_responses', 'trg_compatibility_responses_integrity', 'enforce_compatibility_responses_integrity()'),
    ('compatibility_responses', 'trg_compatibility_responses_updated_at', 'set_updated_at()'),
    ('housing_preferences', 'trg_housing_preferences_city_required', 'enforce_housing_city_after_onboarding()'),
    ('housing_preferences', 'trg_housing_preferences_neighborhoods', 'enforce_housing_preferences_neighborhoods()'),
    ('housing_preferences', 'trg_housing_preferences_university', 'enforce_housing_preferences_university()'),
    ('housing_preferences', 'trg_housing_preferences_updated_at', 'set_updated_at()'),
    ('interests', 'trg_interests_abuse_limits', 'enforce_interests_abuse_limits()'),
    ('interests', 'trg_interests_integrity', 'enforce_interests_integrity()'),
    ('interests', 'trg_interests_log', 'log_interest()'),
    ('interests', 'trg_interests_rate_limit', 'enforce_interest_rate_limit()'),
    ('matches', 'trg_matches_close_conversation', 'close_match_conversation()'),
    ('matches', 'trg_matches_integrity', 'enforce_matches_integrity()'),
    ('matches', 'trg_matches_not_blocked', 'enforce_matches_not_blocked()'),
    ('matches', 'trg_matches_open_conversation', 'open_match_conversation()'),
    ('messages', 'trg_messages_integrity', 'enforce_messages_integrity()'),
    ('messages', 'trg_messages_touch_conversation', 'touch_conversation_on_message()'),
    ('neighborhoods', 'trg_neighborhoods_not_referenced', 'enforce_neighborhood_not_referenced()'),
    ('profiles', 'trg_profiles_onboarding_completion', 'enforce_onboarding_completion()'),
    ('profiles', 'trg_profiles_updated_at', 'set_updated_at()'),
    ('reports', 'trg_reports_integrity', 'enforce_reports_integrity()'),
    ('room_addresses', 'trg_room_addresses_updated_at', 'set_updated_at()'),
    ('room_images', 'trg_room_images_integrity', 'enforce_room_images_integrity()'),
    ('rooms', 'trg_rooms_moderation', 'enforce_room_moderation()'),
    ('rooms', 'trg_rooms_published_at', 'set_room_published_at()'),
    ('rooms', 'trg_rooms_updated_at', 'set_updated_at()'),
    ('admin_action_logs', 'trg_admin_action_logs_append_only', 'enforce_admin_action_logs_append_only()'),
    ('admin_action_logs', 'trg_admin_action_logs_no_truncate', 'enforce_admin_action_logs_append_only()')
  ),
  actual as (
    select c.relname::text as tablename, t.tgname::text as tgname,
           regexp_replace(t.tgfoid::regprocedure::text, '^public\.', '') as fn
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'D'
  ),
  all_actual as (
    select c.relname::text as tablename, t.tgname::text as tgname,
           regexp_replace(t.tgfoid::regprocedure::text, '^public\.', '') as fn
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  )
  select
    (select string_agg(format('%s.%s → %s', e.tablename, e.tgname, e.fn), ', ' order by e.tgname)
     from (select * from expected except select * from actual) e),
    (select string_agg(format('%s.%s → %s', a.tablename, a.tgname, a.fn), ', ' order by a.tgname)
     from (select * from all_actual except select * from expected) a)
  into missing, unexpected;
  if missing is not null or unexpected is not null then
    raise exception 'FALLO P6: triggers distintos de los esperados (o desactivados). Faltan: %. Sobran: %',
      coalesce(missing, 'ninguno'), coalesce(unexpected, 'ninguno');
  end if;

  -- Funciones propias de public (sin las de extensiones): firma, SECURITY
  -- DEFINER y search_path exactos.
  with expected(sig, secdef, search_path) as (values
    ('enforce_compatibility_responses_integrity()', false, 'search_path=""'),
    ('enforce_housing_city_after_onboarding()', false, 'search_path=""'),
    ('enforce_housing_preferences_neighborhoods()', false, 'search_path=""'),
    ('enforce_housing_preferences_university()', false, 'search_path=""'),
    ('enforce_interest_rate_limit()', false, 'search_path=public'),
    ('enforce_interests_integrity()', false, 'search_path=""'),
    ('enforce_matches_integrity()', false, 'search_path=""'),
    ('enforce_messages_integrity()', true, 'search_path=""'),
    ('touch_conversation_on_message()', true, 'search_path=""'),
    ('open_match_conversation()', false, 'search_path=""'),
    ('close_match_conversation()', false, 'search_path=""'),
    ('undo_match(uuid,uuid)', false, 'search_path=""'),
    ('room_interest_owner(uuid)', false, 'search_path=""'),
    ('enforce_interests_abuse_limits()', false, 'search_path=""'),
    ('log_interest()', false, 'search_path=""'),
    ('enforce_matches_not_blocked()', false, 'search_path=""'),
    ('enforce_reports_integrity()', true, 'search_path=""'),
    ('request_account_deletion(uuid)', true, 'search_path=""'),
    ('delete_account_data(uuid)', true, 'search_path=""'),
    ('complete_account_deletion(uuid)', true, 'search_path=""'),
    ('export_own_messages()', true, 'search_path=""'),
    ('block_user(uuid,uuid)', false, 'search_path=""'),
    ('unblock_user(uuid,uuid)', false, 'search_path=""'),
    ('purge_interest_log()', false, 'search_path=""'),
    ('purge_closed_conversation_messages(timestamp with time zone)', false, 'search_path=""'),
    ('enforce_neighborhood_not_referenced()', true, 'search_path=""'),
    ('enforce_onboarding_completion()', false, 'search_path=""'),
    ('enforce_room_images_integrity()', false, 'search_path=""'),
    ('enforce_room_moderation()', false, 'search_path=""'),
    ('is_admin()', true, 'search_path=public'),
    ('is_conversation_participant(uuid)', true, 'search_path=""'),
    ('is_room_publicly_visible(uuid)', true, 'search_path=""'),
    ('delete_own_room(uuid,uuid)', false, 'search_path=""'),
    ('record_interest(uuid,uuid,integer,uuid)', false, 'search_path=""'),
    ('withdraw_interest(uuid,uuid)', false, 'search_path=""'),
    ('set_room_published_at()', false, 'search_path=""'),
    ('set_updated_at()', false, 'search_path=public'),
    ('enforce_admin_action_logs_append_only()', false, 'search_path=""'),
    ('admin_require()', true, 'search_path=""'),
    ('admin_clean_reason(text,boolean)', false, 'search_path=""'),
    ('admin_log(uuid,text,text,uuid,text)', true, 'search_path=""'),
    ('admin_list_users(text,text,text,text,boolean,integer,integer)', true, 'search_path=""'),
    ('admin_get_user(uuid)', true, 'search_path=""'),
    ('admin_list_rooms(text,text,boolean,integer,integer)', true, 'search_path=""'),
    ('admin_get_room(uuid)', true, 'search_path=""'),
    ('admin_metrics()', true, 'search_path=""'),
    ('admin_suspend_user(uuid,text)', true, 'search_path=""'),
    ('admin_reactivate_user(uuid,text)', true, 'search_path=""'),
    ('admin_remove_room(uuid,text)', true, 'search_path=""'),
    ('admin_restore_room(uuid,text)', true, 'search_path=""'),
    ('admin_set_report_status(uuid,report_status,text,text)', true, 'search_path=""')
  ),
  actual as (
    select regexp_replace(p.oid::regprocedure::text, '^public\.', '') as sig,
           p.prosecdef as secdef,
           (select cfg from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%') as search_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  )
  select
    (select string_agg(format('%s (definer=%s, %s)', e.sig, e.secdef, e.search_path), ', ' order by e.sig)
     from (select * from expected except select * from actual) e),
    (select string_agg(format('%s (definer=%s, %s)', a.sig, a.secdef, a.search_path), ', ' order by a.sig)
     from (select * from actual except select * from expected) a)
  into missing, unexpected;
  if missing is not null or unexpected is not null then
    raise exception 'FALLO P6: funciones de public distintas de las esperadas. Faltan: %. Sobran: %',
      coalesce(missing, 'ninguna'), coalesce(unexpected, 'ninguna');
  end if;

  -- EXECUTE revocado según las migraciones.
  for fn in
    select * from (values
      ('public.enforce_compatibility_responses_integrity()', true),
      ('public.enforce_neighborhood_not_referenced()', true),
      ('public.enforce_onboarding_completion()', true),
      ('public.enforce_housing_city_after_onboarding()', true),
      ('public.enforce_housing_preferences_university()', true),
      ('public.enforce_housing_preferences_neighborhoods()', false),
      ('public.enforce_room_images_integrity()', true),
      ('public.delete_own_room(uuid, uuid)', true),
      ('public.enforce_interests_integrity()', true),
      ('public.enforce_matches_integrity()', true),
      ('public.record_interest(uuid, uuid, integer, uuid)', true),
      ('public.withdraw_interest(uuid, uuid)', true),
      ('public.enforce_messages_integrity()', true),
      ('public.touch_conversation_on_message()', true),
      ('public.open_match_conversation()', true),
      ('public.close_match_conversation()', true),
      ('public.undo_match(uuid, uuid)', true),
      ('public.room_interest_owner(uuid)', true),
      ('public.enforce_interests_abuse_limits()', true),
      ('public.log_interest()', true),
      ('public.enforce_matches_not_blocked()', true),
      ('public.enforce_reports_integrity()', true),
      ('public.block_user(uuid, uuid)', true),
      ('public.unblock_user(uuid, uuid)', true),
      ('public.purge_interest_log()', true),
      ('public.purge_closed_conversation_messages(timestamptz)', true),
      ('public.set_room_published_at()', true),
      ('public.enforce_admin_action_logs_append_only()', true),
      ('public.admin_require()', true),
      ('public.admin_clean_reason(text, boolean)', true),
      ('public.admin_log(uuid, text, text, uuid, text)', true),
      -- 20261201120000: la eliminación de cuentas, solo service_role; la
      -- exportación de los mensajes propios, también authenticated.
      ('public.request_account_deletion(uuid)', true),
      ('public.delete_account_data(uuid)', true),
      ('public.complete_account_deletion(uuid)', true),
      ('public.export_own_messages()', false),
      -- Fase 7: las funciones del panel las ejecuta authenticated (cada una
      -- comprueba is_admin()); anon y PUBLIC, nunca.
      ('public.admin_list_users(text, text, text, text, boolean, integer, integer)', false),
      ('public.admin_get_user(uuid)', false),
      ('public.admin_list_rooms(text, text, boolean, integer, integer)', false),
      ('public.admin_get_room(uuid)', false),
      ('public.admin_metrics()', false),
      ('public.admin_suspend_user(uuid, text)', false),
      ('public.admin_reactivate_user(uuid, text)', false),
      ('public.admin_remove_room(uuid, text)', false),
      ('public.admin_restore_room(uuid, text)', false),
      ('public.admin_set_report_status(uuid, public.report_status, text, text)', false)
    ) as v(sig, also_authenticated)
  loop
    if has_function_privilege('anon', fn.sig::regprocedure, 'EXECUTE') then
      failures := failures || format('anon puede ejecutar %s', fn.sig);
    end if;
    if fn.also_authenticated and has_function_privilege('authenticated', fn.sig::regprocedure, 'EXECUTE') then
      failures := failures || format('authenticated puede ejecutar %s', fn.sig);
    end if;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = fn.sig::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      failures := failures || format('PUBLIC puede ejecutar %s', fn.sig);
    end if;
  end loop;
  if array_length(failures, 1) > 0 then
    raise exception 'FALLO P6: %', array_to_string(failures, '; ');
  end if;

  raise notice 'ok - P6: 27 triggers activos, 51 funciones propias con la seguridad esperada, EXECUTE revocado donde toca';
end $$;
