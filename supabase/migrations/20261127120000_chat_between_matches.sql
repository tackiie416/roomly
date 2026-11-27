-- ============================================================
-- Fase 6 — Chat entre matches, deshacer un match e interés por habitación
-- ============================================================
-- Autorizada por el propietario el 2026-11-26 (inicio de la Fase 6).
--
-- Antes de esta migración, el chat del esquema inicial dejaba escribir a
-- cualquier participante de una conversación, existiera o no el match, sin
-- límite de longitud ni de ritmo, y nada creaba las conversaciones. Ahora:
--
-- 1. Una conversación por match (`uq_conversations_match`), creada por la
--    base de datos al crearse el match (`trg_matches_open_conversation`), con
--    las dos personas como participantes. Los clientes siguen sin crear
--    conversaciones ni participantes.
-- 2. Un chat está abierto mientras existe su match. Al desaparecer el match
--    (deshacerlo, o la cascada desde `profiles`), `trg_matches_close_conversation`
--    marca `closed_at` y la FK deja `match_id` a NULL. Una conversación
--    cerrada no se lee ni se escribe desde ningún cliente:
--    `is_conversation_participant` exige ahora conversación abierta, y las
--    tres políticas de lectura y la de envío la usan. Los mensajes se
--    conservan en la base de datos (decisión de retención pendiente:
--    docs/SECURITY.md, «Fase 6»).
-- 3. Mensajes: GRANT por columnas (INSERT de conversation_id, sender_id,
--    content y client_token; nada de UPDATE ni DELETE) y el trigger
--    `trg_messages_integrity`, que se aplica A TODOS LOS ROLES, también a
--    service_role: un mensaje no se modifica; la conversación está abierta y
--    con match; quien envía es participante y parte del match; las dos
--    cuentas están activas; 2000 caracteres como máximo
--    (`chk_messages_content_length`); 30 mensajes por minuto y remitente; y
--    `client_token` único por remitente (`uq_messages_sender_token`), para
--    que un envío repetido no duplique el mensaje.
-- 4. `undo_match`: deshace un match y retira los dos intereses (si no, el
--    siguiente «Me interesa» lo rehacería al momento). Mismo patrón que
--    record_interest: SECURITY INVOKER, EXECUTE solo para service_role,
--    bloqueo por pareja y READ COMMITTED obligatorio.
-- 5. `room_interest_owner`: para el interés por una habitación, devuelve
--    quién la publica solo si la habitación es visible públicamente (R7) y
--    su cuenta puede recibir intereses. EXECUTE solo para service_role: el
--    detalle público sigue sin mostrar a la propietaria (R4).
-- 6. Realtime (si el proyecto tiene la publicación `supabase_realtime`):
--    `messages` se añade a la publicación. Supabase aplica la RLS de lectura
--    a cada suscriptor; la app lo usa solo para refrescar la página.
--
-- Columnas siempre cualificadas (ver la lección de `messages` en
-- docs/SECURITY.md).

-- ------------------------------------------------------------
-- 1. Esquema
-- ------------------------------------------------------------
alter table public.conversations add column closed_at timestamptz;

-- Conversaciones sin match (no las crea la app; solo podían venir de pruebas
-- manuales): quedan cerradas, nunca abiertas sin match.
update public.conversations c
set closed_at = now()
where c.match_id is null and c.closed_at is null;

alter table public.conversations
  add constraint uq_conversations_match unique (match_id);
alter table public.conversations
  add constraint chk_conversations_open_has_match
  check (closed_at is not null or match_id is not null);
alter table public.conversations drop constraint conversations_match_id_fkey;
alter table public.conversations
  add constraint conversations_match_id_fkey
  foreign key (match_id) references public.matches(id) on delete set null;

alter table public.messages add column client_token uuid;
alter table public.messages
  add constraint uq_messages_sender_token unique (sender_id, client_token);
