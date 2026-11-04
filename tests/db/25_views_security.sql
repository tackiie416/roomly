-- Guardas generales de vistas (sesión 73), primera etapa del endurecimiento
-- tras el hotfix 20261014120000. Miran los privilegios EFECTIVOS y las ACL
-- de TODAS las vistas (y vistas materializadas) de `public`, no solo de
-- public_profile_previews. Este archivo debe fallar si:
--   - aparece una vista `security_invoker = false` que no esté en la lista de
--     excepciones aprobadas (hoy solo public_profile_previews);
--   - una vista con `security_invoker = false` (también la aprobada) tiene
--     cualquier privilegio de PUBLIC, anon o authenticated, aunque solo sea
--     SELECT: se ejecuta como su dueño y se salta la RLS al leer;
--   - cualquier vista da INSERT, UPDATE, DELETE o TRUNCATE (de tabla o de
--     columna) a PUBLIC, anon o authenticated, también si es
--     `security_invoker = true`: no se da por hecho que la RLS de la tabla
--     de debajo lo cubre;
--   - una vista materializada (sin RLS) tiene privilegios de esos roles.
-- Los controles (bloques begin/rollback) crean vistas de prueba, con los
-- privilegios concedidos A PROPÓSITO (sin depender de los privilegios por
-- defecto), y comprueban que la guarda las detecta y qué pasa de verdad al
-- usarlas. A: cuenta activa. B: otra cuenta activa.

reset role;
insert into auth.users (id, email) values
  ('25000000-0000-0000-0000-00000000000a', 'views-a@test'),
  ('25000000-0000-0000-0000-00000000000b', 'views-b@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('25000000-0000-0000-0000-00000000000a', 'Vistas A', '2001-01-01', 'looking_for_room', 'user'),
  ('25000000-0000-0000-0000-00000000000b', 'Vistas B', '2001-01-01', 'looking_for_room', 'user');

-- Vistas inseguras de public: (vista, motivo). Excepción aprobada de
-- `security_invoker = false`: solo los nombres de p_definer_ok.
create function roomly_test.unsafe_views(p_definer_ok text[])
returns table (view_name text, reason text)
language sql stable as $$
  with v as (
    select c.oid, c.relname::text as relname, c.relkind,
           coalesce((select bool_or(opt ~* '^security_invoker=(true|on|yes|1)$')
                     from unnest(c.reloptions) opt), false) as invoker
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
  ),
  roles as (select unnest(array['public', 'anon', 'authenticated']) as rol),
  privs as (
    select v.relname, r.rol, p.priv
    from v cross join roles r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                            'REFERENCES', 'TRIGGER']) p(priv)
    where has_table_privilege(r.rol, v.oid, p.priv)
    union
    select v.relname, r.rol, p.priv || ' (columna)'
    from v cross join roles r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(priv)
    where has_any_column_privilege(r.rol, v.oid, p.priv)
  )
  select v.relname, 'security_invoker = false sin excepción aprobada'
  from v where v.relkind = 'v' and not v.invoker and v.relname <> all (p_definer_ok)
  union all
  select v.relname, 'security_invoker = false con privilegios de clientes'
  from v where v.relkind = 'v' and not v.invoker
    and exists (select 1 from privs p where p.relname = v.relname)
  union all
  select v.relname, 'escritura de clientes'
  from v where exists (
    select 1 from privs p where p.relname = v.relname
      and split_part(p.priv, ' ', 1) in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
  union all
  select v.relname, 'materializada con privilegios de clientes'
  from v where v.relkind = 'm' and exists (select 1 from privs p where p.relname = v.relname)
  union all
  select v.relname, 'ACL con PUBLIC'
  from v where exists (
    select 1 from pg_class c, aclexplode(c.relacl) a
    where c.oid = v.oid and a.grantee = 0)
$$;

-- ------------------------------------------------------------
-- 0. El esquema actual no tiene ninguna vista insegura
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (select 1 from roomly_test.unsafe_views(array['public_profile_previews'])),
  'VW0: ninguna vista de public es insegura (privilegios efectivos y ACL)');
