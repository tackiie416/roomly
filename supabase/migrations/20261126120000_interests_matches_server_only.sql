-- ============================================================
-- Fase 5.1 — «Me interesa» y match mutuo, solo desde el servidor
-- ============================================================
-- Autorizada por el propietario el 2026-11-25 (inicio de la Fase 5).
--
-- Antes de esta migración, `interests_insert_own` dejaba a cualquier usuario
-- autenticado crear por PostgREST un interés hacia CUALQUIER perfil (también
-- desactivado, admin o sin onboarding) y sin pasar los filtros duros de la
-- Fase 3: una vía de spam y de enumeración de ids. Y nada impedía a
-- service_role crear un match sin interés mutuo.
--
-- 1. Privilegios: los clientes ya no escriben en `interests` ni en `matches`.
--    `anon` no tiene nada; `authenticated` solo SELECT (sus políticas de
--    lectura de participante no cambian). service_role conserva todo.
-- 2. Se eliminan `interests_insert_own` e `interests_delete_own`: sin
--    privilegio no hacían nada, y sin ellas un GRANT futuro no reabre la
--    escritura por sí solo. Pasan de 42 a 40 políticas.
-- 3. Triggers de integridad que se aplican A TODOS LOS ROLES, también a
--    service_role (que tiene BYPASSRLS):
--    - `trg_interests_integrity`: un interés no se modifica (se retira y se
--      vuelve a enviar); las dos cuentas existen, están activas, tienen el
--      onboarding completo y no son admin; el contexto de habitación, si lo
--      hay, es una habitación visible públicamente de quien recibe el interés.
--    - `trg_matches_integrity`: un match no se modifica; al crearse, existen
--      los DOS intereses (A→B y B→A) y las dos cuentas están activas.
-- 4. Funciones `record_interest` y `withdraw_interest`, SECURITY INVOKER y
--    con EXECUTE solo para service_role (el patrón de delete_own_room). El
--    servidor (lib/services/interests.ts) comprueba antes la sesión, la cuenta
--    y que la pareja pasa los filtros duros, y calcula el score con el motor
--    de TypeScript (regla 6: nunca en SQL). Las funciones serializan cada
--    pareja con un bloqueo de transacción: si A y B se envían el interés a la
--    vez, uno de los dos ve el del otro y crea el match (sin la carrera de
--    «los dos comprueban antes de que el otro confirme»).
--
-- Columnas siempre cualificadas (ver la lección de `messages` en
-- docs/SECURITY.md). Sin cambios de columnas ni de datos.

-- ------------------------------------------------------------
-- 1. Sin escritura de clientes
-- ------------------------------------------------------------
revoke all on public.interests from public, anon;
revoke all on public.matches from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on public.interests from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.matches from authenticated;
grant select on public.interests to authenticated;
grant select on public.matches to authenticated;

-- ------------------------------------------------------------
-- 2. Las políticas de escritura del cliente ya no tienen uso
-- ------------------------------------------------------------
drop policy "interests_insert_own" on public.interests;
drop policy "interests_delete_own" on public.interests;

-- ------------------------------------------------------------
-- 3a. Integridad de interests (todos los roles)
-- ------------------------------------------------------------
-- Errores, con un prefijo estable (lib/services/interests.ts los traduce):
--   - interest_immutable (23514): UPDATE de un interés;
--   - interest_party_invalid (23514): alguna de las dos cuentas no existe,
--     está desactivada, no ha terminado el onboarding o es admin;
--   - interest_room_invalid (23514): el contexto de habitación no es una
--     habitación visible públicamente de quien recibe el interés.
-- Los perfiles se bloquean con FOR SHARE: una desactivación simultánea espera
-- a que termine el interés, o el interés ve la cuenta desactivada.
create function public.enforce_interests_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n_valid int;
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'interest_immutable: un interés no se modifica; se retira y se vuelve a enviar';
  end if;

  select count(*) into n_valid
  from (
    select p.id
    from public.profiles p
    where p.id in (new.from_user_id, new.to_user_id)
      and p.deleted_at is null
      and p.onboarding_completed_at is not null
      and p.role <> 'admin'
    for share
  ) valid;
  if n_valid <> 2 then
    raise exception using
      errcode = '23514',
      message = 'interest_party_invalid: alguna de las dos cuentas no puede enviar ni recibir intereses';
  end if;

  if new.room_id is not null then
    -- El mismo criterio que is_room_publicly_visible (R7), en línea: esa
    -- función solo la pueden ejecutar anon y authenticated. Quien recibe ya
    -- está comprobado como cuenta activa, arriba.
    if not exists (
      select 1 from public.rooms r
      where r.id = new.room_id
        and r.owner_id = new.to_user_id
        and r.status = 'active'
        and r.deleted_at is null
    ) then
      raise exception using
        errcode = '23514',
        message = 'interest_room_invalid: la habitación no es visible o no es de quien recibe el interés';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_interests_integrity() from public, anon, authenticated;

create trigger trg_interests_integrity
  before insert or update on public.interests
  for each row execute function public.enforce_interests_integrity();

