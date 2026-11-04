-- Hotfix de seguridad (2026-10-31) — public_profile_previews sin privilegios
-- de clientes (20261014120000_public_profile_previews_write_lockdown.sql).
--
-- La vista (20260925120100) es `security_invoker = false` y actualizable, y
-- los privilegios por defecto de Supabase daban TODOS a anon y authenticated:
-- una escritura por ella se comprobaba con los privilegios de su dueño, sin
-- la RLS de profiles ni su GRANT por columnas. Este archivo debe fallar si:
--   - PUBLIC, anon o authenticated recuperan cualquier privilegio sobre la
--     vista (de tabla o de columna, directo o heredado);
--   - alguno de ellos consigue leer, insertar, actualizar o borrar por ella;
--   - los rechazos dejan de deberse a los privilegios (LK5: con el privilegio
--     concedido a propósito, la misma sentencia sí afecta a la fila);
--   - el hotfix amplía o cambia los permisos de profiles.
-- El número 24 deja libres el 16–23, que usan las ramas de la Fase 4.
--
-- A: cuenta activa (la que ataca). B: cuenta activa (la víctima). C: cuenta
-- eliminada (la vista no la muestra).

reset role;
insert into auth.users (id, email) values
  ('24000000-0000-0000-0000-00000000000a', 'lockdown-a@test'),
  ('24000000-0000-0000-0000-00000000000b', 'lockdown-b@test'),
  ('24000000-0000-0000-0000-00000000000c', 'lockdown-c@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role, deleted_at) values
  ('24000000-0000-0000-0000-00000000000a', 'Lockdown A', '2001-01-01', 'looking_for_room', 'user', null),
  ('24000000-0000-0000-0000-00000000000b', 'Lockdown B', '2001-01-01', 'looking_for_room', 'user', null),
  ('24000000-0000-0000-0000-00000000000c', 'Lockdown C', '2001-01-01', 'flexible', 'user', now());

-- ------------------------------------------------------------
-- 0. Catálogo: ningún privilegio de PUBLIC, anon ni authenticated
-- ------------------------------------------------------------
select roomly_test.ok(
  not exists (
    select 1
    from unnest(array['public', 'anon', 'authenticated']) r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                            'REFERENCES', 'TRIGGER']) p
    where has_table_privilege(r, 'public.public_profile_previews', p)),
  'LK0: PUBLIC, anon y authenticated no tienen ningún privilegio efectivo de tabla sobre la vista');
select roomly_test.ok(
  not exists (
    select 1
    from unnest(array['public', 'anon', 'authenticated']) r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
    where has_any_column_privilege(r, 'public.public_profile_previews', p)),
  'LK0: ni privilegios de columna');
select roomly_test.ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.public_profile_previews'::regclass
      and (a.grantee = 0
           or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))),
  'LK0: la ACL de la vista no tiene entradas de PUBLIC (grantee 0), anon ni authenticated');
select roomly_test.ok(
  not exists (
    select 1
    from pg_attribute a, aclexplode(a.attacl) e
    where a.attrelid = 'public.public_profile_previews'::regclass
      and a.attacl is not null
      and (e.grantee = 0
           or e.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))),
  'LK0: ni en las ACL de sus columnas');
select roomly_test.ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'public_profile_previews'
      and grantee in ('PUBLIC', 'anon', 'authenticated')),
  'LK0: information_schema.role_table_grants tampoco muestra ninguno');

-- ------------------------------------------------------------
-- 1. anon: ni lee ni escribe por la vista (42501, por privilegios)
-- ------------------------------------------------------------
set role anon;
select roomly_test.login(null);
select roomly_test.expect_error(
  $$update public.public_profile_previews set full_name = 'Cambiado por anon'
    where id = '24000000-0000-0000-0000-00000000000b'$$,
  '42501', 'LK1: anon no cambia el nombre de otra persona');
select roomly_test.expect_error(
  $$update public.public_profile_previews set role = 'admin'
    where id = '24000000-0000-0000-0000-00000000000b'$$,
  '42501', 'LK1: anon no cambia el rol de nadie');
select roomly_test.expect_error(
  $$delete from public.public_profile_previews
    where id = '24000000-0000-0000-0000-00000000000b'$$,
  '42501', 'LK1: anon no borra perfiles');
