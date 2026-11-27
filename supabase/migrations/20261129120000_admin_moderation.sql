-- ============================================================
-- Fase 7 (sesión 84): administración y moderación.
-- ============================================================
-- Objetivo: que un admin pueda consultar usuarios, habitaciones y reportes,
-- suspender y reactivar cuentas, retirar y restaurar anuncios y resolver
-- reportes, con auditoría completa, y que nadie más pueda hacerlo.
--
-- 1. Las políticas de admin pasan a ser SOLO DE LECTURA.
--    profiles_admin_all, rooms_admin_all y reports_admin_all eran FOR ALL:
--    con el GRANT por columnas de authenticated, un admin podía, desde el
--    cliente y sin dejar rastro, editar el nombre o la bio de cualquiera,
--    cambiar el título, el precio o el estado de cualquier habitación,
--    crear reportes en nombre de otra persona (reports_admin_all permitía el
--    INSERT con cualquier reporter_id) y BORRAR perfiles (authenticated tenía
--    DELETE en profiles por los privilegios por defecto; el borrado arrastra
--    en cascada habitaciones, matches y mensajes). Ahora cada una es
--    `<tabla>_admin_select` (SELECT, authenticated, is_admin()).
--    admin_action_logs_admin_only (FOR ALL) pasa a admin_action_logs_admin_select.
-- 2. Privilegios: authenticated pierde el UPDATE de reports (20261128120000)
--    y el INSERT de admin_action_logs; anon y authenticated pierden DELETE y
--    TRUNCATE de profiles (ningún cliente borra perfiles: H6 está fuera de
--    alcance y la app nunca lo ha hecho).
-- 3. admin_action_logs: catálogo cerrado de acciones y tipos, notas acotadas
--    y un trigger que impide UPDATE, DELETE y TRUNCATE a TODOS los roles
--    (también service_role y el dueño de la tabla). Solo lo escriben las
--    funciones de moderación, en la misma transacción que la acción.
-- 4. Funciones de admin (SECURITY DEFINER, search_path vacío, EXECUTE solo
--    de authenticated; anon, PUBLIC y service_role, nada). Cada una empieza
--    comprobando public.is_admin() con el JWT de la petición (auth.uid()):
--    la autorización la decide la base de datos, no el servidor. Por eso no
--    usan service_role: un fallo del servidor no basta para actuar como
--    admin sin la sesión de un admin activo.
--      lectura:  admin_list_users, admin_get_user, admin_list_rooms,
--                admin_get_room, admin_metrics;
--      escritura (con auditoría atómica): admin_suspend_user,
--                admin_reactivate_user, admin_remove_room,
--                admin_restore_room, admin_set_report_status.
--    Solo devuelven las columnas que necesita el panel: nunca el email, la
--    fecha de nacimiento, los presupuestos, las respuestas del test, la
--    dirección ni el contenido de los mensajes.
--
-- Suspender = poner profiles.deleted_at (la «cuenta desactivada» que ya
-- respetan la RLS, los triggers y el routing desde la Fase 2). Reactivar solo
-- deshace una suspensión de admin (la última acción registrada sobre esa
-- cuenta es user_suspended), nunca otra desactivación. Un admin no se
-- suspende a sí mismo ni a otro admin: los roles siguen cambiándose solo con
-- service_role.
-- Retirar un anuncio = status 'removed' (H5: solo un admin). Restaurar lo
-- deja en 'paused': la propietaria decide si lo vuelve a publicar, y al
-- publicarlo pasa otra vez por chk_rooms_publishable.
--
-- Errores (el mensaje empieza por un prefijo estable; nunca llega al usuario):
--   42501 admin_forbidden: quien llama no es un admin activo;
--   P0002 admin_not_found: el objetivo no existe;
--   22023 admin_invalid: entrada fuera de rango (motivo, filtros, estado);
--   23514 admin_state: la acción no tiene sentido en el estado actual
--         (ya suspendida, admin, la propia cuenta, ya retirada...);
--   23505 (uq_reports_open_*): reabrir un reporte con otro abierto igual.

-- ------------------------------------------------------------
-- 1. Políticas de admin: solo lectura
-- ------------------------------------------------------------
drop policy "profiles_admin_all" on public.profiles;
create policy profiles_admin_select on public.profiles
  for select to authenticated
  using (public.is_admin());

drop policy "rooms_admin_all" on public.rooms;
create policy rooms_admin_select on public.rooms
  for select to authenticated
  using (public.is_admin());

