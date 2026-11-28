-- ============================================================
-- Eliminación de la cuenta propia y exportación de los mensajes propios
-- (sesión 87, en local; sin aplicar en ningún proyecto real)
-- ============================================================
-- Criterios provisionales del propietario (2026-11-28): la persona inicia la
-- eliminación; se borran o anonimizan sus datos personales; los registros de
-- seguridad y auditoría se conservan solo cuando hace falta, con el actor
-- seudónimo; no quedan cuentas activas ni sesiones válidas; se revoca el
-- acceso a chats y datos privados; el proceso es idempotente y seguro. Los
-- plazos y la base jurídica de lo que se conserva REQUIEREN REVISIÓN LEGAL
-- (docs/PRIVACY_RETENTION.md).
--
-- Orden (lo orquesta lib/services/account-deletion.ts, con service_role):
--   1. request_account_deletion: desactiva la cuenta (deleted_at) y anota la
--      solicitud. Desde aquí la cuenta no escribe, no es visible y no puede
--      subir fotos (trg_room_images_integrity). Devuelve sus habitaciones;
--   2. el servidor borra y verifica en Storage las fotos de esas
--      habitaciones (lib/services/room-images.ts) **antes** de borrar filas
--      (requisito de docs/SECURITY.md, «Cascadas desde profiles y Auth»);
--   3. delete_account_data: comprueba que no queda ningún objeto de sus
--      habitaciones y borra sus datos en una transacción (sección 4);
--   4. el servidor borra el usuario de Auth (auth.admin.deleteUser), lo que
--      revoca sus sesiones y tokens de refresco y borra el perfil anonimizado
--      en cascada;
--   5. complete_account_deletion: marca la solicitud como completada.
-- Cada paso se puede repetir: si uno falla, la cuenta queda desactivada y la
-- solicitud pendiente, y volver a pedir la eliminación continúa donde se
-- quedó.
--
-- Reportes (decisión provisional, coherente con 20261130120000): quién
-- reporta, a quién y qué habitación dejan de ser FK y conservan el UUID tal
-- cual, seudónimo cuando la cuenta o la habitación ya no existen. Así un
-- reporte hecho o recibido no impide borrar una cuenta y el historial de un
-- caso de moderación no se pierde. La existencia del destino al crear un
-- reporte la sigue exigiendo trg_reports_integrity (mismo error 23503 y el
-- mismo nombre de restricción que antes). delete_own_room conserva el
-- comportamiento de la FK: una habitación con reportes no se borra.
--
-- Mensajes: se borran los que escribió la persona. Los que escribió la otra
-- persona en esa conversación son también datos de esa otra persona y se
-- quedan, en un chat cerrado que nadie puede leer, hasta que se decida la
-- conservación (docs/PRIVACY_RETENTION.md, sección 4).
--
-- Exportación: export_own_messages devuelve, a quien la llama, solo los
-- mensajes que escribió, también los de chats cerrados, sin el contenido ni
-- la identidad de la otra persona. SECURITY DEFINER con auth.uid() (sin
-- service_role, como is_conversation_participant).

-- ------------------------------------------------------------
-- 1. Reportes: actor y destino seudónimos
-- ------------------------------------------------------------
alter table public.reports drop constraint reports_reporter_id_fkey;
alter table public.reports drop constraint reports_reported_user_id_fkey;
alter table public.reports drop constraint reports_reported_room_id_fkey;

comment on column public.reports.reporter_id is
  'UUID de quien reporta (sin FK desde 20261201120000): seudónimo si la cuenta ya no existe.';
comment on column public.reports.reported_user_id is
  'UUID de la persona reportada (sin FK desde 20261201120000): seudónimo si la cuenta ya no existe.';
comment on column public.reports.reported_room_id is
  'UUID de la habitación reportada (sin FK desde 20261201120000): seudónimo si ya no existe.';