select roomly_test.ok(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce((select bool_or(opt ~* '^security_invoker=(true|on|yes|1)$')
                       from unnest(c.reloptions) opt), false))
  = array['public_profile_previews'],
  'VW0: la única vista security_invoker = false es la excepción aprobada (public_profile_previews)');
select roomly_test.ok(
  (select count(*) from roomly_test.unsafe_views(array[]::text[])) = 1,
  'VW0: sin la excepción, la guarda señala public_profile_previews (la lista de excepciones es efectiva)');

-- ------------------------------------------------------------
-- 1. Vista definer con escritura: la guarda la detecta (y es el fallo del hotfix)
-- ------------------------------------------------------------
begin;
create view public.zz_vw25_definer as
  select id, full_name, role from public.profiles where deleted_at is null;
grant all on public.zz_vw25_definer to anon, authenticated;
select roomly_test.ok(
  (select array_agg(reason order by reason) from roomly_test.unsafe_views(array['public_profile_previews'])
   where view_name = 'zz_vw25_definer')
  = array['escritura de clientes', 'security_invoker = false con privilegios de clientes',
          'security_invoker = false sin excepción aprobada'],
  'VW1: una vista definer nueva con ALL para clientes se detecta por los tres motivos');
set role authenticated;
select roomly_test.login('25000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.zz_vw25_definer set role = 'admin'
    where id = '25000000-0000-0000-0000-00000000000a'$$,
  1, 'VW1: y de verdad deja a A ponerse role = admin (por eso se bloquea)');
reset role;
rollback;

-- ------------------------------------------------------------
-- 2. Vista definer con solo SELECT: un GRANT «inocuo» que se salta la RLS
-- ------------------------------------------------------------
begin;
create view public.zz_vw25_readonly as
  select id, full_name from public.profiles where deleted_at is null;
revoke all on public.zz_vw25_readonly from public, anon, authenticated;
grant select on public.zz_vw25_readonly to authenticated;
select roomly_test.ok(
  (select array_agg(reason order by reason) from roomly_test.unsafe_views(array['public_profile_previews'])
   where view_name = 'zz_vw25_readonly')
  = array['security_invoker = false con privilegios de clientes',
          'security_invoker = false sin excepción aprobada'],
  'VW2: una vista definer con solo SELECT también se detecta');
set role authenticated;
select roomly_test.login('25000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id = '25000000-0000-0000-0000-00000000000b'$$,
  0, 'VW2: por la tabla, A no ve el perfil de B (RLS)');
select roomly_test.expect_rows(
  $$select 1 from public.zz_vw25_readonly where id = '25000000-0000-0000-0000-00000000000b'$$,
  1, 'VW2: por la vista definer, A sí lo ve: la RLS no protege un SELECT «inocuo»');
reset role;
rollback;

-- ------------------------------------------------------------
-- 3. Vista security_invoker = true con escritura: se detecta, aunque la
--    tabla de debajo siga aplicando su GRANT y su RLS
-- ------------------------------------------------------------
begin;
create view public.zz_vw25_invoker with (security_invoker = true) as
  select id, full_name, role from public.profiles;
grant all on public.zz_vw25_invoker to anon, authenticated;
select roomly_test.ok(
  (select array_agg(reason order by reason) from roomly_test.unsafe_views(array['public_profile_previews'])
   where view_name = 'zz_vw25_invoker')
  = array['escritura de clientes'],
  'VW3: una vista invoker con escritura de clientes se detecta (no se confía en la RLS de debajo)');
set role authenticated;
select roomly_test.login('25000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$update public.zz_vw25_invoker set role = 'admin'
    where id = '25000000-0000-0000-0000-00000000000a'$$,
  '42501', 'VW3: por la vista invoker, A no se pone admin (GRANT por columnas de profiles)');
