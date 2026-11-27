-- ============================================================
-- Auditoría con actor seudónimo (sesión 85, en local; sin aplicar en ningún
-- proyecto real)
-- ============================================================
-- Decisión del propietario (2026-11-27): el registro de administración se
-- mantiene íntegro e inmutable, pero haber actuado como admin no puede
-- bloquear por sí solo el borrado futuro de esa cuenta (H6).
--
-- Hasta ahora `admin_action_logs.admin_id` y `reports.resolved_by` eran FK a
-- `profiles` sin cascada: un perfil con acciones o resoluciones no se podía
-- borrar (23503). Ninguna acción de cascada sirve: `set null` o `cascade`
-- reescribirían o borrarían filas de la auditoría, que los triggers de
-- 20261129120000 rechazan para todos los roles.
--
-- Cambio: las dos columnas dejan de ser FK y conservan el UUID tal cual. Si
-- la cuenta se borra, el UUID queda como identificador seudónimo del actor:
-- ninguna tabla de la aplicación lo relaciona ya con una persona. Ninguna
-- fila existente se modifica ni se borra.
--
-- Integridad sin la FK:
--   - nadie más que las funciones admin_* escribe en `admin_action_logs`:
--     los clientes no tienen INSERT desde 20261129120000, y aquí se le quita
--     también a service_role (lo conservaba por los privilegios por defecto
--     y, sin la FK, podría añadir filas con un admin inventado). La app nunca
--     escribe el registro con service_role. Se mantiene su DELETE, que los
--     triggers rechazan fila a fila, porque la limpieza de la api-suite lo
--     llama sobre cero filas. `admin_log` solo recibe el uid que devuelve
--     `admin_require()`: un admin activo en el momento de la acción;
--   - `reports.resolved_by` lo fija `trg_reports_integrity` con `auth.uid()`
--     y authenticated no tiene UPDATE en `reports`.
--
-- Las fichas del panel (admin_get_user y admin_get_room) pasan a un LEFT
-- JOIN: una acción de un admin que ya no existe sigue apareciendo, con
-- `admin_name` nulo (la interfaz dice «cuenta de administración eliminada»).
--
-- REQUIERE REVISIÓN LEGAL: si un UUID sin cuenta es dato seudonimizado o
-- anónimo depende de lo que se conserve fuera (copias de seguridad, logs de
-- Auth). Las notas de las acciones las escribe el admin y pueden contener
-- datos personales; su plazo de conservación está sin decidir
-- (docs/PRIVACY_RETENTION.md).

alter table public.admin_action_logs
  drop constraint admin_action_logs_admin_id_fkey;
alter table public.reports
  drop constraint reports_resolved_by_fkey;

revoke insert, update, truncate on public.admin_action_logs from service_role;

comment on column public.admin_action_logs.admin_id is
  'UUID del admin que actuó (sin FK desde 20261130120000): seudónimo si la cuenta ya no existe.';
comment on column public.reports.resolved_by is
  'UUID del admin que cerró el reporte (sin FK desde 20261130120000): seudónimo si la cuenta ya no existe.';

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

create or replace function public.admin_get_room(p_room_id uuid)
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
        left join public.profiles a on a.id = l.admin_id
        where l.target_type = 'room' and l.target_id = v_room.id
        order by l.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;
