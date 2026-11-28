-- Sesión 88 (2026-11-28): eliminación de cuentas suspendidas.
--
-- Criterio del propietario (2026-11-28): la suspensión no puede ser una
-- barrera para pedir la eliminación de la cuenta. Ya no lo era
-- (request_account_deletion acepta cuentas con deleted_at, también las
-- suspendidas por un admin; lo fija tests/db/32). Esta migración cierra los
-- dos huecos de la interacción entre ambas:
--
--   1. admin_reactivate_user rechaza reactivar una cuenta con una
--      eliminación pedida y sin terminar (23514, admin_state): si un paso de
--      la eliminación falló, la cuenta debe seguir desactivada para poder
--      reanudarla (delete_account_data exige deleted_at).
--   2. admin_get_user devuelve deletion_requested_at para que el panel lo
--      muestre y no ofrezca reactivarla.
--
-- Qué se conserva de una cuenta suspendida que se elimina (el registro de
-- la suspensión en admin_action_logs y los reportes, con el UUID como
-- seudónimo) y lo que requiere revisión legal: docs/PRIVACY_RETENTION.md,
-- sección 3. No cambia ninguna retención real ni borra nada.
--
-- Misma firma, SECURITY DEFINER y search_path de antes; los GRANT se
-- conservan con create or replace (EXECUTE solo de authenticated).

create or replace function public.admin_get_user(p_user_id uuid)
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
    -- Sesión 88: eliminación de la cuenta pedida y sin terminar.
    'deletion_requested_at', (
      select d.requested_at from public.account_deletion_requests d
      where d.user_id = v_profile.id and d.completed_at is null
    ),
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
        left join public.profiles a on a.id = l.admin_id
        where l.target_type = 'user' and l.target_id = v_profile.id
        order by l.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_reactivate_user(p_user_id uuid, p_reason text)
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
  -- Sesión 88: una cuenta con la eliminación pedida no se reactiva (la
  -- eliminación exige la cuenta desactivada y se puede reanudar).
  if exists (
    select 1 from public.account_deletion_requests d
    where d.user_id = v_profile.id and d.completed_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'admin_state: la cuenta tiene una eliminación pendiente';
  end if;
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