select roomly_test.expect_error(
  $$insert into public.public_profile_previews (id, full_name, role)
    values ('24000000-0000-0000-0000-0000000000ff', 'Nuevo', 'admin')$$,
  '42501', 'LK1: anon no inserta (rechazo por privilegios, antes que cualquier NOT NULL)');
select roomly_test.expect_error(
  $$select id from public.public_profile_previews$$,
  '42501', 'LK1: anon no lee la vista');

-- ------------------------------------------------------------
-- 2. authenticated (A): ni lee ni escribe por la vista
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('24000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$update public.public_profile_previews set role = 'admin'
    where id = '24000000-0000-0000-0000-00000000000a'$$,
  '42501', 'LK2: A no se pone role = admin a sí misma');
select roomly_test.expect_error(
  $$update public.public_profile_previews set full_name = 'Cambiado por A'
    where id = '24000000-0000-0000-0000-00000000000b'$$,
  '42501', 'LK2: A no cambia el perfil de B');
select roomly_test.expect_error(
  $$delete from public.public_profile_previews
    where id = '24000000-0000-0000-0000-00000000000b'$$,
  '42501', 'LK2: A no borra el perfil de B');
select roomly_test.expect_error(
  $$insert into public.public_profile_previews (id, full_name, role)
    values ('24000000-0000-0000-0000-0000000000ff', 'Nuevo', 'admin')$$,
  '42501', 'LK2: A no inserta');
select roomly_test.expect_error(
  $$select id from public.public_profile_previews$$,
  '42501', 'LK2: A no lee la vista (ningún código de la app la usa)');

-- ------------------------------------------------------------
-- 3. Nada ha cambiado
-- ------------------------------------------------------------
reset role;
select roomly_test.ok(
  (select count(*) = 2 from public.profiles
   where id in ('24000000-0000-0000-0000-00000000000a', '24000000-0000-0000-0000-00000000000b')
     and role = 'user'
     and full_name in ('Lockdown A', 'Lockdown B'))
  and not exists (select 1 from public.profiles where id = '24000000-0000-0000-0000-0000000000ff'),
  'LK3: los intentos no cambiaron, borraron ni crearon ningún perfil');

-- ------------------------------------------------------------
-- 4. PUBLIC: un rol sin más privilegios que los de PUBLIC
-- ------------------------------------------------------------
-- anon y authenticated heredan PUBLIC, así que LK1 y LK2 ya lo incluyen. Con
-- superusuario (en local) se prueba además con un rol que solo tiene PUBLIC;
-- en el proyecto remoto (sin superusuario) no se crean roles y bastan LK0,
-- LK1 y LK2.
do $$
begin
  if current_setting('is_superuser') <> 'on' then
    raise notice 'ok - LK4 (omitido sin superusuario): lo cubren LK0 y los intentos de anon y authenticated, que heredan PUBLIC';
    return;
  end if;
  create role roomly_lk_public_only nologin;
  execute 'set local role roomly_lk_public_only';
  begin
    update public.public_profile_previews set full_name = 'Por PUBLIC'
      where id = '24000000-0000-0000-0000-00000000000b';
    raise exception 'FALLO: LK4: un rol solo con PUBLIC actualizó la vista';
  exception when insufficient_privilege then
    raise notice 'ok - LK4: un rol solo con PUBLIC no actualiza la vista (42501)';
  end;
  begin
    perform 1 from public.public_profile_previews;
    raise exception 'FALLO: LK4: un rol solo con PUBLIC leyó la vista';
  exception when insufficient_privilege then
    raise notice 'ok - LK4: ni la lee (42501)';
  end;
  execute 'reset role';
  drop role roomly_lk_public_only;
end $$;

-- ------------------------------------------------------------
-- 5. Controles: el rechazo se debe a los privilegios
-- ------------------------------------------------------------
-- Con los privilegios concedidos a propósito (y deshechos después), las
-- mismas sentencias sí afectan a la fila: la fila existe y la vista sigue
-- siendo actualizable, así que solo el REVOKE las detiene. Un UPDATE o DELETE
-- con WHERE necesita también SELECT de las columnas que filtra: antes del
-- hotfix anon y authenticated tenían los dos.
begin;
grant select, update on public.public_profile_previews to public;
set role anon;
select roomly_test.login(null);
select roomly_test.expect_affected(
  $$update public.public_profile_previews set full_name = 'Cambiado por anon'
    where id = '24000000-0000-0000-0000-00000000000b'$$,
  1, 'LK5-control: con SELECT y UPDATE concedidos a PUBLIC, anon sí cambiaría el nombre de B (el fallo que corrige el hotfix)');