drop policy "reports_admin_all" on public.reports;
create policy reports_admin_select on public.reports
  for select to authenticated
  using (public.is_admin());

drop policy "admin_action_logs_admin_only" on public.admin_action_logs;
create policy admin_action_logs_admin_select on public.admin_action_logs
  for select to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 2. Privilegios
-- ------------------------------------------------------------
revoke update on public.reports from public, anon, authenticated;
revoke insert, update, delete, truncate on public.admin_action_logs
  from public, anon, authenticated;
revoke delete, truncate on public.profiles from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. admin_action_logs: catálogo y solo añadir
-- ------------------------------------------------------------
alter table public.admin_action_logs
  add constraint chk_admin_action_logs_action check (action in (
    'report_in_review', 'report_resolved', 'report_dismissed', 'report_reopened',
    'user_suspended', 'user_reactivated', 'room_removed', 'room_restored'
  )),
  add constraint chk_admin_action_logs_target_type check (
    target_type in ('report', 'user', 'room')
  ),
  add constraint chk_admin_action_logs_target_id check (target_id is not null),
  add constraint chk_admin_action_logs_notes_length check (
    notes is null or char_length(notes) <= 2000
  );

create index idx_admin_action_logs_target
  on public.admin_action_logs(target_type, target_id, created_at desc);
create index idx_admin_action_logs_created on public.admin_action_logs(created_at desc);

create function public.enforce_admin_action_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'admin_log_immutable: el registro de administración solo admite añadir';
end;
$$;

revoke all on function public.enforce_admin_action_logs_append_only()
  from public, anon, authenticated, service_role;

create trigger trg_admin_action_logs_append_only
  before update or delete on public.admin_action_logs
  for each row execute function public.enforce_admin_action_logs_append_only();
create trigger trg_admin_action_logs_no_truncate
  before truncate on public.admin_action_logs
  for each statement execute function public.enforce_admin_action_logs_append_only();

-- Índices para los filtros del panel.
create index idx_reports_reported_user on public.reports(reported_user_id)
  where reported_user_id is not null;
create index idx_reports_reported_room on public.reports(reported_room_id)
  where reported_room_id is not null;
create index idx_profiles_created on public.profiles(created_at desc, id);
create index idx_rooms_created on public.rooms(created_at desc, id);

-- ------------------------------------------------------------
-- 4. Utilidades internas (sin EXECUTE de clientes)
-- ------------------------------------------------------------
-- Exige un admin activo; devuelve su id.
create function public.admin_require()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'admin_forbidden: se necesita una cuenta de administración activa';
  end if;
  return auth.uid();
end;
$$;

