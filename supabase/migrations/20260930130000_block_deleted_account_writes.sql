-- ============================================================
-- Bloquear escrituras de cuentas eliminadas (decisión B, auditoría 2.3)
-- ============================================================
-- Semántica (decisión del usuario): `profiles.deleted_at IS NOT NULL`
-- significa cuenta completamente desactivada. Hasta ahora solo lo impedía
-- la aplicación (guards, acciones y servicios); las políticas no miraban
-- `deleted_at`, así que una cuenta eliminada con un JWT todavía válido
-- podía escribir sus filas por PostgREST. RLS se evalúa en cada consulta
-- contra el valor actual de `deleted_at`: no depende de que el JWT caduque.
--
-- Alcance: solo escrituras propias de `profiles` y `housing_preferences`.
--   - La lectura no cambia: mismas condiciones que antes (el propietario
--     sigue viendo su perfil y sus preferencias aunque esté eliminado).
--   - `profiles_admin_all` y `profiles_insert_own` no se tocan (el INSERT ya
--     exige `deleted_at is null` y `deleted_at` está fuera de su GRANT).
--   - `service_role` (BYPASSRLS) no se ve afectado.
--   - Sin cambios de GRANT, funciones ni triggers.
-- Columnas siempre cualificadas (ver la lección de `messages` en SECURITY.md).

-- ------------------------------------------------------------
-- 1. profiles: UPDATE propio solo con la cuenta activa
-- ------------------------------------------------------------
-- USING filtra la fila (0 filas afectadas); WITH CHECK impide además que la
-- fila resultante quede eliminada (defensa extra: `deleted_at` ya está
-- fuera del GRANT de UPDATE de `authenticated`).
drop policy "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = profiles.id and profiles.deleted_at is null)
  with check (auth.uid() = profiles.id and profiles.deleted_at is null);

-- ------------------------------------------------------------
-- 2. housing_preferences: lectura igual, escritura solo con cuenta activa
-- ------------------------------------------------------------
-- `housing_preferences_own` (FOR ALL) se divide en cuatro políticas. La de
-- SELECT conserva exactamente la condición anterior. Las de escritura añaden
-- que el perfil de la sesión exista y no esté eliminado. La subconsulta se
-- evalúa con el RLS de `profiles`, que deja al propietario leer su propia
-- fila aunque esté eliminada (`profiles_select_own_even_if_deleted`); si
-- esa lectura dejara de estar permitida, la condición fallaría cerrada
-- (sin escrituras), nunca abierta. No hay recursión: ninguna política de
-- `profiles` consulta `housing_preferences`.
drop policy "housing_preferences_own" on public.housing_preferences;

create policy "housing_preferences_select_own" on public.housing_preferences
  for select to authenticated
  using (auth.uid() = housing_preferences.profile_id);

create policy "housing_preferences_insert_own" on public.housing_preferences
  for insert to authenticated
  with check (
    auth.uid() = housing_preferences.profile_id
    and exists (
      select 1 from public.profiles p
      where p.id = housing_preferences.profile_id and p.deleted_at is null
    )
  );

create policy "housing_preferences_update_own" on public.housing_preferences
  for update to authenticated
  using (
    auth.uid() = housing_preferences.profile_id
    and exists (
      select 1 from public.profiles p
      where p.id = housing_preferences.profile_id and p.deleted_at is null
    )
  )
  with check (
    auth.uid() = housing_preferences.profile_id
    and exists (
      select 1 from public.profiles p
      where p.id = housing_preferences.profile_id and p.deleted_at is null
    )
  );

create policy "housing_preferences_delete_own" on public.housing_preferences
  for delete to authenticated
  using (
    auth.uid() = housing_preferences.profile_id
    and exists (
      select 1 from public.profiles p
      where p.id = housing_preferences.profile_id and p.deleted_at is null
    )
  );
