-- ============================================================
-- Fase 2.5 — integridad de housing_preferences tras el onboarding
-- ============================================================
-- Migración nueva; no edita ninguna anterior. Tres reglas:
--
--   1. Riesgo C de la auditoría de 2.3: con el onboarding completado
--      (`profiles.onboarding_completed_at` no nulo), las preferencias no
--      pueden quedarse sin ciudad. `trg_profiles_onboarding_completion`
--      (2.3) solo comprobaba la escritura del timestamp, no la dirección
--      contraria. Trigger en `housing_preferences`, para todos los roles
--      (también el servidor): es un invariante de los datos.
--   2. Riesgo C, borrado: con el onboarding completado, el cliente no puede
--      borrar su fila de preferencias. Se hace en la política de DELETE
--      (RLS), no con un trigger: así el borrado en cascada de un perfil
--      (`on delete cascade`, borrado de cuenta futuro con service_role) no
--      queda bloqueado. Un DELETE bloqueado afecta a 0 filas.
--   3. Universidad ↔ ciudad (hasta ahora solo en la aplicación,
--      `checkUniversityCity`): una universidad con ciudad solo vale con esa
--      ciudad. Mismo patrón que el trigger de barrios de 2.0. Una
--      universidad sin ciudad (`universities.city_id` nulo) vale con
--      cualquiera. Una universidad inexistente la sigue rechazando la FK.
--
-- Funciones SECURITY INVOKER con search_path vacío y EXECUTE revocado: solo
-- leen la fila del propio perfil (que su dueño puede leer por RLS, también
-- eliminado) y `universities` (lectura pública). Sin recursión: ninguna
-- política de `profiles` ni de `universities` consulta `housing_preferences`.
-- Sin cambios de GRANT ni de columnas. Siguen 38 políticas (una se recrea).

-- ------------------------------------------------------------
-- 1. Ciudad obligatoria con el onboarding completado
-- ------------------------------------------------------------
create or replace function public.enforce_housing_city_after_onboarding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.city_id is not null then
    return new;
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = new.profile_id and p.onboarding_completed_at is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'housing_city_required: con el onboarding completado la ciudad es obligatoria';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_housing_city_after_onboarding()
  from public, anon, authenticated;

create trigger trg_housing_preferences_city_required
  before insert or update of city_id on public.housing_preferences
  for each row execute function public.enforce_housing_city_after_onboarding();

-- ------------------------------------------------------------
-- 2. DELETE propio: cuenta activa y onboarding sin completar
-- ------------------------------------------------------------
-- Recrea la política de 20260930130000 añadiendo
-- `p.onboarding_completed_at is null` a la misma subconsulta.
drop policy "housing_preferences_delete_own" on public.housing_preferences;
create policy "housing_preferences_delete_own" on public.housing_preferences
  for delete to authenticated
  using (
    auth.uid() = housing_preferences.profile_id
    and exists (
      select 1 from public.profiles p
      where p.id = housing_preferences.profile_id
        and p.deleted_at is null
        and p.onboarding_completed_at is null
    )
  );

-- ------------------------------------------------------------
-- 3. Universidad de la ciudad elegida
-- ------------------------------------------------------------
create or replace function public.enforce_housing_preferences_university()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_university_city uuid;
begin
  if new.university_id is null then
    return new;
  end if;
  select u.city_id into v_university_city
  from public.universities u
  where u.id = new.university_id;
  -- Inexistente (la FK la rechaza) o sin ciudad (vale con cualquiera).
  if not found or v_university_city is null then
    return new;
  end if;
  -- Ciudad inexistente: que la rechace su FK (23503), con su mensaje.
  if new.city_id is not null
     and not exists (select 1 from public.cities c where c.id = new.city_id) then
    return new;
  end if;
  if new.city_id is distinct from v_university_city then
    raise exception using
      errcode = '23514',
      message = 'housing_university: la universidad no pertenece a la ciudad elegida';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_housing_preferences_university()
  from public, anon, authenticated;

create trigger trg_housing_preferences_university
  before insert or update of city_id, university_id on public.housing_preferences
  for each row execute function public.enforce_housing_preferences_university();
