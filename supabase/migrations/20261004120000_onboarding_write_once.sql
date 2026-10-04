-- ROOMLY — Fase 2.9 (punto A de 2.3): `onboarding_completed_at` de una sola
-- escritura (ver PROGRESS.md, sesión 26, y docs/DATABASE.md §"Fase 2.9").
--
-- Migración NUEVA: las anteriores quedan intactas. No toca RLS, GRANT,
-- triggers ni columnas: solo redefine la función del trigger existente
-- `trg_profiles_onboarding_completion` (20260930120000), que ya se dispara
-- en `BEFORE INSERT OR UPDATE OF onboarding_completed_at`.
--
-- Antes: el trigger solo comprobaba el paso a no nulo (exige preferencias con
-- ciudad). Volver a NULL o reescribir el timestamp estaba permitido, y volver
-- a NULL reabría lo que la 2.5 cierra tras completar el onboarding (borrar
-- las preferencias o quitarles la ciudad).
--
-- Ahora, una vez no nulo, el valor no cambia nunca:
--   - timestamp → NULL: rechazado;
--   - timestamp → otro timestamp: rechazado;
--   - el mismo timestamp: permitido (no cambia nada), con la comprobación de
--     preferencias con ciudad de siempre.
-- Error `23514` con el prefijo `onboarding_locked:`.
--
-- Para TODOS los roles (decisión D1 de la 2.9): `authenticated`, admin
-- (`profiles_admin_all`) y `service_role`. Sin bypass: los triggers se
-- aplican aunque el rol no tenga RLS. Reiniciar un onboarding sería una
-- decisión explícita nueva.
--
-- La función conserva lo de 20260930120000: SECURITY INVOKER (el default),
-- `search_path` vacío y nombres cualificados. CREATE OR REPLACE mantiene el
-- propietario y los privilegios; el REVOKE se repite igualmente para que la
-- migración no dependa de ello.
--
-- Se aplica una sola vez, como las demás migraciones.

create or replace function public.enforce_onboarding_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Una sola escritura: en un UPDATE, un valor ya fijado no cambia (tampoco
  -- a NULL). `is distinct from` deja pasar la reescritura del mismo valor.
  if tg_op = 'UPDATE'
    and old.onboarding_completed_at is not null
    and new.onboarding_completed_at is distinct from old.onboarding_completed_at
  then
    raise exception using
      errcode = '23514',
      message = 'onboarding_locked: el onboarding ya está completado y su fecha no se puede cambiar';
  end if;

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
