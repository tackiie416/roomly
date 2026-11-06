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
  if n_tables <> 18 then
    raise exception 'FALLO P1: se esperaban 18 tablas en public, hay %', n_tables;
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
-- authenticated): −1 +2. Total: 42 en 18 tablas.
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
    ('admin_action_logs', 'admin_action_logs_admin_only', 'ALL'),
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
    ('interests', 'interests_delete_own', 'DELETE'),
    ('interests', 'interests_insert_own', 'INSERT'),
    ('interests', 'interests_select_participant', 'SELECT'),
    ('matches', 'matches_select_participant', 'SELECT'),
    ('messages', 'messages_insert_participant', 'INSERT'),
    ('messages', 'messages_select_participant', 'SELECT'),
    ('neighborhoods', 'neighborhoods_admin_write', 'ALL'),
    ('neighborhoods', 'neighborhoods_select_all', 'SELECT'),
    ('notifications', 'notifications_own', 'ALL'),
    ('profiles', 'profiles_admin_all', 'ALL'),
    ('profiles', 'profiles_insert_own', 'INSERT'),
    ('profiles', 'profiles_select_own_even_if_deleted', 'SELECT'),
    ('profiles', 'profiles_update_own', 'UPDATE'),
    ('reports', 'reports_admin_all', 'ALL'),
    ('reports', 'reports_insert_own', 'INSERT'),
    ('reports', 'reports_select_own', 'SELECT'),
    ('room_addresses', 'room_addresses_delete_own', 'DELETE'),
    ('room_addresses', 'room_addresses_insert_own', 'INSERT'),
    ('room_addresses', 'room_addresses_select_own', 'SELECT'),
    ('room_addresses', 'room_addresses_update_own', 'UPDATE'),
    ('room_images', 'room_images_admin_select', 'SELECT'),
    ('room_images', 'room_images_select_own', 'SELECT'),
    ('room_images', 'room_images_select_public', 'SELECT'),
    ('rooms', 'rooms_admin_all', 'ALL'),
    ('rooms', 'rooms_insert_own', 'INSERT'),
    ('rooms', 'rooms_select_active_public', 'SELECT'),
    ('rooms', 'rooms_select_own', 'SELECT'),
    ('rooms', 'rooms_update_own', 'UPDATE'),
    ('universities', 'universities_admin_write', 'ALL'),
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

  if n_expected <> 42 then
    raise exception 'FALLO P3: la lista esperada no tiene 42 entradas (error del propio preflight)';
  end if;
  if missing is not null or unexpected is not null then
    raise exception 'FALLO P3: políticas distintas de las esperadas. Faltan: %. Sobran: %',
      coalesce(missing, 'ninguna'), coalesce(unexpected, 'ninguna');
  end if;

  -- Fase 4.0: WITH CHECK en INSERT, USING y WITH CHECK en UPDATE, USING en
  -- DELETE. `rooms_admin_all` (ALL) no entra: es la capacidad del admin.
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

  raise notice 'ok - P3: RLS activa en las 18 tablas, exactamente las 42 políticas esperadas, las escrituras de habitaciones exigen cuenta activa, la lectura pública de habitaciones y fotos aplica R7, storage.objects y storage.buckets tienen la RLS activa, storage.objects no tiene políticas y storage.buckets ninguna de escritura';
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

  if array_length(failures, 1) > 0 then
    raise exception 'FALLO P4: %', array_to_string(failures, '; ');
  end if;
  raise notice 'ok - P4: permisos de columna y de función como se esperaba (incluidos housing_preferences, compatibility_responses, rooms sin borrado de clientes, room_images, delete_own_room, is_room_publicly_visible, la lectura de anon por columnas en rooms y public_profile_previews sin privilegios de clientes)';
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
-- (fecha de publicación, sesión 71). Funciones: además, delete_own_room
-- (20261030120000, sesión 65), SECURITY INVOKER.
-- Seguridad de funciones según cada migración: SECURITY DEFINER solo
-- is_admin, is_conversation_participant, enforce_neighborhood_not_referenced
-- e is_room_publicly_visible; search_path fijo; EXECUTE revocado donde la
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
    ('interests', 'trg_interests_rate_limit', 'enforce_interest_rate_limit()'),
    ('neighborhoods', 'trg_neighborhoods_not_referenced', 'enforce_neighborhood_not_referenced()'),
    ('profiles', 'trg_profiles_onboarding_completion', 'enforce_onboarding_completion()'),
    ('profiles', 'trg_profiles_updated_at', 'set_updated_at()'),
    ('room_addresses', 'trg_room_addresses_updated_at', 'set_updated_at()'),
    ('room_images', 'trg_room_images_integrity', 'enforce_room_images_integrity()'),
    ('rooms', 'trg_rooms_moderation', 'enforce_room_moderation()'),
    ('rooms', 'trg_rooms_published_at', 'set_room_published_at()'),
    ('rooms', 'trg_rooms_updated_at', 'set_updated_at()')
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
    ('enforce_neighborhood_not_referenced()', true, 'search_path=""'),
    ('enforce_onboarding_completion()', false, 'search_path=""'),
    ('enforce_room_images_integrity()', false, 'search_path=""'),
    ('enforce_room_moderation()', false, 'search_path=""'),
    ('is_admin()', true, 'search_path=public'),
    ('is_conversation_participant(uuid)', true, 'search_path=""'),
    ('is_room_publicly_visible(uuid)', true, 'search_path=""'),
    ('delete_own_room(uuid,uuid)', false, 'search_path=""'),
    ('set_room_published_at()', false, 'search_path=""'),
    ('set_updated_at()', false, 'search_path=public')
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
      ('public.set_room_published_at()', true)
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

  raise notice 'ok - P6: 15 triggers activos, 15 funciones propias con la seguridad esperada, EXECUTE revocado donde toca';
end $$;
