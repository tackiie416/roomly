-- ============================================================
-- Fase 6 (sesión 83): bloquear y reportar usuarios, y límites contra el abuso
-- y la enumeración de intereses (sobre todo por habitación).
-- ============================================================
-- 1. user_blocks: quién ha bloqueado a quién. Solo lo escribe el servidor
--    (block_user y unblock_user, EXECUTE solo de service_role). Cada persona
--    lee solo los bloqueos que ha hecho ella: quien está bloqueada no puede
--    saber por la base de datos quién la bloqueó.
-- 2. Un bloqueo, en cualquiera de los dos sentidos, impide intereses y
--    matches nuevos entre las dos personas (triggers para todos los roles,
--    también service_role). Bloquear borra el match y los intereses de la
--    pareja; el trigger de 20261127120000 cierra su conversación, así que no
--    hay mensajes nuevos. Para la otra persona es lo mismo que deshacer un
--    match.
-- 3. interest_log: registro de los intereses enviados (también de los que se
--    retiran después), solo para los límites. Antes, retirar y volver a
--    enviar no contaba para el límite de 30 en 24 h: se podía repetir sin
--    fin. Límites (rate_limit_exceeded, P0001):
--      - 30 intereses enviados en 24 h (también los retirados);
--      - 10 intereses por habitación en 24 h (descubrir quién publica una
--        habitación exige enviar un interés que esa persona ve);
--      - 3 envíos a la misma persona en 30 días (retirar y reenviar).
--    purge_interest_log borra las filas de más de 30 días (sin programar).
-- 4. reports: motivos cerrados, descripción de hasta 1000 caracteres, nunca
--    a una misma, un reporte abierto por persona y objetivo, 10 en 24 h y
--    cuenta activa. Solo un admin cambia el estado y las notas; quien
--    resuelve queda registrado. La persona reportada sigue sin ver nada.
-- 5. purge_closed_conversation_messages: borra los mensajes de las
--    conversaciones cerradas antes de una fecha. Preparada para una política
--    de conservación que todavía no está decidida: la app no la llama y no
--    hay ninguna tarea programada (EXECUTE solo de service_role).

-- ------------------------------------------------------------
-- 1. user_blocks
-- ------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chk_user_blocks_not_self check (blocker_id <> blocked_id)
);
create index idx_user_blocks_blocked on public.user_blocks(blocked_id);

alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from public, anon, authenticated;
grant select on public.user_blocks to authenticated;

-- Solo los bloqueos propios. Nunca una política que deje leer las filas en
-- las que una es `blocked_id`: revelaría quién la ha bloqueado.
create policy user_blocks_select_own on public.user_blocks
  for select to authenticated
  using (user_blocks.blocker_id = auth.uid());

-- ------------------------------------------------------------
-- 2. interest_log (solo servidor; nadie más lo lee)
-- ------------------------------------------------------------
create table public.interest_log (
  id bigint generated always as identity primary key,
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid,
  created_at timestamptz not null default now()
);
create index idx_interest_log_from_created on public.interest_log(from_user_id, created_at);
create index idx_interest_log_pair_created
  on public.interest_log(from_user_id, to_user_id, created_at);

alter table public.interest_log enable row level security;
revoke all on public.interest_log from public, anon, authenticated;
-- Una política que no deja pasar nada (el lint rls_enabled_no_policy pide
-- alguna): ningún cliente tiene además privilegios sobre la tabla.
create policy interest_log_no_client_access on public.interest_log
  for select to authenticated
  using (false);

