-- Validación contra Supabase real — comprobaciones de infraestructura P1–P5.
-- Solo lectura de catálogo: no crea, modifica ni borra nada.
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
       '') <> 'roomly-validation' then
    raise exception 'FALLO P0: el destino NO está reconocido como roomly-validation (falta la marca de identidad o no coincide). Abortado.';
  end if;
  raise notice 'ok - P0: destino identificado como roomly-validation por su propia marca';
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
-- P3 — RLS activa en todas las tablas y número de políticas
-- ============================================================
do $$
declare
  no_rls text;
  n_policies int;
begin
  select string_agg(tablename, ', ') into no_rls
  from pg_tables where schemaname = 'public' and not rowsecurity;
  if no_rls is not null then
    raise exception 'FALLO P3: tablas de public sin RLS: %', no_rls;
  end if;

  select count(*) into n_policies from pg_policies where schemaname = 'public';
  if n_policies <> 35 then
    raise exception 'FALLO P3: se esperaban 35 políticas, hay %', n_policies;
  end if;

  raise notice 'ok - P3: RLS activa en las 18 tablas, 35 políticas';
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

  if array_length(failures, 1) > 0 then
    raise exception 'FALLO P4: %', array_to_string(failures, '; ');
  end if;
  raise notice 'ok - P4: permisos de columna y de función como se esperaba';
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