-- Motivo obligatorio de una acción: 3–1000 caracteres tras recortar.
create function public.admin_clean_reason(p_reason text, p_required boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v is null then
    if p_required then
      raise exception using errcode = '22023', message = 'admin_invalid: falta el motivo';
    end if;
    return null;
  end if;
  if char_length(v) < 3 or char_length(v) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'admin_invalid: el motivo debe tener entre 3 y 1000 caracteres';
  end if;
  return v;
end;
$$;

create function public.admin_log(
  p_admin uuid, p_action text, p_target_type text, p_target_id uuid, p_notes text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_action_logs (admin_id, action, target_type, target_id, notes)
  values (p_admin, p_action, p_target_type, p_target_id, p_notes);
$$;

revoke all on function public.admin_require() from public, anon, authenticated, service_role;
revoke all on function public.admin_clean_reason(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_log(uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Lectura
-- ------------------------------------------------------------
-- Usuarios, con filtros. p_status: all | active | suspended;
-- p_role: all | user | admin; p_onboarding: all | complete | incomplete;
-- p_reported: solo cuentas con reportes abiertos. Búsqueda por nombre sin
-- comodines (position, no LIKE). Orden: más recientes primero.
create function public.admin_list_users(
  p_search text default null,
  p_status text default 'all',
  p_role text default 'all',
  p_onboarding text default 'all',
  p_reported boolean default false,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  role public.user_role,
  seeking_status public.seeking_status,
  created_at timestamptz,
  onboarding_completed_at timestamptz,
  deleted_at timestamptz,
  open_reports integer,
  rooms_count integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  perform public.admin_require();
  if p_status not in ('all', 'active', 'suspended')
     or p_role not in ('all', 'user', 'admin')
     or p_onboarding not in ('all', 'complete', 'incomplete')
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 10000
     or char_length(coalesce(v_search, '')) > 100 then
    raise exception using errcode = '22023', message = 'admin_invalid: filtros no válidos';
  end if;

  return query
  select p.id, p.full_name, p.role, p.seeking_status, p.created_at,
         p.onboarding_completed_at, p.deleted_at,
         coalesce(rep.n, 0)::int, coalesce(rm.n, 0)::int,
         count(*) over ()
  from public.profiles p
  left join lateral (
    select count(*) as n from public.reports r
    where r.reported_user_id = p.id and r.status in ('pending', 'in_review')
  ) rep on true
  left join lateral (
    select count(*) as n from public.rooms o where o.owner_id = p.id
  ) rm on true
  where (v_search is null or position(v_search in lower(p.full_name)) > 0)
    and (p_status = 'all'
         or (p_status = 'active' and p.deleted_at is null)
         or (p_status = 'suspended' and p.deleted_at is not null))
    and (p_role = 'all' or p.role::text = p_role)
    and (p_onboarding = 'all'
         or (p_onboarding = 'complete' and p.onboarding_completed_at is not null)
         or (p_onboarding = 'incomplete' and p.onboarding_completed_at is null))
    and (not coalesce(p_reported, false) or coalesce(rep.n, 0) > 0)
  order by p.created_at desc, p.id
  limit p_limit offset p_offset;
end;
$$;

-- Ficha de una cuenta: datos de perfil necesarios para moderar (sin email,
-- fecha de nacimiento ni preferencias), sus habitaciones, los reportes que ha
-- recibido y hecho (los 20 últimos), cuántas veces la han bloqueado (solo el
-- número: nunca quién) y el historial de administración sobre ella.
create function public.admin_get_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_last_action text;
begin
  perform public.admin_require();
  select * into v_profile from public.profiles p where p.id = p_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found: la cuenta no existe';
  end if;
  select l.action into v_last_action
  from public.admin_action_logs l
  where l.target_type = 'user' and l.target_id = p_user_id
    and l.action in ('user_suspended', 'user_reactivated')
  order by l.created_at desc, l.id desc
  limit 1;

  return jsonb_build_object(
    'id', v_profile.id,
    'full_name', v_profile.full_name,
    'bio', v_profile.bio,
    'role', v_profile.role,
    'seeking_status', v_profile.seeking_status,
    'created_at', v_profile.created_at,
    'onboarding_completed_at', v_profile.onboarding_completed_at,
    'deleted_at', v_profile.deleted_at,
    'suspended_by_admin', v_profile.deleted_at is not null
                          and v_last_action is not distinct from 'user_suspended',
    'has_questionnaire', exists (
      select 1 from public.compatibility_responses c where c.profile_id = v_profile.id
    ),
    'matches_count', (
      select count(*) from public.matches m
      where m.user_a_id = v_profile.id or m.user_b_id = v_profile.id
    ),
    'blocked_by_count', (
      select count(*) from public.user_blocks b where b.blocked_id = v_profile.id
    ),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'title', o.title, 'status', o.status, 'created_at', o.created_at
             ) order by o.created_at desc)
      from public.rooms o where o.owner_id = v_profile.id
    ), '[]'::jsonb),
    'reports_received', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select r.created_at, jsonb_build_object(
                 'id', r.id, 'reason', r.reason, 'status', r.status,
                 'created_at', r.created_at, 'room_id', r.reported_room_id
               ) as j
        from public.reports r
        where r.reported_user_id = v_profile.id
           or r.reported_room_id in (select o.id from public.rooms o where o.owner_id = v_profile.id)
        order by r.created_at desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'reports_made_count', (
      select count(*) from public.reports r where r.reporter_id = v_profile.id
    ),
    'history', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select l.created_at, jsonb_build_object(
                 'action', l.action, 'notes', l.notes, 'created_at', l.created_at,
                 'admin_name', a.full_name
               ) as j
        from public.admin_action_logs l
        join public.profiles a on a.id = l.admin_id
        where l.target_type = 'user' and l.target_id = v_profile.id
        order by l.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- Habitaciones, con filtros. p_status: all o un room_status; p_reported:
-- solo las que tienen reportes abiertos.
create function public.admin_list_rooms(
  p_search text default null,
  p_status text default 'all',
  p_reported boolean default false,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  status public.room_status,
  city_name text,
  neighborhood_name text,
  price_month integer,
  owner_id uuid,
  owner_name text,
  owner_deactivated boolean,
  created_at timestamptz,
  published_at timestamptz,
  open_reports integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  perform public.admin_require();
  if p_status not in ('all', 'draft', 'active', 'paused', 'rented', 'removed')
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 10000
     or char_length(coalesce(v_search, '')) > 100 then
    raise exception using errcode = '22023', message = 'admin_invalid: filtros no válidos';
  end if;

  return query
  select o.id, o.title, o.status, c.name, n.name, o.price_month,
         o.owner_id, p.full_name, p.deleted_at is not null,
         o.created_at, o.published_at,
         coalesce(rep.n, 0)::int,
         count(*) over ()
  from public.rooms o
  join public.profiles p on p.id = o.owner_id
  left join public.cities c on c.id = o.city_id
  left join public.neighborhoods n on n.id = o.neighborhood_id
  left join lateral (
    select count(*) as n from public.reports r
    where r.reported_room_id = o.id and r.status in ('pending', 'in_review')
  ) rep on true
  where (v_search is null or position(v_search in lower(o.title)) > 0)
    and (p_status = 'all' or o.status::text = p_status)
    and (not coalesce(p_reported, false) or coalesce(rep.n, 0) > 0)
  order by o.created_at desc, o.id
  limit p_limit offset p_offset;
end;
$$;

-- Ficha de una habitación: lo que se ve en el anuncio más el estado interno
-- (nunca la dirección exacta ni approx_*), su propietaria, reportes e
-- historial.
create function public.admin_get_room(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  perform public.admin_require();
  select * into v_room from public.rooms o where o.id = p_room_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found: la habitación no existe';
  end if;

  return jsonb_build_object(
    'id', v_room.id,
    'title', v_room.title,
    'description', v_room.description,
    'status', v_room.status,
    'price_month', v_room.price_month,
    'city_name', (select c.name from public.cities c where c.id = v_room.city_id),
    'neighborhood_name', (select n.name from public.neighborhoods n where n.id = v_room.neighborhood_id),
    'house_rules', v_room.house_rules,
    'roommate_preferences', v_room.roommate_preferences,
    'created_at', v_room.created_at,
    'updated_at', v_room.updated_at,
    'published_at', v_room.published_at,
    'images_count', (select count(*) from public.room_images i where i.room_id = v_room.id),
    'owner', (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name,
                                'deactivated', p.deleted_at is not null)
      from public.profiles p where p.id = v_room.owner_id
    ),
    'reports', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select r.created_at, jsonb_build_object(
                 'id', r.id, 'reason', r.reason, 'status', r.status,
                 'description', r.description, 'created_at', r.created_at
               ) as j
        from public.reports r
        where r.reported_room_id = v_room.id
        order by r.created_at desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select l.created_at, jsonb_build_object(
                 'action', l.action, 'notes', l.notes, 'created_at', l.created_at,
                 'admin_name', a.full_name
               ) as j
        from public.admin_action_logs l
        join public.profiles a on a.id = l.admin_id
        where l.target_type = 'room' and l.target_id = v_room.id
        order by l.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- Métricas agregadas (solo totales y recuentos por periodo): ninguna fila
-- de una persona concreta, ningún contenido de mensajes.
create function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_require();
  return jsonb_build_object(
    'generated_at', now(),
    'users', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where p.deleted_at is null),
        'suspended', count(*) filter (where p.deleted_at is not null),
        'admins', count(*) filter (where p.role = 'admin'),
        'onboarding_complete', count(*) filter (where p.onboarding_completed_at is not null),
        'new_7d', count(*) filter (where p.created_at > now() - interval '7 days'),
        'new_30d', count(*) filter (where p.created_at > now() - interval '30 days')
      ) from public.profiles p
    ),
    'questionnaires', (select count(*) from public.compatibility_responses),
    'rooms', (
      select jsonb_build_object(
        'total', count(*),
        'draft', count(*) filter (where o.status = 'draft'),
        'active', count(*) filter (where o.status = 'active'),
        'paused', count(*) filter (where o.status = 'paused'),
        'rented', count(*) filter (where o.status = 'rented'),
        'removed', count(*) filter (where o.status = 'removed'),
        'published_7d', count(*) filter (where o.published_at > now() - interval '7 days')
      ) from public.rooms o
    ),
    'interests', (
      select jsonb_build_object(
        'total', count(*),
        'last_7d', count(*) filter (where i.created_at > now() - interval '7 days'),
        'with_room', count(*) filter (where i.room_id is not null)
      ) from public.interests i
    ),
    'matches', (
      select jsonb_build_object(
        'total', count(*),
        'last_7d', count(*) filter (where m.created_at > now() - interval '7 days')
      ) from public.matches m
    ),
    'conversations', (
      select jsonb_build_object(
        'open', count(*) filter (where c.closed_at is null),
        'closed', count(*) filter (where c.closed_at is not null),
        'active_7d', count(*) filter (where c.last_message_at > now() - interval '7 days')
      ) from public.conversations c
    ),
    'messages', (
      select jsonb_build_object(
        'last_7d', count(*) filter (where ms.created_at > now() - interval '7 days'),
        'last_30d', count(*) filter (where ms.created_at > now() - interval '30 days')
      ) from public.messages ms
    ),
    'blocks', (select count(*) from public.user_blocks),
    'reports', (
      select jsonb_build_object(
        'pending', count(*) filter (where r.status = 'pending'),
        'in_review', count(*) filter (where r.status = 'in_review'),
        'resolved', count(*) filter (where r.status = 'resolved'),
        'dismissed', count(*) filter (where r.status = 'dismissed'),
        'last_7d', count(*) filter (where r.created_at > now() - interval '7 days'),
        'avg_hours_to_close_30d', round((extract(epoch from avg(r.resolved_at - r.created_at)
          filter (where r.resolved_at > now() - interval '30 days')) / 3600)::numeric, 1)
      ) from public.reports r
    ),
    'admin_actions_7d', (
      select count(*) from public.admin_action_logs l
      where l.created_at > now() - interval '7 days'
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. Escritura (cada acción y su registro, en la misma transacción)
-- ------------------------------------------------------------
create function public.admin_suspend_user(p_user_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.admin_require();
  v_reason text := public.admin_clean_reason(p_reason, true);
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found: la cuenta no existe';
  end if;
  if v_profile.id = v_admin then
    raise exception using errcode = '23514', message = 'admin_state: no puedes suspender tu propia cuenta';
  end if;
  if v_profile.role = 'admin' then
    raise exception using errcode = '23514', message = 'admin_state: no se suspende a otra cuenta de administración';
  end if;
  if v_profile.deleted_at is not null then
    raise exception using errcode = '23514', message = 'admin_state: la cuenta ya está desactivada';
  end if;

  update public.profiles set deleted_at = now() where id = v_profile.id;
  perform public.admin_log(v_admin, 'user_suspended', 'user', v_profile.id, v_reason);
  return 'suspended';
end;
$$;

create function public.admin_reactivate_user(p_user_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.admin_require();
  v_reason text := public.admin_clean_reason(p_reason, true);
  v_profile public.profiles%rowtype;
  v_last_action text;
begin
  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found: la cuenta no existe';
  end if;
  if v_profile.deleted_at is null then
    raise exception using errcode = '23514', message = 'admin_state: la cuenta ya está activa';
  end if;
  select l.action into v_last_action
  from public.admin_action_logs l
  where l.target_type = 'user' and l.target_id = v_profile.id
    and l.action in ('user_suspended', 'user_reactivated')
  order by l.created_at desc, l.id desc
  limit 1;
  if v_last_action is distinct from 'user_suspended' then
    raise exception using
      errcode = '23514',
      message = 'admin_state: solo se reactiva una cuenta suspendida por administración';
  end if;

  update public.profiles set deleted_at = null where id = v_profile.id;
  perform public.admin_log(v_admin, 'user_reactivated', 'user', v_profile.id, v_reason);
  return 'reactivated';
end;
$$;

create function public.admin_remove_room(p_room_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.admin_require();
  v_reason text := public.admin_clean_reason(p_reason, true);
  v_status public.room_status;
begin
  select o.status into v_status from public.rooms o where o.id = p_room_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found: la habitación no existe';
  end if;
  if v_status = 'removed' then
    raise exception using errcode = '23514', message = 'admin_state: la habitación ya está retirada';
  end if;

  update public.rooms set status = 'removed' where id = p_room_id;
  perform public.admin_log(v_admin, 'room_removed', 'room', p_room_id,
                           v_reason || ' [antes: ' || v_status::text || ']');
  return 'removed';
end;
$$;

create function public.admin_restore_room(p_room_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.admin_require();
  v_reason text := public.admin_clean_reason(p_reason, true);
  v_status public.room_status;
begin
  select o.status into v_status from public.rooms o where o.id = p_room_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found: la habitación no existe';
  end if;
  if v_status <> 'removed' then
    raise exception using errcode = '23514', message = 'admin_state: la habitación no está retirada';
  end if;

  update public.rooms set status = 'paused' where id = p_room_id;
  perform public.admin_log(v_admin, 'room_restored', 'room', p_room_id, v_reason);
  return 'paused';
end;
$$;

-- Estado de un reporte. Transiciones: pendiente → en revisión, resuelto o
-- descartado; en revisión → resuelto o descartado; resuelto o descartado →
-- en revisión (reabrir). Cerrar y reabrir exigen motivo. Con 'resolved' se
-- puede aplicar a la vez una medida sobre el objetivo del reporte
-- (p_measure: none | suspend_user | remove_room), con su propio registro.
create function public.admin_set_report_status(
  p_report_id uuid,
  p_status public.report_status,
  p_notes text,
  p_measure text default 'none'
)
returns public.report_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.admin_require();
  v_report public.reports%rowtype;
  v_notes text;
  v_action text;
begin
  if p_status is null or p_measure is null
     or p_measure not in ('none', 'suspend_user', 'remove_room') then
    raise exception using errcode = '22023', message = 'admin_invalid: estado o medida no válidos';
  end if;
  select * into v_report from public.reports r where r.id = p_report_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found: el reporte no existe';
  end if;

  if v_report.status = p_status
     or p_status = 'pending'
     or (v_report.status in ('resolved', 'dismissed') and p_status <> 'in_review') then
    raise exception using errcode = '23514', message = 'admin_state: cambio de estado no permitido';
  end if;
  if p_measure <> 'none' and p_status <> 'resolved' then
    raise exception using errcode = '23514', message = 'admin_state: las medidas solo se aplican al resolver';
  end if;
  if (p_measure = 'suspend_user' and v_report.reported_user_id is null)
     or (p_measure = 'remove_room' and v_report.reported_room_id is null) then
    raise exception using errcode = '23514', message = 'admin_state: la medida no corresponde al reporte';
  end if;

  v_notes := public.admin_clean_reason(
    p_notes, p_status in ('resolved', 'dismissed') or v_report.status in ('resolved', 'dismissed')
  );
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception using errcode = '22023', message = 'admin_invalid: notas demasiado largas';
  end if;

  v_action := case
    when v_report.status in ('resolved', 'dismissed') then 'report_reopened'
    else 'report_' || p_status::text
  end;

  update public.reports
  set status = p_status,
      resolution_notes = coalesce(v_notes, resolution_notes)
  where id = v_report.id;
  perform public.admin_log(v_admin, v_action, 'report', v_report.id, v_notes);

  if p_measure = 'suspend_user' then
    perform public.admin_suspend_user(v_report.reported_user_id,
                                      coalesce(v_notes, 'Medida del reporte ' || v_report.id::text));
  elsif p_measure = 'remove_room' then
    perform public.admin_remove_room(v_report.reported_room_id,
                                     coalesce(v_notes, 'Medida del reporte ' || v_report.id::text));
  end if;
  return p_status;
end;
$$;

-- ------------------------------------------------------------
-- 7. EXECUTE: solo authenticated (cada función comprueba is_admin())
-- ------------------------------------------------------------
revoke all on function public.admin_list_users(text, text, text, text, boolean, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_user(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_rooms(text, text, boolean, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_room(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_metrics() from public, anon, authenticated, service_role;
revoke all on function public.admin_suspend_user(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_reactivate_user(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_remove_room(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_restore_room(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_report_status(uuid, public.report_status, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_users(text, text, text, text, boolean, integer, integer)
  to authenticated;
grant execute on function public.admin_get_user(uuid) to authenticated;
grant execute on function public.admin_list_rooms(text, text, boolean, integer, integer)
  to authenticated;
grant execute on function public.admin_get_room(uuid) to authenticated;
grant execute on function public.admin_metrics() to authenticated;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated;
grant execute on function public.admin_reactivate_user(uuid, text) to authenticated;
grant execute on function public.admin_remove_room(uuid, text) to authenticated;
grant execute on function public.admin_restore_room(uuid, text) to authenticated;
grant execute on function public.admin_set_report_status(uuid, public.report_status, text, text)
  to authenticated;
