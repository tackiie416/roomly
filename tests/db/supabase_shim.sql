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
--     el punto de partida real y no uno más restrictivo,
--   - desde la Fase 4.2, un schema storage con las columnas de
--     storage.buckets y storage.objects que usan las migraciones y las
--     herramientas de ROOMLY, con la RLS activa, sin políticas y con ALL para
--     los tres roles, como en Supabase. No reproduce la API de Storage (subir,
--     firmar URL, borrar el archivo): solo las filas de metadatos.
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

-- Storage (Fase 4.2). En Supabase, estas tablas son de supabase_storage_admin,
-- y la RLS sin políticas deja a anon y authenticated sin acceso; service_role
-- (BYPASSRLS) lo tiene todo. Los índices únicos son los de Supabase (bname y
-- bucketid_objname).
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index bname on storage.buckets (name);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index bucketid_objname on storage.objects (bucket_id, name);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