-- ------------------------------------------------------------
-- 3. Triggers de interests y matches (todos los roles)
-- ------------------------------------------------------------
-- Errores:
--   - interest_party_invalid (23514): hay un bloqueo entre las dos personas.
--     Es el mismo error que una cuenta desactivada: por el error no se sabe
--     si te han bloqueado;
--   - rate_limit_exceeded (P0001): alguno de los límites de interest_log.
create function public.enforce_interests_abuse_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = new.from_user_id and b.blocked_id = new.to_user_id)
       or (b.blocker_id = new.to_user_id and b.blocked_id = new.from_user_id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'interest_party_invalid: alguna de las dos cuentas no puede enviar ni recibir intereses';
  end if;

  if (select count(*) from public.interest_log l
      where l.from_user_id = new.from_user_id
        and l.created_at > now() - interval '24 hours') >= 30 then
    raise exception using
      errcode = 'P0001',
      message = 'rate_limit_exceeded: demasiados intereses enviados en 24h';
  end if;

  if new.room_id is not null and (
      select count(*) from public.interest_log l
      where l.from_user_id = new.from_user_id
        and l.room_id is not null
        and l.created_at > now() - interval '24 hours') >= 10 then
    raise exception using
      errcode = 'P0001',
      message = 'rate_limit_exceeded: demasiados intereses por habitación en 24h';
  end if;

  if (select count(*) from public.interest_log l
      where l.from_user_id = new.from_user_id
        and l.to_user_id = new.to_user_id
        and l.created_at > now() - interval '30 days') >= 3 then
    raise exception using
      errcode = 'P0001',
      message = 'rate_limit_exceeded: demasiados envíos a la misma persona';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_interests_abuse_limits() from public, anon, authenticated;

create trigger trg_interests_abuse_limits
  before insert on public.interests
  for each row execute function public.enforce_interests_abuse_limits();

create function public.log_interest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.interest_log (from_user_id, to_user_id, room_id)
  values (new.from_user_id, new.to_user_id, new.room_id);
  return null;
end;
$$;

revoke all on function public.log_interest() from public, anon, authenticated;

create trigger trg_interests_log
  after insert on public.interests
  for each row execute function public.log_interest();

-- match_party_invalid (23514), como una cuenta desactivada.
create function public.enforce_matches_not_blocked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = new.user_a_id and b.blocked_id = new.user_b_id)
       or (b.blocker_id = new.user_b_id and b.blocked_id = new.user_a_id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'match_party_invalid: alguna de las dos cuentas está desactivada';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_matches_not_blocked() from public, anon, authenticated;

create trigger trg_matches_not_blocked
  before insert on public.matches
  for each row execute function public.enforce_matches_not_blocked();

-- ------------------------------------------------------------
-- 4. block_user y unblock_user (EXECUTE solo de service_role)
-- ------------------------------------------------------------
-- Mismo bloqueo por pareja que record_interest, withdraw_interest y
-- undo_match: un interés o un match simultáneo termina antes (y se borra
-- aquí) o empieza después (y lo rechaza el trigger). Devuelve 'blocked',
-- 'already_blocked', 'unblocked' o 'not_found'.
create function public.block_user(p_blocker uuid, p_blocked uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_inserted int;
  user_a uuid;
  user_b uuid;
begin
  if p_blocker is null or p_blocked is null or p_blocker = p_blocked then
    raise exception using
      errcode = '22004',
      message = 'block_invalid: faltan las personas o son la misma';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'interest_isolation: los bloqueos necesitan READ COMMITTED';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_blocker and p.deleted_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'block_invalid: la cuenta que bloquea no está activa';
  end if;
  -- 50 bloqueos en 24 h: frena el uso automatizado sin afectar al normal.
  if (select count(*) from public.user_blocks b
      where b.blocker_id = p_blocker and b.created_at > now() - interval '24 hours') >= 50 then
    raise exception using
      errcode = 'P0001',
      message = 'rate_limit_exceeded: demasiados bloqueos en 24h';
  end if;

  user_a := least(p_blocker, p_blocked);
  user_b := greatest(p_blocker, p_blocked);
  perform pg_advisory_xact_lock(hashtextextended(user_a::text || ':' || user_b::text, 5));

  insert into public.user_blocks (blocker_id, blocked_id)
  values (p_blocker, p_blocked)
  on conflict (blocker_id, blocked_id) do nothing;
  get diagnostics n_inserted = row_count;

  -- El match (su conversación se cierra con trg_matches_close_conversation)
  -- y los intereses de los dos sentidos.
  delete from public.matches m where m.user_a_id = user_a and m.user_b_id = user_b;
  delete from public.interests i
  where (i.from_user_id = p_blocker and i.to_user_id = p_blocked)
     or (i.from_user_id = p_blocked and i.to_user_id = p_blocker);

  return case when n_inserted = 1 then 'blocked' else 'already_blocked' end;
end;
$$;

revoke all on function public.block_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.block_user(uuid, uuid) to service_role;

-- Desbloquear no devuelve nada de lo que se borró al bloquear.
create function public.unblock_user(p_blocker uuid, p_blocked uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_deleted int;
begin
  if p_blocker is null or p_blocked is null or p_blocker = p_blocked then
    raise exception using
      errcode = '22004',
      message = 'block_invalid: faltan las personas o son la misma';
  end if;
  delete from public.user_blocks b
  where b.blocker_id = p_blocker and b.blocked_id = p_blocked;
  get diagnostics n_deleted = row_count;
  return case when n_deleted = 1 then 'unblocked' else 'not_found' end;
end;
$$;

revoke all on function public.unblock_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unblock_user(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- 5. reports: integridad, duplicados y límites
-- ------------------------------------------------------------
alter table public.reports
  add constraint chk_reports_reason check (
    reason in ('spam', 'fake_profile', 'harassment', 'inappropriate', 'scam', 'other')
  ),
  add constraint chk_reports_description_length check (
    description is null or char_length(description) <= 1000
  ),
  add constraint chk_reports_not_self check (reported_user_id is distinct from reporter_id);

-- Un solo reporte abierto (pending o in_review) por persona y objetivo.
create unique index uq_reports_open_user
  on public.reports(reporter_id, reported_user_id)
  where reported_user_id is not null and status in ('pending', 'in_review');
create unique index uq_reports_open_room
  on public.reports(reporter_id, reported_room_id)
  where reported_room_id is not null and status in ('pending', 'in_review');
create index idx_reports_reporter_created on public.reports(reporter_id, created_at);

-- authenticated: UPDATE solo de las columnas de la resolución; la RLS
-- (reports_admin_all) la limita a un admin activo. Sin DELETE.
revoke update, delete, truncate on public.reports from public, anon, authenticated;
grant update (status, resolution_notes, resolved_by, resolved_at) on public.reports to authenticated;

-- Errores:
--   - report_invalid (23514): la cuenta que reporta no está activa;
--   - report_immutable (23514): cambiar quién reporta, a quién, por qué o
--     cuándo, o resolverlo en nombre de otro admin;
--   - rate_limit_exceeded (P0001): 10 reportes en 24 h.
create function public.enforce_reports_integrity()
returns trigger
language plpgsql
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

create trigger trg_reports_integrity
  before insert or update on public.reports
  for each row execute function public.enforce_reports_integrity();

-- ------------------------------------------------------------
-- 6. Conservación (preparada, sin uso): solo service_role
-- ------------------------------------------------------------
-- Borra el registro de intereses de más de 30 días (ya no cuenta para
-- ningún límite). Devuelve las filas borradas.
create function public.purge_interest_log()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n_deleted int;
begin
  delete from public.interest_log l where l.created_at < now() - interval '30 days';
  get diagnostics n_deleted = row_count;
  return n_deleted;
end;
$$;

revoke all on function public.purge_interest_log() from public, anon, authenticated;
grant execute on function public.purge_interest_log() to service_role;

-- Borra los mensajes de las conversaciones cerradas antes de p_closed_before
-- (y nunca de una abierta). La fecha mínima de 30 días evita un borrado
-- inmediato por error. Devuelve los mensajes borrados.
create function public.purge_closed_conversation_messages(p_closed_before timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n_deleted int;
begin
  if p_closed_before is null or p_closed_before > now() - interval '30 days' then
    raise exception using
      errcode = '22023',
      message = 'purge_invalid: solo conversaciones cerradas hace más de 30 días';
  end if;
  delete from public.messages m
  using public.conversations c
  where c.id = m.conversation_id
    and c.closed_at is not null
    and c.closed_at < p_closed_before;
  get diagnostics n_deleted = row_count;
  return n_deleted;
end;
$$;

revoke all on function public.purge_closed_conversation_messages(timestamptz)
  from public, anon, authenticated;
grant execute on function public.purge_closed_conversation_messages(timestamptz) to service_role;
