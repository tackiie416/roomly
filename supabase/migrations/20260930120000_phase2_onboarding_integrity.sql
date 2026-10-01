-- ROOMLY — Fase 2.3: integridad del onboarding
-- (ver PROGRESS.md, sesión 12, y docs/DATABASE.md §"Fase 2.3").
--
-- Migración NUEVA: las anteriores quedan intactas. No toca RLS ni GRANT.
--
-- A. `profiles.seeking_status` pierde su DEFAULT 'flexible' (sigue NOT NULL).
--    Antes, una fila creada sin enviarlo (INSERT directo vía PostgREST, SQL,
--    servidor) quedaba con 'flexible' y era indistinguible de una elección
--    real. Ahora todo INSERT tiene que enviarlo: cualquier valor guardado fue
--    enviado explícitamente. No hay filas que migrar (el valor de las filas
--    existentes no cambia; solo deja de haber default).
--
-- B. Trigger de integridad de `onboarding_completed_at`: si pasa a no nulo,
--    tiene que existir una fila de `housing_preferences` del mismo perfil con
--    `city_id`. `completeOnboarding` (lib/services/profile.ts) sigue siendo la
--    operación normal y la dueña de la regla completa; esto solo impide que
--    una escritura directa (el GRANT de INSERT/UPDATE de `authenticated`
--    incluye la columna) marque como completo un onboarding sin ciudad.
--
-- Se aplica una sola vez, como las demás migraciones (sin `if not exists`).

-- ============================================================
-- A. seeking_status sin valor por defecto
-- ============================================================
alter table public.profiles alter column seeking_status drop default;

-- ============================================================
-- B. onboarding_completed_at solo con preferencias y ciudad
-- ============================================================
-- SECURITY INVOKER (el default), igual que el trigger de barrios de
-- `housing_preferences`: solo lee la fila de preferencias del propio perfil,
-- que su dueño puede leer por RLS (`housing_preferences_own`, que no consulta
-- `profiles`: no hay recursión). No da privilegios extra ni sirve para
-- saltarse RLS. Consecuencia conservadora: quien no puede leer esas
-- preferencias (p. ej. un admin editando el perfil de otro desde el cliente)
-- no puede marcarlo completo; el servidor con service_role no tiene RLS.
--
-- Se dispara solo si el nuevo valor es no nulo: volver a NULL o no tocar la
-- columna no se comprueba. En un INSERT con valor no nulo siempre falla,
-- porque las preferencias exigen que el perfil exista antes (FK).
create or replace function public.enforce_onboarding_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.onboarding_completed_at is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.housing_preferences hp
    where hp.profile_id = new.id
      and hp.city_id is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'onboarding_incomplete: faltan las preferencias de vivienda con ciudad';
  end if;

  return new;
end;
$$;

-- Solo se ejecuta como trigger: nadie necesita llamarla directamente.
revoke all on function public.enforce_onboarding_completion() from public, anon, authenticated;

create trigger trg_profiles_onboarding_completion
  before insert or update of onboarding_completed_at
  on public.profiles
  for each row execute function public.enforce_onboarding_completion();