-- Igual que en 20261128120000, más la existencia del destino al crear el
-- reporte (antes la daban las FK). SECURITY DEFINER: quien reporta no puede
-- leer el perfil de la otra persona (H4) ni una habitación que no sea
-- pública, y la FK lo comprobaba sin RLS. La función no devuelve nada de
-- esas filas: solo decide si existen. Como trigger, ningún rol la llama.
create or replace function public.enforce_reports_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- En nombre de otra persona: lo rechaza la RLS (reports_insert_own) con
    -- 42501; aquí no se comprueba nada de esa otra cuenta.
    if auth.uid() is not null and new.reporter_id is distinct from auth.uid() then
      return new;
    end if;
    if not exists (
      select 1 from public.profiles p where p.id = new.reporter_id and p.deleted_at is null
    ) then
      raise exception using
        errcode = '23514',
        message = 'report_invalid: la cuenta que reporta no está activa';
    end if;
    if new.reported_user_id is not null
       and not exists (select 1 from public.profiles p where p.id = new.reported_user_id) then
      raise exception using
        errcode = '23503',
        constraint = 'reports_reported_user_id_fkey',
        message = 'report_target_missing: la persona reportada no existe';
    end if;
    if new.reported_room_id is not null
       and not exists (select 1 from public.rooms r where r.id = new.reported_room_id) then
      raise exception using
        errcode = '23503',
        constraint = 'reports_reported_room_id_fkey',
        message = 'report_target_missing: la habitación reportada no existe';
    end if;
    if (select count(*) from public.reports r
        where r.reporter_id = new.reporter_id
          and r.created_at > now() - interval '24 hours') >= 10 then
      raise exception using
        errcode = 'P0001',
        message = 'rate_limit_exceeded: demasiados reportes en 24h';
    end if;
    return new;
  end if;

  if new.reporter_id <> old.reporter_id
     or new.reported_user_id is distinct from old.reported_user_id
     or new.reported_room_id is distinct from old.reported_room_id
     or new.reason <> old.reason
     or new.description is distinct from old.description
     or new.created_at <> old.created_at then
    raise exception using
      errcode = '23514',
      message = 'report_immutable: solo se cambia la resolución';
  end if;

  if new.status in ('resolved', 'dismissed') then
    if auth.uid() is not null then
      if new.resolved_by is not null and new.resolved_by <> auth.uid() then
        raise exception using
          errcode = '23514',
          message = 'report_immutable: se resuelve con la cuenta propia';
      end if;
      new.resolved_by := auth.uid();
    end if;
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_reports_integrity() from public, anon, authenticated;

-- delete_own_room (20261030120000): igual, y con el rechazo que antes daba la
-- FK de reports.reported_room_id (mismo SQLSTATE y nombre de restricción).
create or replace function public.delete_own_room(p_room_id uuid, p_user_id uuid)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  paths text[];
  n_invalid int;
  n_deleted int;
begin
  if p_room_id is null or p_user_id is null then
    raise exception using
      errcode = '22004',
      message = 'room_delete_invalid: faltan la habitación o el usuario';
  end if;

  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'room_delete_isolation: el borrado de una habitación necesita READ COMMITTED';
  end if;

  perform 1
  from public.profiles p
  where p.id = p_user_id
    and p.deleted_at is null
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'account_deleted: la cuenta no existe o está desactivada';
  end if;

  perform 1
  from public.rooms r
  where r.id = p_room_id
    and r.owner_id = p_user_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'room_not_found: la habitación no existe o no es de esta cuenta';
  end if;

  if exists (select 1 from public.reports rp where rp.reported_room_id = p_room_id) then
    raise exception using
      errcode = '23503',
      constraint = 'reports_reported_room_id_fkey',
      message = 'room_delete_reported: la habitación tiene reportes; no se ha borrado nada';
  end if;

  select
    coalesce(array_agg(i.storage_path order by i.position, i.created_at, i.id), '{}'),
    count(*) filter (
      where i.storage_path is distinct from (i.room_id::text || '/' || i.id::text || '.webp')
         or i.storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    )
  into paths, n_invalid
  from public.room_images i
  where i.room_id = p_room_id;
  if n_invalid > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'room_delete_path_invalid: %s fotos con una ruta no canónica; no se ha borrado nada',
        n_invalid
      );
  end if;

  delete from public.rooms r
  where r.id = p_room_id
    and r.owner_id = p_user_id;
  get diagnostics n_deleted = row_count;
  if n_deleted <> 1 then
    raise exception using
      errcode = 'P0002',
      message = 'room_not_found: la habitación no se ha podido borrar';
  end if;

  return paths;
end;
$$;

