-- ROOMLY — Fase 3.1: endurecimiento de `compatibility_responses`
-- (ver PROGRESS.md, sesión 31, y docs/DATABASE.md §"Fase 3.1").
--
-- Migración NUEVA: las anteriores quedan intactas. Decisiones D7, D17 y D18
-- de la especificación cerrada de la Fase 3 (2026-10-07):
--
--   - El servidor es el único que escribe (D18): `authenticated` solo lee su
--     propia fila; `anon` no tiene ningún privilegio. La escritura la hace
--     lib/services/compatibility.ts con service_role, después del guard y de
--     validar las respuestas contra la definición del cuestionario en código.
--   - S1: `questionnaire_version` sin DEFAULT y >= 1 (el servidor la fija
--     siempre; un INSERT sin versión es un error, no un 1 silencioso).
--   - S2: `completed_at` admite NULL (borrador) y no tiene DEFAULT.
--   - S3–S6 y el bloqueo de cuentas eliminadas: un trigger para TODOS los
--     roles, también service_role (como el punto A de la 2.9,
--     20261004120000). Las políticas RLS no sirven aquí: service_role tiene
--     BYPASSRLS y el bloqueo RLS de 20260930130000 no le afecta.
--
-- Se aplica una sola vez, como las demás migraciones (sin `if exists`).

-- ============================================================
-- S1 y S2: columnas
-- ============================================================
alter table public.compatibility_responses
  alter column questionnaire_version drop default;
alter table public.compatibility_responses
  add constraint chk_compatibility_responses_version check (questionnaire_version >= 1);

alter table public.compatibility_responses
  alter column completed_at drop not null,
  alter column completed_at drop default;

-- ============================================================
-- Privilegios: anon nada; authenticated solo SELECT (RLS: su fila)
-- ============================================================
-- Los privilegios por defecto de Supabase conceden ALL a anon y
-- authenticated sobre las tablas de `public`; hasta ahora solo los frenaba
-- la política (que, además, no tenía `to` y se evaluaba también para anon).
revoke all on public.compatibility_responses from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.compatibility_responses from authenticated;
grant select on public.compatibility_responses to authenticated;

-- ============================================================
-- RLS: la política FOR ALL pasa a ser solo de lectura propia
-- ============================================================
-- El número de políticas de `public` no cambia (37): una sustituye a otra.
drop policy "compatibility_responses_own" on public.compatibility_responses;
create policy "compatibility_responses_select_own" on public.compatibility_responses
  for select to authenticated
  using (auth.uid() = compatibility_responses.profile_id);

-- ============================================================
-- S3–S6 y cuentas eliminadas: trigger de integridad
-- ============================================================
-- SECURITY INVOKER (el default) y `search_path` vacío, como el resto de
-- triggers de la Fase 2. Lee `profiles` del propio `profile_id`: service_role
-- y el dueño de las tablas no tienen RLS, y `authenticated` ya no puede
-- escribir en esta tabla. Errores `23514` con prefijo estable, que el
-- servicio traduce sin enseñar el mensaje.
--
--   - account_deleted:          el perfil no existe o tiene `deleted_at`
--                               (evita escribir tras desactivar la cuenta,
--                               aunque el guard la viera activa un instante
--                               antes).
--   - compatibility_profile_locked: S6, `profile_id` no cambia nunca.
--   - questionnaire_version_downgrade: S3, la versión no baja.
--   - questionnaire_completed_locked:  S4, con la misma versión, un
--                               `completed_at` ya fijado no cambia (ni a NULL
--                               ni a otra fecha; reescribir el mismo valor sí).
--   S5: al subir de versión, `completed_at` puede ser NULL (borrador de la
--   versión nueva) o un valor nuevo (completado en la misma escritura).
create or replace function public.enforce_compatibility_responses_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id then
    raise exception using
      errcode = '23514',
      message = 'compatibility_profile_locked: el perfil de unas respuestas no se puede cambiar';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = new.profile_id
      and p.deleted_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'account_deleted: la cuenta no existe o está desactivada';
  end if;

  if tg_op = 'UPDATE' then
    if new.questionnaire_version < old.questionnaire_version then
      raise exception using
        errcode = '23514',
        message = 'questionnaire_version_downgrade: la versión del cuestionario no puede bajar';
    end if;

    if new.questionnaire_version = old.questionnaire_version
      and old.completed_at is not null
      and new.completed_at is distinct from old.completed_at
    then
      raise exception using
        errcode = '23514',
        message = 'questionnaire_completed_locked: el cuestionario ya está completado en esta versión';
    end if;
  end if;

  return new;
end;
$$;

-- Solo se ejecuta como trigger: nadie necesita llamarla directamente.
revoke all on function public.enforce_compatibility_responses_integrity()
  from public, anon, authenticated;

create trigger trg_compatibility_responses_integrity
  before insert or update on public.compatibility_responses
  for each row execute function public.enforce_compatibility_responses_integrity();