-- ------------------------------------------------------------
-- 3b. Integridad de matches (todos los roles)
-- ------------------------------------------------------------
--   - match_immutable (23514): UPDATE de un match;
--   - match_not_mutual (23514): falta alguno de los dos intereses;
--   - match_party_invalid (23514): alguna cuenta no existe o está desactivada.
create function public.enforce_matches_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'match_immutable: un match no se modifica';
  end if;

  if not exists (
       select 1 from public.interests i
       where i.from_user_id = new.user_a_id and i.to_user_id = new.user_b_id)
     or not exists (
       select 1 from public.interests i
       where i.from_user_id = new.user_b_id and i.to_user_id = new.user_a_id) then
    raise exception using
      errcode = '23514',
      message = 'match_not_mutual: un match necesita el interés de las dos personas';
  end if;

  if (select count(*) from public.profiles p
      where p.id in (new.user_a_id, new.user_b_id) and p.deleted_at is null) <> 2 then
    raise exception using
      errcode = '23514',
      message = 'match_party_invalid: alguna de las dos cuentas está desactivada';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_matches_integrity() from public, anon, authenticated;

create trigger trg_matches_integrity
  before insert or update on public.matches
  for each row execute function public.enforce_matches_integrity();

-- ------------------------------------------------------------
-- 4a. record_interest: enviar un interés y, si es mutuo, crear el match
-- ------------------------------------------------------------
-- Devuelve:
--   - 'sent': interés nuevo, sin el de la otra persona;
--   - 'already_sent': ya existía este interés y todavía no hay match;
--   - 'matched': hay match (recién creado o ya existente).
-- Errores: interest_invalid (22004) sin argumentos o consigo mismo;
-- interest_score_invalid (22003) con un score fuera de 0–100;
-- interest_isolation (P0001) fuera de READ COMMITTED (como delete_own_room:
-- con una instantánea de toda la transacción, quien espera el bloqueo no
-- vería el interés que la otra persona acaba de confirmar y el match se
-- perdería); y los de los triggers (interest_party_invalid,
-- interest_room_invalid y rate_limit_exceeded, de 20260925120000).
create function public.record_interest(
  p_from uuid,
  p_to uuid,
  p_score integer,
  p_room_id uuid default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_inserted int;
  user_a uuid;
  user_b uuid;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception using
      errcode = '22004',
      message = 'interest_invalid: faltan las personas o son la misma';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'interest_isolation: los intereses necesitan READ COMMITTED';
  end if;
  if p_score is null or p_score < 0 or p_score > 100 then
    raise exception using
      errcode = '22003',
      message = 'interest_score_invalid: el score tiene que estar entre 0 y 100';
  end if;

  user_a := least(p_from, p_to);
  user_b := greatest(p_from, p_to);
  -- Una pareja a la vez (en los dos sentidos), hasta el final de la transacción.
  perform pg_advisory_xact_lock(hashtextextended(user_a::text || ':' || user_b::text, 5));

  if exists (select 1 from public.matches m where m.user_a_id = user_a and m.user_b_id = user_b) then
    return 'matched';
  end if;

  insert into public.interests (from_user_id, to_user_id, room_id)
  values (p_from, p_to, p_room_id)
  on conflict (from_user_id, to_user_id) do nothing;
  get diagnostics n_inserted = row_count;

  if not exists (
    select 1 from public.interests i
    where i.from_user_id = p_to and i.to_user_id = p_from
  ) then
    return case when n_inserted = 1 then 'sent' else 'already_sent' end;
  end if;

  insert into public.matches (user_a_id, user_b_id, room_id, compatibility_score)
  values (user_a, user_b, null, p_score)
  on conflict (user_a_id, user_b_id) do nothing;
  return 'matched';
end;
$$;

revoke all on function public.record_interest(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.record_interest(uuid, uuid, integer, uuid) to service_role;

-- ------------------------------------------------------------
-- 4b. withdraw_interest: retirar un interés enviado, si no hay match
-- ------------------------------------------------------------
-- Devuelve 'withdrawn', 'not_found' (no había interés) o 'matched' (ya hay
-- match: no se retira; deshacer un match es una decisión de la Fase 6).
-- Mismos errores de argumentos y de aislamiento que record_interest.
create function public.withdraw_interest(p_from uuid, p_to uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_deleted int;
  user_a uuid;
  user_b uuid;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception using
      errcode = '22004',
      message = 'interest_invalid: faltan las personas o son la misma';
  end if;

  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'interest_isolation: los intereses necesitan READ COMMITTED';
  end if;

  user_a := least(p_from, p_to);
  user_b := greatest(p_from, p_to);
  perform pg_advisory_xact_lock(hashtextextended(user_a::text || ':' || user_b::text, 5));

  if exists (select 1 from public.matches m where m.user_a_id = user_a and m.user_b_id = user_b) then
    return 'matched';
  end if;

  delete from public.interests i
  where i.from_user_id = p_from and i.to_user_id = p_to;
  get diagnostics n_deleted = row_count;
  return case when n_deleted = 1 then 'withdrawn' else 'not_found' end;
end;
$$;

revoke all on function public.withdraw_interest(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.withdraw_interest(uuid, uuid) to service_role;
