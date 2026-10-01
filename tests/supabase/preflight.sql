-- Validación contra Supabase real — comprobaciones de infraestructura P0–P6.
-- Solo lectura de catálogo: no crea, modifica ni borra nada (ni tablas temporales).
-- Se ejecuta como el rol de conexión del proyecto (postgres). Cualquier
-- comprobación fallida lanza una excepción y psql termina con exit != 0.
-- Ver docs/SUPABASE_VALIDATION.md.

-- ============================================================
-- P0 — Identidad del proyecto (F1). Va primero: si la base de datos no
-- lleva la marca exacta, no se comprueba ni se ejecuta nada más.
-- (guard.sh ya lo verifica antes de conectar a nada destructivo; esto lo
-- repite dentro de la misma sesión que ejecuta preflight.)
-- ============================================================
do $$
begin
  if coalesce(
       (select shobj_description(d.oid, 'pg_database')
        from pg_database d where d.datname = current_database()),
       '') <> 'roomly-validation-2' then
    raise exception 'FALLO P0: el destino NO está reconocido como roomly-validation-2 (falta la marca de identidad o no coincide). Abortado.';
  end if;
  raise notice 'ok - P0: destino identificado como roomly-validation-2 por su propia marca';
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
  if not exists (select 1 from public.cities where slug = 'barcelona' and is_active) then
    raise exception 'FALLO P1: seed no aplicado (falta la ciudad barcelona activa)';
  end if;

  raise notice 'ok - P1: 18 tablas, funciones y trigger de la migración de seguridad presentes, seed aplicado';
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

  select r.rolbypassrls into owner_bypass from pg_roles r where r.oid = cp_owner::oid;
  raise notice 'P2 info - dueño de tablas y función: % (rolbypassrls=%)', cp_owner, owner_bypass;
  raise notice 'ok - P2: función y tabla con el mismo dueño, sin FORCE RLS, SECURITY DEFINER con search_path vacío';
end $$;

-- ============================================================
-- P3 — RLS activa en todas las tablas y conjunto EXACTO de políticas
-- ============================================================
-- Lista derivada de supabase/migrations (Fase 2.8): 35 de 20260925120100,
-- sustituciones sin cambio de número en 20260926120000, 20260929120000 y
-- 20260930140000, y en 20260930130000 `housing_preferences_own` pasa a ser
-- cuatro políticas (select/insert/update/delete_own). Total: 38 en 18 tablas.
-- Se compara (tabla, política, comando) en los dos sentidos: falta o sobra
-- cualquiera → fallo, con el nombre.
do $$
declare
  no_rls text;
  missing text;
  unexpected text;
  n_expected int;
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
    ('compatibility_responses', 'compatibility_responses_own', 'ALL'),
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
    ('profiles', 'profiles_select_authenticated', 'SELECT'),
    ('profiles', 'profiles_select_own_even_if_deleted', 'SELECT'),
    ('profiles', 'profiles_update_own', 'UPDATE'),
    ('reports', 'reports_admin_all', 'ALL'),
    ('reports', 'reports_insert_own', 'INSERT'),
    ('reports', 'reports_select_own', 'SELECT'),
    ('room_addresses', 'room_addresses_owner_only', 'ALL'),
    ('room_images', 'room_images_owner_write', 'ALL'),
    ('room_images', 'room_images_select', 'SELECT'),
    ('rooms', 'rooms_admin_all', 'ALL'),
    ('rooms', 'rooms_owner_write', 'ALL'),
    ('rooms', 'rooms_select_active_public', 'SELECT'),
    ('rooms', 'rooms_select_own', 'SELECT'),
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

  if n_expected <> 38 then
    raise exception 'FALLO P3: la lista esperada no tiene 38 entradas (error del propio preflight)';
  end if;
  if missing is not null or unexpected is not null then
    raise exception 'FALLO P3: políticas distintas de las esperadas. Faltan: %. Sobran: %',
      coalesce(missing, 'ninguna'), coalesce(unexpected, 'ninguna');
  end if;

  raise notice 'ok - P3: RLS activa en las 18 tablas y exactamente las 38 políticas esperadas';
end $$;

-- ============================================================
-- P4 — Permisos reales (privilegios por defecto de Supabase incluidos)
-- ============================================================
do $$
declare
  failures text[] := '{}';
  col text;
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

  if array_length(failures, 1) > 0 then
    raise exception 'FALLO P4: %', array_to_string(failures, '; ');
  end if;
  raise notice 'ok - P4: permisos de columna y de función como se esperaba (incluido housing_preferences)';
end $$;

-- ============================================================
-- P5 — Equivalente SQL de los lints de seguridad del Security Advisor
-- (el panel del Advisor se revisa además manualmente, ver docs)
-- ============================================================
do $$
declare
  definer_views text;
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

  raise notice 'P5 info - vista SECURITY DEFINER conocida y aceptada por ahora: public_profile_previews (H3)';
  raise notice 'ok - P5: sin lints de seguridad inesperados';
end $$;

-- ============================================================
-- P6 — Fase 2: triggers y funciones propias (conjunto exacto)
-- ============================================================
-- Derivado de supabase/migrations: triggers de 20260925120000 (updated_at,
-- rate limit), 20260926120000 (moderación), 20260929120000 (barrios),
-- 20260930120000 (onboarding) y 20260930140000 (ciudad y universidad).
-- Seguridad de funciones según cada migración: SECURITY DEFINER solo
-- is_admin, is_conversation_participant y enforce_neighborhood_not_referenced;
-- search_path fijo; EXECUTE revocado donde la migración lo revoca.
do $$
declare
  missing text;
  unexpected text;
  failures text[] := '{}';
  fn record;
begin
  with expected(tablename, tgname, fn) as (values
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
    ('rooms', 'trg_rooms_moderation', 'enforce_room_moderation()'),
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
    ('enforce_housing_city_after_onboarding()', false, 'search_path=""'),
    ('enforce_housing_preferences_neighborhoods()', false, 'search_path=""'),
    ('enforce_housing_preferences_university()', false, 'search_path=""'),
    ('enforce_interest_rate_limit()', false, 'search_path=public'),
    ('enforce_neighborhood_not_referenced()', true, 'search_path=""'),
    ('enforce_onboarding_completion()', false, 'search_path=""'),
    ('enforce_room_moderation()', false, 'search_path=""'),
    ('is_admin()', true, 'search_path=public'),
    ('is_conversation_participant(uuid)', true, 'search_path=""'),
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
      ('public.enforce_neighborhood_not_referenced()', true),
      ('public.enforce_onboarding_completion()', true),
      ('public.enforce_housing_city_after_onboarding()', true),
      ('public.enforce_housing_preferences_university()', true),
      ('public.enforce_housing_preferences_neighborhoods()', false)
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

  raise notice 'ok - P6: 12 triggers activos, 10 funciones propias con la seguridad esperada, EXECUTE revocado donde toca';
end $$;