revoke all on function public.delete_own_room(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_own_room(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- 2. Solicitudes de eliminación
-- ------------------------------------------------------------
-- Una fila por cuenta. `user_id` sin FK (seudónimo cuando la cuenta ya no
-- existe): es lo mínimo para saber que una eliminación se pidió y se
-- completó. Ningún cliente la lee ni la escribe.
create table public.account_deletion_requests (
  user_id uuid primary key,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint chk_account_deletion_completed check (completed_at is null or completed_at >= requested_at)
);

alter table public.account_deletion_requests enable row level security;
-- Como interest_log: una política explícita que no deja leer nada, para que
-- ninguna tabla de public tenga la RLS activa sin políticas (P5).
create policy account_deletion_requests_no_client_access on public.account_deletion_requests
  for select to authenticated
  using (false);
revoke all on public.account_deletion_requests from public, anon, authenticated;
revoke all on public.account_deletion_requests from service_role;
grant select on public.account_deletion_requests to service_role;

comment on table public.account_deletion_requests is
  'Solicitudes de eliminación de cuenta (20261201120000). Solo la escriben las funciones de eliminación; sin acceso de clientes.';

-- ------------------------------------------------------------
-- 3. request_account_deletion: desactivar y anotar
-- ------------------------------------------------------------
-- Devuelve {"status": "pending", "rooms": [ids]} o, si la cuenta ya no
-- existe y la solicitud se había anotado, {"status": "profile_absent",
-- "rooms": []}. Idempotente.
create function public.request_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rooms jsonb;
begin
  if p_user_id is null then
    raise exception using errcode = '22004', message = 'account_deletion_invalid: falta la cuenta';
  end if;

  perform 1 from public.profiles p where p.id = p_user_id for update;
  if not found then
    if exists (select 1 from public.account_deletion_requests d where d.user_id = p_user_id) then
      return jsonb_build_object('status', 'profile_absent', 'rooms', '[]'::jsonb);
    end if;
    raise exception using
      errcode = 'P0002',
      message = 'account_not_found: la cuenta no existe';
  end if;

  update public.profiles p
  set deleted_at = now()
  where p.id = p_user_id and p.deleted_at is null;

  insert into public.account_deletion_requests (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select coalesce(jsonb_agg(r.id order by r.created_at, r.id), '[]'::jsonb)
  into v_rooms
  from public.rooms r
  where r.owner_id = p_user_id;

  return jsonb_build_object('status', 'pending', 'rooms', v_rooms);
end;
$$;

-- ------------------------------------------------------------
-- 4. delete_account_data: borrar y anonimizar en una transacción
-- ------------------------------------------------------------
-- Requisitos: solicitud anotada y sin completar, cuenta desactivada y ningún
-- objeto de Storage en las carpetas de sus habitaciones. Borra:
--   - los mensajes que escribió y su participación en conversaciones (pierde
--     el acceso a todos sus chats en ese instante);
--   - sus intereses (enviados y recibidos) y sus matches: los triggers de
--     20261127120000 cierran esas conversaciones para la otra persona;
--   - sus bloqueos (hechos y recibidos), favoritos, notificaciones,
--     registro de intereses, test, preferencias y habitaciones (con sus filas
--     de fotos y direcciones);
-- y deja el perfil anonimizado (nombre «Cuenta eliminada», sin bio, avatar ni
-- fecha de nacimiento real) hasta que el borrado del usuario de Auth lo
-- elimine en cascada. Conserva, con el UUID seudónimo: los reportes que hizo
-- o recibió, las acciones de admin que hizo o recibió y la propia solicitud.
-- Devuelve cuántas filas borró de cada tabla. Si el perfil ya no existe,
-- {"status": "profile_absent"}.
create function public.delete_account_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_at timestamptz;
  v_pending int;
  v_counts jsonb := '{}'::jsonb;
  n int;
begin
  if p_user_id is null then
    raise exception using errcode = '22004', message = 'account_deletion_invalid: falta la cuenta';
  end if;

  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'account_deletion_isolation: la eliminación necesita READ COMMITTED';
  end if;

  select p.deleted_at into v_deleted_at
  from public.profiles p where p.id = p_user_id for update;
  if not found then
    if exists (select 1 from public.account_deletion_requests d where d.user_id = p_user_id) then
      return jsonb_build_object('status', 'profile_absent');
    end if;
    raise exception using errcode = 'P0002', message = 'account_not_found: la cuenta no existe';
  end if;

  if not exists (
    select 1 from public.account_deletion_requests d
    where d.user_id = p_user_id and d.completed_at is null
  ) then
    raise exception using
      errcode = '42501',
      message = 'account_deletion_not_requested: no hay una solicitud pendiente';
  end if;
  if v_deleted_at is null then
    raise exception using
      errcode = '42501',
      message = 'account_deletion_not_deactivated: la cuenta sigue activa';
  end if;

  -- Bloquea sus habitaciones (una subida en curso termina antes o falla
  -- después) y comprueba que el servidor ya vació sus carpetas de Storage.
  perform 1 from public.rooms r where r.owner_id = p_user_id for update;
  select count(*) into v_pending
  from storage.objects o
  where o.bucket_id = 'room-images'
    and split_part(o.name, '/', 1) in (
      select r.id::text from public.rooms r where r.owner_id = p_user_id
    );
  if v_pending > 0 then
    raise exception using
      errcode = '55000',
      message = format(
        'account_deletion_storage_pending: %s fotos siguen en Storage; no se ha borrado nada',
        v_pending
      );
  end if;

  delete from public.messages m where m.sender_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('messages', n);

  delete from public.conversation_participants cp where cp.user_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('conversation_participants', n);

  delete from public.matches m where m.user_a_id = p_user_id or m.user_b_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('matches', n);

  delete from public.interests i where i.from_user_id = p_user_id or i.to_user_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('interests', n);

  delete from public.interest_log l where l.from_user_id = p_user_id or l.to_user_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('interest_log', n);

  delete from public.user_blocks b where b.blocker_id = p_user_id or b.blocked_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('user_blocks', n);

  delete from public.favorites f where f.user_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('favorites', n);

  delete from public.notifications x where x.user_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('notifications', n);

  delete from public.compatibility_responses c where c.profile_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('compatibility_responses', n);

  delete from public.housing_preferences h where h.profile_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('housing_preferences', n);

  delete from public.rooms r where r.owner_id = p_user_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('rooms', n);

  update public.profiles p
  set full_name = 'Cuenta eliminada',
      bio = null,
      avatar_url = null,
      date_of_birth = date '1900-01-01',
      email_notifications_enabled = false
  where p.id = p_user_id;

  return jsonb_build_object('status', 'deleted', 'counts', v_counts);
end;
$$;

-- ------------------------------------------------------------
-- 5. complete_account_deletion: marcar la solicitud
-- ------------------------------------------------------------
-- true si el perfil ya no existe (Auth lo borró) y la solicitud queda
-- completada; false si el perfil sigue (Auth aún no se ha borrado).
create function public.complete_account_deletion(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '22004', message = 'account_deletion_invalid: falta la cuenta';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return false;
  end if;
  update public.account_deletion_requests d
  set completed_at = coalesce(d.completed_at, now())
  where d.user_id = p_user_id;
  return found;
end;
$$;

-- Solo el servidor (service_role): ni PUBLIC, ni anon, ni authenticated.
revoke all on function public.request_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.delete_account_data(uuid) from public, anon, authenticated;
revoke all on function public.complete_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid) to service_role;
grant execute on function public.delete_account_data(uuid) to service_role;
grant execute on function public.complete_account_deletion(uuid) to service_role;

-- ------------------------------------------------------------
-- 6. export_own_messages: los mensajes propios, también de chats cerrados
-- ------------------------------------------------------------
-- Para «Descargar mis datos». Solo filas con sender_id = auth.uid(): nunca el
-- contenido ni la identidad de la otra persona. `conversation_number`
-- numera las conversaciones de quien llama (1, 2…) por su primer mensaje
-- propio, sin revelar su id. Sin sesión, ninguna fila.
create function public.export_own_messages()
returns table (
  conversation_number bigint,
  conversation_closed boolean,
  created_at timestamptz,
  content text
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select m.conversation_id, m.created_at, m.content, m.id,
           (c.closed_at is not null or c.match_id is null) as closed
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where auth.uid() is not null
      and m.sender_id = auth.uid()
  ),
  firsts as (
    select conversation_id, min(created_at) as first_at
    from mine group by conversation_id
  )
  select dense_rank() over (order by f.first_at, f.conversation_id) as conversation_number,
         mi.closed as conversation_closed,
         mi.created_at,
         mi.content
  from mine mi
  join firsts f on f.conversation_id = mi.conversation_id
  order by conversation_number, mi.created_at, mi.id;
$$;

revoke all on function public.export_own_messages() from public, anon, authenticated;
grant execute on function public.export_own_messages() to authenticated;
