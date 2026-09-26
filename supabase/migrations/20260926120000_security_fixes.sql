-- ROOMLY — Correcciones de seguridad de la auditoría inicial en Claude Code
-- (ver PROGRESS.md, sesión 5, y docs/SECURITY.md §"Correcciones de la
-- auditoría inicial").
--
-- Migración NUEVA a propósito: las dos anteriores se dejan intactas para
-- conservar el historial. Todo lo de aquí se aplica encima de ellas.
--
-- Hallazgos corregidos (todos se demostraron con ataques reales en Postgres
-- durante la auditoría, y ahora cada uno tiene un test de regresión en
-- tests/db/):
--   C1  profiles_insert_own permitía crear el propio perfil con role='admin'.
--   C2  messages_*: el `conversation_id` sin cualificar de la subconsulta se
--       resolvía como cp.conversation_id = cp.conversation_id (tautología):
--       participar en una conversación daba acceso a TODAS.
--   C3  participants_select_own_conversations se consultaba a sí misma:
--       "infinite recursion detected in policy" en todo el chat.
--   H5  El propietario podía reactivar una habitación que un admin había
--       marcado como 'removed'.
--   M2  Quien creaba un reporte podía fijar status/resolved_by/
--       resolution_notes/resolved_at.

-- ============================================================
-- C1 — PROFILES: nadie crea ni modifica su propio role
-- ============================================================
-- Dos barreras independientes, igual que la corrección de UPDATE de la
-- migración 0002:
--   1. GRANT de columnas en INSERT: `role` y `deleted_at` no están en la
--      lista, así que un INSERT que las incluya falla con permission denied
--      y, si no se incluyen, se aplica el default (role = 'user').
--   2. WITH CHECK explícito en la política, por si alguien vuelve a conceder
--      INSERT a nivel de tabla más adelante.
-- Compatible con el futuro flujo de creación de perfil: sigue valiendo que
-- el cliente inserte su propio perfil (id = auth.uid()) con sus campos de
-- identidad, o que lo haga el servidor con service_role. Cambiar un role
-- solo puede hacerse con service_role (desde el servidor), nunca desde el
-- rol authenticated, tampoco siendo admin (ver docs/SECURITY.md).
revoke insert on public.profiles from anon, authenticated;
grant insert (
  id, full_name, date_of_birth, avatar_url, bio, seeking_status,
  email_notifications_enabled, onboarding_completed_at
) on public.profiles to authenticated;

-- anon nunca escribe perfiles (sin sesión RLS ya lo impedía; ahora tampoco
-- tiene el privilegio).
revoke update on public.profiles from anon;

drop policy "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (
    auth.uid() = profiles.id
    and profiles.role = 'user'
    and profiles.deleted_at is null
  );

drop policy "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = profiles.id)
  with check (auth.uid() = profiles.id);
-- `role` sigue fuera del GRANT de UPDATE de la migración 0002.

-- ============================================================
-- C2 + C3 — CHAT: comprobación de participante sin recursión ni ambigüedad
-- ============================================================
-- Por qué esta función SECURITY DEFINER es segura:
--   - No recibe ningún user_id: la identidad sale SIEMPRE de auth.uid()
--     (el JWT de la petición). Solo responde "¿participo YO en esta
--     conversación?", así que no se puede usar para sondear a terceros.
--   - Lo único que revela es algo que el llamante ya sabe (si él mismo
--     participa en una conversación dada).
--   - search_path vacío y todos los nombres cualificados con su schema:
--     no se puede secuestrar con objetos homónimos en otro schema.
--   - Se ejecuta con el dueño de la función (el rol que aplica las
--     migraciones, dueño también de conversation_participants), que no
--     está sujeto a RLS en esa tabla: por eso rompe la recursión.
--   - EXECUTE revocado a PUBLIC y anon; solo authenticated puede llamarla.
--   - STABLE, solo lectura, sin SQL dinámico.
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
    where cp.conversation_id = p_conversation_id
      and cp.user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_participant(uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

drop policy "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant" on public.conversations
  for select to authenticated
  using (public.is_conversation_participant(conversations.id));

-- Un participante ve a los demás participantes de SUS conversaciones
-- (necesario para pintar el chat), nunca los de otras.
drop policy "participants_select_own_conversations" on public.conversation_participants;
create policy "participants_select_own_conversations" on public.conversation_participants
  for select to authenticated
  using (public.is_conversation_participant(conversation_participants.conversation_id));

drop policy "participants_update_own" on public.conversation_participants;
create policy "participants_update_own" on public.conversation_participants
  for update to authenticated
  using (auth.uid() = conversation_participants.user_id)
  with check (auth.uid() = conversation_participants.user_id);
-- Solo last_read_at es actualizable (GRANT de columnas de la migración 0002).

drop policy "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (public.is_conversation_participant(messages.conversation_id));

drop policy "messages_insert_participant" on public.messages;
create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = messages.sender_id
    and public.is_conversation_participant(messages.conversation_id)
  );

-- ============================================================
-- H5 — ROOMS: 'removed' es un estado de moderación, solo lo gestiona un admin
-- ============================================================
-- RLS no puede comparar el valor viejo con el nuevo (WITH CHECK solo ve la
-- fila nueva), así que la garantía es un trigger. Bloquea, para el rol
-- authenticated/anon sin is_admin(), cualquier cambio de status que salga
-- de 'removed' o entre en 'removed'. El resto de la edición del propietario
-- (título, precio, pausar, marcar alquilada...) no cambia.
-- service_role (servidor) y el rol de migraciones no pasan por este bloqueo:
-- son operaciones autorizadas por diseño.
-- Decisión técnica: el propietario tampoco puede poner 'removed' él mismo
-- (se quedaría sin poder deshacerlo); para retirar su anuncio tiene
-- 'paused' o el soft-delete (deleted_at).
create or replace function public.enforce_room_moderation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (old.status = 'removed' or new.status = 'removed')
     and current_user in ('anon', 'authenticated')
     and not public.is_admin()
  then
    raise exception using
      errcode = '42501',
      message = 'room_moderation: solo un admin puede cambiar el estado desde o hacia removed';
  end if;
  return new;
end;
$$;

create trigger trg_rooms_moderation
  before update of status on public.rooms
  for each row execute function public.enforce_room_moderation();

-- ============================================================
-- M2 — REPORTS: quien reporta solo aporta qué, a quién y por qué
-- ============================================================
revoke insert on public.reports from anon, authenticated;
grant insert (
  reporter_id, reported_user_id, reported_room_id, reason, description
) on public.reports to authenticated;

drop policy "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert to authenticated
  with check (
    auth.uid() = reports.reporter_id
    and reports.status = 'pending'
    and reports.resolved_by is null
    and reports.resolved_at is null
    and reports.resolution_notes is null
  );
-- La resolución (status, resolved_by, resolved_at, resolution_notes) la
-- hace un admin vía UPDATE (reports_admin_all).
