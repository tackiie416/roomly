-- ============================================================
-- Fase 4.4 (sesión 71) — Lectura pública mínima para anon
-- ============================================================
-- Decisión del propietario (2026-10-31, R4): la búsqueda y el detalle de
-- habitaciones son públicos, sin identidad de la propietaria. Antes de
-- abrirlos, anon tiene que poder leer solo lo que esas páginas muestran. La
-- auditoría de la sesión 71 (en local, con los privilegios por defecto de
-- Supabase del shim) encontró:
--   - anon tenía SELECT de tabla en rooms (las 26 columnas, también owner_id,
--     approx_lat, approx_lng, status, deleted_at y las fechas), además de
--     REFERENCES y TRIGGER;
--   - anon y authenticated tenían TODOS los privilegios sobre la vista
--     public_profile_previews. La vista es `security_invoker = false` y se
--     puede actualizar sola (una tabla, columnas simples), así que un UPDATE o
--     DELETE sobre ella se ejecuta con los privilegios de su dueño, sin RLS ni
--     el GRANT por columnas de profiles: en local, un usuario autenticado se
--     puso `role = 'admin'` y anon cambió el nombre de otra persona. Grave:
--     viene de 20260925120100 y está en master.
--
-- 1. rooms: anon pierde todos sus privilegios y recibe SELECT solo de las 20
--    columnas que necesitan los DTO públicos (lista blanca de
--    lib/services/room-search.ts), sus filtros y su orden. Fuera: owner_id,
--    approx_lat, approx_lng, status, deleted_at, created_at y updated_at. Las
--    filas las sigue decidiendo la RLS de R7 (`rooms_select_active_public`,
--    sin cambios): las condiciones de una política sobre la propia tabla no
--    exigen privilegio de columna (comprobado en tests/db/22). PUBLIC no
--    tenía ningún privilegio en rooms; se revoca por si acaso. authenticated
--    no cambia (su SELECT de tabla y el INSERT/UPDATE por columnas del CRUD).
-- 2. room_images: `room_images_select` se divide en dos, con la misma
--    semántica (R7 sin cambios):
--      - `room_images_select_public` (todos los roles): fotos de una
--        habitación públicamente visible (`is_room_publicly_visible`);
--      - `room_images_select_own` (solo authenticated): las de las
--        habitaciones propias.
--    Hace falta porque la antigua leía `rooms.owner_id` en una subconsulta, y
--    una subconsulta de una política se ejecuta con los privilegios de quien
--    consulta: sin SELECT en owner_id, anon ya no habría podido leer ninguna
--    foto. La de las propias no se aplica a anon (auth.uid() es nulo; nunca
--    veía nada por ella). Pasan de 41 a 42 políticas.
-- 3. public_profile_previews: anon y PUBLIC pierden todo; authenticated
--    pierde INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES y TRIGGER y conserva
--    solo SELECT (H4, sin cambios: «datos públicos de otros»; la app no la usa
--    hoy, retirarla es una decisión pendiente). Nadie escribe ya a través de
--    la vista. service_role no cambia.
--
-- Sin cambios en tablas, columnas, funciones, triggers ni datos.

-- ------------------------------------------------------------
-- 1. rooms: anon, solo las columnas públicas
-- ------------------------------------------------------------
revoke all on public.rooms from anon;
revoke all on public.rooms from public;

grant select (
  id, title, description, city_id, neighborhood_id, price_month,
  expenses_included, deposit_amount, available_from, min_stay_months,
  max_stay_months, total_roommates, total_rooms, features, pets_allowed,
  smoking_allowed, students_only, house_rules, roommate_preferences,
  published_at
) on public.rooms to anon;

-- ------------------------------------------------------------
-- 2. room_images: lectura pública sin subconsultas sobre rooms
-- ------------------------------------------------------------
drop policy "room_images_select" on public.room_images;

create policy "room_images_select_public" on public.room_images
  for select using (
    public.is_room_publicly_visible(room_images.room_id)
  );

create policy "room_images_select_own" on public.room_images
  for select to authenticated
  using (
    exists (
      select 1 from public.rooms r
      where r.id = room_images.room_id
        and r.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 3. public_profile_previews: sin anon y sin escritura
-- ------------------------------------------------------------
revoke all on public.public_profile_previews from anon, public;
revoke insert, update, delete, truncate, references, trigger
  on public.public_profile_previews from authenticated;
