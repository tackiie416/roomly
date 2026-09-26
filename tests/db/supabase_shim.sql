-- Shim mínimo de Supabase para tests de RLS contra un PostgreSQL local.
-- SOLO PARA TESTS: nunca se aplica a un proyecto Supabase real (allí
-- `auth`, `auth.uid()` y los roles ya existen).
--
-- Reproduce lo que las migraciones de ROOMLY necesitan de Supabase:
--   - roles anon / authenticated / service_role (este último con BYPASSRLS),
--   - schema auth con auth.users y auth.uid() leyendo el JWT de la petición
--     desde el GUC request.jwt.claims (igual que PostgREST),
--   - los privilegios por defecto que Supabase concede sobre `public`
--     (ALL a anon/authenticated/service_role), para que los tests reflejen
--     el punto de partida real y no uno más restrictivo.
-- Limitación: no es Supabase. Cuando exista un proyecto real (o
-- `supabase start`), estos mismos tests deben correr también allí.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- Permite hacer SET ROLE a estos roles desde el usuario que ejecuta los tests.
grant anon, authenticated, service_role to current_user;

create schema auth;
create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