alter table public.messages
  add constraint chk_messages_content_length check (char_length(content) <= 2000);
create index idx_messages_sender_created on public.messages (sender_id, created_at);

-- ------------------------------------------------------------
-- 2. Privilegios: solo lectura, salvo enviar y marcar como leído
-- ------------------------------------------------------------
revoke all on public.conversations from public, anon;
revoke all on public.conversation_participants from public, anon;
revoke all on public.messages from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on public.conversations from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.conversation_participants from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.messages from authenticated;
grant select on public.conversations to authenticated;
grant select on public.conversation_participants to authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, content, client_token)
  on public.messages to authenticated;

-- ------------------------------------------------------------
-- 3. Participante de una conversación ABIERTA
-- ------------------------------------------------------------
-- Misma firma, mismo dueño y mismos privilegios (create or replace los
-- conserva): SECURITY DEFINER con search_path vacío, solo authenticated.
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    where cp.conversation_id = p_conversation_id
      and cp.user_id = auth.uid()
      and c.closed_at is null
      and c.match_id is not null
  );
$$;

-- ------------------------------------------------------------
-- 4. Conversación del match: se abre al crearse y se cierra al desaparecer
-- ------------------------------------------------------------
create function public.open_match_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  conv_id uuid;
begin
  insert into public.conversations (match_id) values (new.id)
  returning id into conv_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, new.user_a_id), (conv_id, new.user_b_id);
  return null;
end;
$$;

revoke all on function public.open_match_conversation() from public, anon, authenticated;

create trigger trg_matches_open_conversation
  after insert on public.matches
  for each row execute function public.open_match_conversation();

create function public.close_match_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations c
  set closed_at = now()
  where c.match_id = old.id and c.closed_at is null;
  return old;
end;
$$;

revoke all on function public.close_match_conversation() from public, anon, authenticated;

create trigger trg_matches_close_conversation
  before delete on public.matches
  for each row execute function public.close_match_conversation();

-- Matches anteriores a esta migración (de la Fase 5.1): su conversación.
with created as (
  insert into public.conversations (match_id)
  select m.id from public.matches m
  where not exists (select 1 from public.conversations c where c.match_id = m.id)
  returning id, match_id
)
insert into public.conversation_participants (conversation_id, user_id)
select created.id, u.user_id
from created
join public.matches m on m.id = created.match_id
cross join lateral (values (m.user_a_id), (m.user_b_id)) as u(user_id);

-- ------------------------------------------------------------
-- 5. Integridad de messages (todos los roles)
-- ------------------------------------------------------------
-- Errores, con un prefijo estable (lib/services/chat.ts los traduce):
--   - message_immutable (23514): UPDATE de un mensaje;
--   - message_conversation_closed (23514): la conversación no existe, está
--     cerrada o no tiene match;
--   - message_sender_invalid (23514): quien envía no es participante ni
--     parte del match, o alguna de las dos cuentas está desactivada;
--   - rate_limit_exceeded (P0001): 30 mensajes en un minuto.
-- SECURITY DEFINER: con el rol authenticated, la RLS de profiles solo deja
-- ver la fila propia y no podría comprobar la cuenta de la otra persona. No
-- se puede llamar directamente (es una función de trigger, sin EXECUTE).
-- La conversación se bloquea con FOR SHARE: si a la vez se deshace el match,
-- uno de los dos espera, y el mensaje no entra en un chat ya cerrado.
create function public.enforce_messages_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv_match uuid;
  n_valid int;
  n_recent int;
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'message_immutable: un mensaje no se modifica';
  end if;

  select c.match_id into conv_match
  from public.conversations c
  where c.id = new.conversation_id
    and c.closed_at is null
    and c.match_id is not null
  for share;
  if conv_match is null then
    raise exception using
      errcode = '23514',
      message = 'message_conversation_closed: la conversación no existe o está cerrada';
  end if;

  select count(*) into n_valid
  from public.matches m
  join public.profiles p on p.id in (m.user_a_id, m.user_b_id)
  where m.id = conv_match
    and new.sender_id in (m.user_a_id, m.user_b_id)
    and p.deleted_at is null
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = new.conversation_id
        and cp.user_id = new.sender_id);
  if n_valid <> 2 then
    raise exception using
      errcode = '23514',
      message = 'message_sender_invalid: quien envía no puede escribir en esta conversación';
  end if;

  select count(*) into n_recent
  from public.messages msg
  where msg.sender_id = new.sender_id
    and msg.created_at > now() - interval '1 minute';
  if n_recent >= 30 then
    raise exception using
      errcode = 'P0001',
      message = 'rate_limit_exceeded: demasiados mensajes en un minuto';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_messages_integrity() from public, anon, authenticated;

