-- ROOMLY — Políticas RLS (Fase 0, borrador de diseño)
-- NO APLICADA TODAVÍA. Se valida con tests de integración por rol en Fase 1
-- (ver docs/TESTING.md) antes de confiar en ella en producción.

alter table profiles enable row level security;
alter table housing_preferences enable row level security;
alter table compatibility_responses enable row level security;
alter table rooms enable row level security;
alter table room_addresses enable row level security;
alter table room_images enable row level security;
alter table favorites enable row level security;
alter table interests enable row level security;
alter table matches enable row level security;
alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table messages enable row level security;
alter table reports enable row level security;
alter table admin_action_logs enable row level security;
alter table notifications enable row level security;
-- Las tablas de referencia también llevan RLS activada (mejor práctica de
-- Supabase: ninguna tabla en `public` sin RLS, ni siquiera datos públicos).
alter table cities enable row level security;
alter table neighborhoods enable row level security;
alter table universities enable row level security;

create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and deleted_at is null
  );
$$ language sql security definer stable set search_path = public;

-- ============================================================
-- REFERENCIA: lectura pública total (no hay nada sensible)
-- ============================================================
create policy "cities_select_all" on cities for select using (true);
create policy "neighborhoods_select_all" on neighborhoods for select using (true);
create policy "universities_select_all" on universities for select using (true);
-- Sin política de escritura para el rol authenticated -> solo admin/migraciones.
create policy "cities_admin_write" on cities for all using (is_admin());
create policy "neighborhoods_admin_write" on neighborhoods for all using (is_admin());
create policy "universities_admin_write" on universities for all using (is_admin());

-- ============================================================
-- PROFILES
-- CORRECCIÓN TRAS REVISIÓN: la tabla completa (bio, fecha de nacimiento...)
-- ya NO es legible por usuarios anónimos, solo por usuarios autenticados.
-- Para las páginas públicas de SEO se usa la vista `public_profile_previews`
-- de más abajo, que expone solo nombre + avatar + universidad + ciudad.
-- ============================================================
create policy "profiles_select_authenticated" on profiles
  for select using (auth.uid() is not null and deleted_at is null);
create policy "profiles_select_own_even_if_deleted" on profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);
create policy "profiles_admin_all" on profiles
  for all using (is_admin());

-- Vista de solo estas 5 columnas, legible por anon: resuelve la tensión
-- entre "profiles ya no es público" y "las páginas /barcelona/habitaciones
-- tienen que ser rastreables por Google sin sesión".
create view public_profile_previews
with (security_invoker = false) as
select id, full_name, avatar_url, role
from profiles
where deleted_at is null;

grant select on public_profile_previews to anon, authenticated;

-- ============================================================
-- HOUSING_PREFERENCES / COMPATIBILITY_RESPONSES: solo el propio usuario.
-- Nunca se exponen en bruto a otra persona; lo que se muestra en el match
-- es el resultado ya calculado (score + razones), no las respuestas crudas.
-- ============================================================
create policy "housing_preferences_own" on housing_preferences
  for all using (auth.uid() = profile_id);
create policy "compatibility_responses_own" on compatibility_responses
  for all using (auth.uid() = profile_id);

-- ============================================================
-- ROOMS
-- ============================================================
create policy "rooms_select_active_public" on rooms
  for select using (status = 'active' and deleted_at is null);
create policy "rooms_select_own" on rooms
  for select using (auth.uid() = owner_id);
create policy "rooms_owner_write" on rooms
  for all using (auth.uid() = owner_id);
create policy "rooms_admin_all" on rooms
  for all using (is_admin());

-- Dirección exacta: SOLO el propietario (ni siquiera los demás usuarios
-- autenticados). Se ampliará a "compañero con match confirmado" cuando
-- exista esa lógica, sin tocar la tabla `rooms`.
create policy "room_addresses_owner_only" on room_addresses
  for all using (
    exists (select 1 from rooms r where r.id = room_id and r.owner_id = auth.uid())
  );

create policy "room_images_select" on room_images
  for select using (
    exists (select 1 from rooms r where r.id = room_id and (r.status = 'active' or r.owner_id = auth.uid()))
  );
create policy "room_images_owner_write" on room_images
  for all using (
    exists (select 1 from rooms r where r.id = room_id and r.owner_id = auth.uid())
  );

create policy "favorites_own" on favorites for all using (auth.uid() = user_id);

-- ============================================================
-- INTERESTS: los dos participantes pueden verlo (quien lo envía Y quien
-- lo recibe — así funciona "he recibido un interés" en la sección 15).
-- Solo quien lo envía puede crearlo o borrarlo (retirar interés).
-- ============================================================
create policy "interests_select_participant" on interests
  for select using (auth.uid() = from_user_id or auth.uid() = to_user_id);
create policy "interests_insert_own" on interests
  for insert with check (auth.uid() = from_user_id);
create policy "interests_delete_own" on interests
  for delete using (auth.uid() = from_user_id);

-- ============================================================
-- MATCHES / CONVERSATIONS / CONVERSATION_PARTICIPANTS
-- A PROPÓSITO no hay política de INSERT para el rol authenticated en
-- ninguna de estas tres tablas. Solo se crean desde el servidor (rol de
-- servicio) tras verificar interés mutuo, nunca directamente por el cliente.
-- Esto es intencional, no un olvido — lo dejamos documentado para que
-- nadie "arregle" el hueco añadiendo una política permisiva más adelante.
-- ============================================================
create policy "matches_select_participant" on matches
  for select using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "conversations_select_participant" on conversations
  for select using (
    exists (select 1 from conversation_participants cp where cp.conversation_id = id and cp.user_id = auth.uid())
  );

create policy "participants_select_own_conversations" on conversation_participants
  for select using (
    exists (select 1 from conversation_participants cp2 where cp2.conversation_id = conversation_id and cp2.user_id = auth.uid())
  );
create policy "participants_update_own" on conversation_participants
  for update using (auth.uid() = user_id); -- para actualizar last_read_at

create policy "messages_select_participant" on messages
  for select using (
    exists (select 1 from conversation_participants cp where cp.conversation_id = conversation_id and cp.user_id = auth.uid())
  );
create policy "messages_insert_participant" on messages
  for insert with check (
    auth.uid() = sender_id and
    exists (select 1 from conversation_participants cp where cp.conversation_id = conversation_id and cp.user_id = auth.uid())
  );

-- ============================================================
-- REPORTS: quien reporta ve lo suyo; la persona reportada NO tiene
-- ninguna política de select, así que no puede saber quién la reportó.
-- ============================================================
create policy "reports_insert_own" on reports for insert with check (auth.uid() = reporter_id);
create policy "reports_select_own" on reports for select using (auth.uid() = reporter_id);
create policy "reports_admin_all" on reports for all using (is_admin());

create policy "admin_action_logs_admin_only" on admin_action_logs for all using (is_admin());

create policy "notifications_own" on notifications for all using (auth.uid() = user_id);
