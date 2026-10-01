-- ROOMLY — Fase 2.0: endurecimiento de datos y permisos de perfil/preferencias
-- (ver PROGRESS.md, sesión 9, y docs/DATABASE.md §"Fase 2.0").
--
-- Migración NUEVA: las anteriores quedan intactas. No relaja ninguna política.
--
-- Qué hace:
--   1. CHECKs de longitud/forma en `profiles` (M4: una escritura directa vía
--      PostgREST se salta Zod; la base de datos es la última barrera).
--   2. CHECKs en `housing_preferences`: presupuesto y compañeros no
--      negativos y con mínimo <= máximo (sin techos: no los define la
--      especificación), y longitud de `field_of_study`.
--   3. GRANT por columnas en `housing_preferences`: nadie reasigna
--      `profile_id` con UPDATE y `anon` no tiene ningún privilegio.
--   4. Política de `housing_preferences` explícita: solo `authenticated`, con
--      USING y WITH CHECK escritos (antes el WITH CHECK era implícito).
--   5. Integridad de `preferred_neighborhood_ids` con triggers, en las dos
--      direcciones (PostgreSQL no admite subconsultas en un CHECK ni FKs sobre
--      elementos de un array):
--        - housing_preferences: cada barrio existe y es de `city_id`;
--        - neighborhoods: no se borra ni se cambia de ciudad un barrio que
--          alguna preferencia usa (error explícito, nunca cascada silenciosa).
--
-- Qué NO hace, a propósito: Storage, borrado de cuenta, Auth y UI (fuera de
-- la Fase 2.0).
--
-- Se aplica una sola vez, como las demás migraciones. No usa `if not exists`:
-- si algún objeto ya existiera, la migración falla en vez de ocultarlo. Si una
-- base de datos tuviera filas que violen los CHECKs, también falla entera (sin
-- NOT VALID) en vez de dejarlas pasar en silencio.

-- ============================================================
-- 1. PROFILES
-- ============================================================
-- full_name: obligatorio (ya NOT NULL), sin cadenas vacías o solo espacios,
-- máximo 100 caracteres (nombre y apellidos que caben en una tarjeta).
alter table public.profiles
  add constraint chk_profiles_full_name
  check (char_length(btrim(full_name)) between 1 and 100);

-- bio: opcional, máximo 500 caracteres (descripción breve de la sección 7).
alter table public.profiles
  add constraint chk_profiles_bio_length
  check (bio is null or char_length(bio) <= 500);

-- avatar_url: opcional; solo https y máximo 2048 caracteres. La columna es
-- escribible por el propio usuario, así que se impiden `javascript:`,
-- `data:` y similares antes de que exista la subida de fotos.
alter table public.profiles
  add constraint chk_profiles_avatar_url
  check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://'));

-- seeking_status ya es un enum (valores cerrados) y date_of_birth ya tiene
-- chk_min_age: no se añade nada.

-- ============================================================
-- 2. HOUSING_PREFERENCES
-- ============================================================
-- field_of_study: opcional, sin cadena vacía, máximo 120 caracteres.
alter table public.housing_preferences
  add constraint chk_housing_preferences_field_of_study
  check (field_of_study is null or char_length(btrim(field_of_study)) between 1 and 120);

-- Presupuesto: ya existían budget_min >= 0 (chk_budget_positive) y
-- budget_min <= budget_max (chk_budget_range); faltaba budget_max >= 0.
-- Sin techo a propósito: la especificación no define ninguno, y fijarlo es
-- una decisión explícita de producto, no técnica.
alter table public.housing_preferences
  add constraint chk_housing_preferences_budget_max_nonneg
  check (budget_max is null or budget_max >= 0);

-- Número de compañeros: no negativo y mínimo <= máximo. Sin techo, por el
-- mismo motivo que el presupuesto.
alter table public.housing_preferences
  add constraint chk_housing_preferences_roommates
  check (
    (roommates_wanted_min is null or roommates_wanted_min >= 0)
    and (roommates_wanted_max is null or roommates_wanted_max >= 0)
    and (roommates_wanted_min is null or roommates_wanted_max is null
         or roommates_wanted_min <= roommates_wanted_max)
  );

-- Barrios preferidos: sin límite de cantidad (tampoco lo define la
-- especificación). Que cada UUID exista y pertenezca a city_id lo garantiza
-- el trigger de la sección 5.

-- ============================================================
-- 3. HOUSING_PREFERENCES — GRANT por columnas
-- ============================================================
-- Igual que en profiles: RLS filtra filas, el GRANT limita columnas.
--   - anon: ningún privilegio (RLS ya lo bloqueaba; ahora tampoco lo tiene).
--   - authenticated INSERT: todas las columnas de datos, incluida profile_id
--     (la política exige que sea auth.uid()). updated_at la pone el default.
--   - authenticated UPDATE: las mismas SIN profile_id, así que la fila no se
--     puede reasignar a otra persona. updated_at la pone el trigger.
--   - SELECT y DELETE de authenticated no cambian (siguen sujetos a RLS).
-- Consecuencia, igual que PR8: upsert() no sirve para esta tabla (el
-- ON CONFLICT DO UPDATE incluiría profile_id). Los servicios harán INSERT y
-- UPDATE por separado.
revoke all on public.housing_preferences from anon;
revoke insert, update on public.housing_preferences from authenticated;