create trigger trg_messages_integrity
  before insert or update on public.messages
  for each row execute function public.enforce_messages_integrity();

-- Tras un mensaje: la conversación sube en la lista y, para quien envía, el
-- chat queda leído. SECURITY DEFINER por lo mismo (authenticated no tiene
-- UPDATE de conversations ni de la fila de la otra persona).
create function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
  set last_message_at = new.created_at
  where c.id = new.conversation_id
    and (c.last_message_at is null or c.last_message_at < new.created_at);
  update public.conversation_participants cp
  set last_read_at = new.created_at
  where cp.conversation_id = new.conversation_id
    and cp.user_id = new.sender_id
    and (cp.last_read_at is null or cp.last_read_at < new.created_at);
  return null;
end;
$$;

revoke all on function public.touch_conversation_on_message() from public, anon, authenticated;

create trigger trg_messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ------------------------------------------------------------
-- 6. undo_match: deshacer un match
-- ------------------------------------------------------------
-- Devuelve 'undone' o 'not_found' (no había match). Borra el match (el
-- trigger cierra su conversación) y los dos intereses de la pareja. Mismos
-- errores de argumentos y de aislamiento que record_interest.
create function public.undo_match(p_user uuid, p_other uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_deleted int;
  user_a uuid;
  user_b uuid;
begin
  if p_user is null or p_other is null or p_user = p_other then
    raise exception using
      errcode = '22004',
      message = 'interest_invalid: faltan las personas o son la misma';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'interest_isolation: los intereses necesitan READ COMMITTED';
  end if;

  user_a := least(p_user, p_other);
  user_b := greatest(p_user, p_other);
  perform pg_advisory_xact_lock(hashtextextended(user_a::text || ':' || user_b::text, 5));

  delete from public.matches m
  where m.user_a_id = user_a and m.user_b_id = user_b;
  get diagnostics n_deleted = row_count;
  if n_deleted = 0 then
    return 'not_found';
  end if;

  delete from public.interests i
  where (i.from_user_id = p_user and i.to_user_id = p_other)
     or (i.from_user_id = p_other and i.to_user_id = p_user);
  return 'undone';
end;
$$;

revoke all on function public.undo_match(uuid, uuid) from public, anon, authenticated;
grant execute on function public.undo_match(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- 7. room_interest_owner: quién recibe un interés por una habitación
-- ------------------------------------------------------------
-- NULL si la habitación no es visible públicamente (el mismo criterio que
-- trg_interests_integrity) o si su cuenta no puede recibir intereses.
create function public.room_interest_owner(p_room_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select r.owner_id
  from public.rooms r
  join public.profiles p on p.id = r.owner_id
  where r.id = p_room_id
    and r.status = 'active'
    and r.deleted_at is null
    and p.deleted_at is null
    and p.onboarding_completed_at is not null
    and p.role <> 'admin';
$$;

revoke all on function public.room_interest_owner(uuid) from public, anon, authenticated;
grant execute on function public.room_interest_owner(uuid) to service_role;

-- ------------------------------------------------------------
-- 8. Realtime (solo si el proyecto tiene la publicación)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
