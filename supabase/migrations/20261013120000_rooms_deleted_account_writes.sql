-- ============================================================
-- Fase 4.0 — Habitaciones: escrituras bloqueadas para cuentas desactivadas
-- ============================================================
-- Extiende a `rooms`, `room_addresses` y `room_images` la regla de
-- `20260930130000_block_deleted_account_writes.sql` (decisión B de la
-- auditoría 2.3): `profiles.deleted_at IS NOT NULL` significa cuenta
-- desactivada, y la base de datos le impide escribir sus filas. Esa
-- migración dejó pendiente aplicar la misma regla al resto de tablas que
-- escribe un usuario cuando tuvieran flujo (docs/SECURITY.md); estas tres lo
-- tienen desde la Fase 4.
--
-- Mismo patrón que `housing_preferences`: cada política FOR ALL del
-- propietario se divide por comando.
--   - Lectura: sin cambios. `rooms_select_active_public`, `rooms_select_own`
--     y `room_images_select` no se tocan. En `room_addresses`, la nueva
--     `room_addresses_select_own` conserva la condición de siempre (solo el
--     propietario, aunque su cuenta esté desactivada).
--   - Escritura (INSERT, UPDATE y DELETE): la misma condición de propiedad
--     que antes y, además, que el perfil del propietario exista y no tenga
--     `deleted_at`. El UPDATE la exige en USING y en WITH CHECK.
--   - Sin cambios: `rooms_admin_all`, el trigger de moderación
--     (`trg_rooms_moderation`), GRANT, funciones y triggers. `service_role`
--     (BYPASSRLS) no se ve afectado.
--   - No oculta las habitaciones de una cuenta desactivada: esa visibilidad
--     es la decisión R7, pendiente.
--
-- Sin recursión: las subconsultas leen `profiles`, cuya RLS deja al usuario
-- leer su propia fila aunque esté eliminada (`profiles_select_own_even_if_deleted`)
-- y ninguna de cuyas políticas consulta tablas de habitaciones, y `rooms`,
-- cuyas políticas no consultan `room_addresses` ni `room_images`. Si la
-- lectura del propio perfil dejara de estar permitida, la condición fallaría
-- cerrada (sin escrituras), nunca abierta.
-- Columnas siempre cualificadas (ver la lección de `messages` en SECURITY.md).
-- Total: 18 tablas y 44 políticas (37 − 3 + 10).

-- ------------------------------------------------------------
-- 1. rooms
-- ------------------------------------------------------------
drop policy "rooms_owner_write" on public.rooms;

create policy "rooms_insert_own" on public.rooms
  for insert to authenticated
  with check (
    auth.uid() = rooms.owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = rooms.owner_id and p.deleted_at is null
    )
  );

create policy "rooms_update_own" on public.rooms
  for update to authenticated
  using (
    auth.uid() = rooms.owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = rooms.owner_id and p.deleted_at is null
    )
  )
  with check (
    auth.uid() = rooms.owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = rooms.owner_id and p.deleted_at is null
    )
  );

create policy "rooms_delete_own" on public.rooms
  for delete to authenticated
  using (
    auth.uid() = rooms.owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = rooms.owner_id and p.deleted_at is null
    )
  );

-- ------------------------------------------------------------
-- 2. room_addresses: lectura igual, escritura solo con cuenta activa
-- ------------------------------------------------------------
drop policy "room_addresses_owner_only" on public.room_addresses;

create policy "room_addresses_select_own" on public.room_addresses
  for select to authenticated
  using (
    exists (
      select 1 from public.rooms r
      where r.id = room_addresses.room_id and r.owner_id = auth.uid()
    )
  );

create policy "room_addresses_insert_own" on public.room_addresses
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_addresses.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  );

create policy "room_addresses_update_own" on public.room_addresses
  for update to authenticated
  using (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_addresses.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_addresses.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  );

create policy "room_addresses_delete_own" on public.room_addresses
  for delete to authenticated
  using (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_addresses.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  );

-- ------------------------------------------------------------
-- 3. room_images: la lectura sigue en `room_images_select`
-- ------------------------------------------------------------
drop policy "room_images_owner_write" on public.room_images;

create policy "room_images_insert_own" on public.room_images
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_images.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  );

create policy "room_images_update_own" on public.room_images
  for update to authenticated
  using (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_images.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_images.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  );

create policy "room_images_delete_own" on public.room_images
  for delete to authenticated
  using (
    exists (
      select 1 from public.rooms r
      join public.profiles p on p.id = r.owner_id
      where r.id = room_images.room_id
        and r.owner_id = auth.uid()
        and p.deleted_at is null
    )
  );