reset role;
rollback;
begin;
grant select, update, delete on public.public_profile_previews to authenticated;
set role authenticated;
select roomly_test.login('24000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$update public.public_profile_previews set role = 'admin'
    where id = '24000000-0000-0000-0000-00000000000a'$$,
  1, 'LK5-control: con esos privilegios, A sí se pondría role = admin (se salta la RLS y el GRANT de profiles)');
select roomly_test.expect_affected(
  $$delete from public.public_profile_previews
    where id = '24000000-0000-0000-0000-00000000000b'$$,
  1, 'LK5-control: y borraría el perfil de B');
reset role;
rollback;
select roomly_test.ok(
  (select count(*) = 2 from public.profiles
   where id in ('24000000-0000-0000-0000-00000000000a', '24000000-0000-0000-0000-00000000000b')
     and role = 'user'
     and full_name in ('Lockdown A', 'Lockdown B'))
  and not has_table_privilege('public', 'public.public_profile_previews', 'SELECT')
  and not has_table_privilege('public', 'public.public_profile_previews', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.public_profile_previews', 'SELECT')
  and not has_table_privilege('authenticated', 'public.public_profile_previews', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.public_profile_previews', 'DELETE'),
  'LK5: los controles se deshicieron (perfiles intactos y sin privilegios)');

-- ------------------------------------------------------------
-- 6. profiles no cambia: ni más privilegios ni otras políticas
-- ------------------------------------------------------------
select roomly_test.ok(
  not has_table_privilege('anon', 'public.profiles', 'INSERT')
  and not has_table_privilege('anon', 'public.profiles', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.profiles', 'INSERT')
  and not has_any_column_privilege('anon', 'public.profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'LK6: anon no escribe en profiles y authenticated no tiene INSERT ni UPDATE de tabla completa');
select roomly_test.ok(
  (select array_agg(a.attname::text order by a.attname)
   from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))
  = array['avatar_url', 'bio', 'date_of_birth', 'email_notifications_enabled',
          'full_name', 'onboarding_completed_at', 'seeking_status'],
  'LK6: authenticated sigue pudiendo UPDATE exactamente las 7 columnas de siempre (sin role ni deleted_at)');
select roomly_test.ok(
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'INSERT')
  and not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'deleted_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.profiles', 'deleted_at', 'UPDATE'),
  'LK6: role y deleted_at siguen fuera del INSERT y del UPDATE de authenticated');
select roomly_test.ok(
  (select relrowsecurity and not relforcerowsecurity from pg_class
   where oid = 'public.profiles'::regclass)
  and (select count(*) = 4 from pg_policies
       where schemaname = 'public' and tablename = 'profiles'),
  'LK6: profiles conserva la RLS y sus 4 políticas');
set role authenticated;
select roomly_test.login('24000000-0000-0000-0000-00000000000a');
select roomly_test.expect_error(
  $$update public.profiles set role = 'admin'
    where id = '24000000-0000-0000-0000-00000000000a'$$,
  '42501', 'LK6: por la tabla, A tampoco se pone role = admin (GRANT por columnas)');
select roomly_test.expect_rows(
  $$select 1 from public.profiles where id = '24000000-0000-0000-0000-00000000000a'$$,
  1, 'LK6: A sigue leyendo su propio perfil');
reset role;

-- ------------------------------------------------------------
-- 7. La vista sigue existiendo con su definición (solo para su dueño)
-- ------------------------------------------------------------
select roomly_test.expect_rows(
  $$select 1 from public.public_profile_previews
    where id = '24000000-0000-0000-0000-00000000000b' and full_name = 'Lockdown B'$$,
  1, 'LK7: el dueño sigue leyendo la vista (no se ha borrado ni cambiado)');
select roomly_test.expect_rows(
  $$select 1 from public.public_profile_previews
    where id = '24000000-0000-0000-0000-00000000000c'$$,
  0, 'LK7: y sigue sin mostrar cuentas eliminadas');