select roomly_test.expect_affected(
  $$update public.zz_vw25_invoker set full_name = 'Cambiado'
    where id = '25000000-0000-0000-0000-00000000000b'$$,
  0, 'VW3: ni cambia el perfil de B (RLS de profiles: 0 filas)');
select roomly_test.expect_affected(
  $$update public.zz_vw25_invoker set full_name = 'Vistas A2'
    where id = '25000000-0000-0000-0000-00000000000a'$$,
  1, 'VW3: solo lo que ya permite profiles (su propio nombre)');
reset role;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$update public.zz_vw25_invoker set full_name = 'X'
    where id = '25000000-0000-0000-0000-00000000000b'$$,
  '42501', 'VW3: anon tampoco escribe (sin UPDATE en profiles)');
reset role;
rollback;

-- ------------------------------------------------------------
-- 4. El patrón aprobado: invoker, REVOKE ALL a los tres roles y GRANT mínimo
-- ------------------------------------------------------------
begin;
create view public.zz_vw25_ok with (security_invoker = true) as
  select id, full_name from public.profiles;
revoke all on public.zz_vw25_ok from public, anon, authenticated;
grant select on public.zz_vw25_ok to authenticated;
select roomly_test.ok(
  not exists (select 1 from roomly_test.unsafe_views(array['public_profile_previews'])
              where view_name = 'zz_vw25_ok'),
  'VW4: una vista invoker sin escritura y con SELECT explícito no se señala');
set role authenticated;
select roomly_test.login('25000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.zz_vw25_ok where id = '25000000-0000-0000-0000-00000000000b'$$,
  0, 'VW4: y lee con la RLS de profiles (A no ve a B)');
reset role;
rollback;

-- ------------------------------------------------------------
-- 5–7. PUBLIC, privilegios por columnas y vistas materializadas
-- ------------------------------------------------------------
begin;
create view public.zz_vw25_public with (security_invoker = true) as
  select id, full_name from public.profiles;
revoke all on public.zz_vw25_public from public, anon, authenticated;
grant insert on public.zz_vw25_public to public;
select roomly_test.ok(
  (select array_agg(reason order by reason) from roomly_test.unsafe_views(array['public_profile_previews'])
   where view_name = 'zz_vw25_public')
  = array['ACL con PUBLIC', 'escritura de clientes'],
  'VW5: un INSERT concedido a PUBLIC se detecta (privilegio efectivo y ACL)');
rollback;
begin;
create view public.zz_vw25_column with (security_invoker = true) as
  select id, full_name from public.profiles;
revoke all on public.zz_vw25_column from public, anon, authenticated;
grant update (full_name) on public.zz_vw25_column to anon;
select roomly_test.ok(
  (select array_agg(reason) from roomly_test.unsafe_views(array['public_profile_previews'])
   where view_name = 'zz_vw25_column')
  = array['escritura de clientes'],
  'VW6: un UPDATE por columnas para anon se detecta');
rollback;
begin;
create materialized view public.zz_vw25_mat as select id, name from public.cities;
revoke all on public.zz_vw25_mat from public, anon, authenticated;
grant select on public.zz_vw25_mat to anon;
select roomly_test.ok(
  (select array_agg(reason) from roomly_test.unsafe_views(array['public_profile_previews'])
   where view_name = 'zz_vw25_mat')
  = array['materializada con privilegios de clientes'],
  'VW7: una vista materializada (sin RLS) legible por anon se detecta');
rollback;

-- ------------------------------------------------------------
-- 8. Los controles se deshicieron
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'zz_vw25_%')
  and (select role = 'user' from public.profiles where id = '25000000-0000-0000-0000-00000000000a')
  and not exists (select 1 from roomly_test.unsafe_views(array['public_profile_previews'])),
  'VW8: no queda ninguna vista de prueba y los perfiles no cambiaron');