grant insert (
  profile_id, city_id, university_id, field_of_study, budget_min, budget_max,
  move_in_date, move_out_date, preferred_neighborhood_ids,
  roommates_wanted_min, roommates_wanted_max
) on public.housing_preferences to authenticated;

grant update (
  city_id, university_id, field_of_study, budget_min, budget_max,
  move_in_date, move_out_date, preferred_neighborhood_ids,
  roommates_wanted_min, roommates_wanted_max
) on public.housing_preferences to authenticated;

-- ============================================================
-- 4. HOUSING_PREFERENCES — política explícita
-- ============================================================
-- Mismo alcance que antes (solo el propietario), ahora limitada a
-- authenticated y con WITH CHECK escrito, con columnas cualificadas.
-- No hay política de admin en esta tabla (tampoco la había): el servidor usa
-- service_role cuando lo necesite, nunca el flujo normal.
drop policy "housing_preferences_own" on public.housing_preferences;
create policy "housing_preferences_own" on public.housing_preferences
  for all to authenticated
  using (auth.uid() = housing_preferences.profile_id)
  with check (auth.uid() = housing_preferences.profile_id);

-- ============================================================
-- 5. INTEGRIDAD DE preferred_neighborhood_ids
-- ============================================================
-- 5a. Al escribir preferencias: cada barrio debe existir y ser de city_id.
-- Array vacío (el default; la columna es NOT NULL) = sin preferencia de zona.
-- Barrios sin ciudad elegida no tienen sentido y se rechazan.
--
-- SECURITY INVOKER (el default) a propósito: la función solo LEE
-- neighborhoods, que es de lectura pública, así que no necesita privilegios
-- extra ni puede usarse para saltarse RLS. Se dispara también al cambiar
-- city_id, para que un cambio de ciudad no deje barrios de la anterior.
create or replace function public.enforce_housing_preferences_neighborhoods()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if cardinality(new.preferred_neighborhood_ids) = 0 then
    return new;
  end if;

  if new.city_id is null then
    raise exception using
      errcode = '23514',
      message = 'housing_neighborhoods: no se pueden elegir barrios sin ciudad';
  end if;

  if exists (
    select 1
    from unnest(new.preferred_neighborhood_ids) as pref(neighborhood_id)
    where not exists (
      select 1 from public.neighborhoods nb where nb.id = pref.neighborhood_id
    )
  ) then
    raise exception using
      errcode = '23503',
      message = 'housing_neighborhoods: algún barrio no existe';
  end if;

  if exists (
    select 1
    from unnest(new.preferred_neighborhood_ids) as pref(neighborhood_id)
    join public.neighborhoods nb on nb.id = pref.neighborhood_id
    where nb.city_id <> new.city_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'housing_neighborhoods: algún barrio no pertenece a la ciudad elegida';
  end if;

  return new;
end;
$$;

create trigger trg_housing_preferences_neighborhoods
  before insert or update of city_id, preferred_neighborhood_ids
  on public.housing_preferences
  for each row execute function public.enforce_housing_preferences_neighborhoods();

-- 5b. Al administrar barrios: no se borra, no se cambia de id ni de ciudad un
-- barrio que alguna preferencia usa. Sin cascadas: quien administra decide
-- qué hacer con esas preferencias antes de repetir la operación. Esto cubre
-- también el borrado de una ciudad (neighborhoods.city_id es ON DELETE
-- CASCADE: el borrado en cascada de sus barrios dispara este trigger).
--
-- SECURITY DEFINER a propósito: housing_preferences solo la lee su
-- propietario (RLS), así que con los permisos de quien administra (un admin
-- autenticado) la comprobación no vería las preferencias ajenas y dejaría
-- pasar el borrado. Por qué es segura: es una función de trigger (no se
-- puede llamar directamente), no recibe parámetros del usuario, solo
-- responde "¿se usa este barrio?" con un error sin datos de terceros,
-- search_path vacío y nombres cualificados, sin SQL dinámico. EXECUTE
-- revocado a PUBLIC, anon y authenticated.
create or replace function public.enforce_neighborhood_not_referenced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.id = old.id
     and new.city_id = old.city_id then
    return new;
  end if;

  if exists (
    select 1 from public.housing_preferences hp
    where old.id = any (hp.preferred_neighborhood_ids)
  ) then
    raise exception using
      errcode = '23503',
      message = 'neighborhood_in_use: el barrio está en las preferencias de algún usuario; no se puede borrar ni cambiar de ciudad';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_neighborhood_not_referenced() from public, anon, authenticated;
revoke all on function public.enforce_housing_preferences_neighborhoods() from public, anon;

create trigger trg_neighborhoods_not_referenced
  before delete or update of id, city_id
  on public.neighborhoods
  for each row execute function public.enforce_neighborhood_not_referenced();

-- Limitación conocida: sin bloqueo entre las dos comprobaciones, una
-- escritura de preferencias y un borrado de barrio simultáneos (solo un admin
-- borra barrios) podrían cruzarse. Se acepta: es una operación administrativa
-- rara y el siguiente INSERT/UPDATE de esa fila vuelve a validarla.
