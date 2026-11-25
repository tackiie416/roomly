-- Verificación independiente de la limpieza de un proyecto de validación
-- (paso 8 del procedimiento D2 de la 4.2). SOLO LECTURA.
--
-- Lo ejecuta tests/supabase/validation-cleanup-check.sh dentro de una
-- transacción de solo lectura (`begin ... read only` y
-- `default_transaction_read_only`), que termina en ROLLBACK. Aquí solo hay
-- lecturas (tests/unit/validation-infra.test.ts lo comprueba).
--
-- Variables de psql (las pone el script, ya validadas):
--   :'expected_marker'  marca esperada del proyecto (roomly-validation-3 o -4).
--
-- Un proyecto de validación no tiene datos reales (B2): toda fila de usuario
-- que quede es un resto de las pruebas. El informe solo muestra la marca,
-- nombres de comprobaciones y contadores: nunca emails, ids ni rutas.

-- 0. ¿Es el proyecto esperado, y se puede inspeccionar? Si la marca no
-- coincide, o la RLS pudiera ocultar filas al rol, se para sin informe:
-- «0 filas» no se distinguiría de «no las veo».
do $$
declare
  marker text;
  can_bypass boolean;
  tbl record;
begin
  select shobj_description(d.oid, 'pg_database') into marker
  from pg_database d where d.datname = current_database();
  if marker is distinct from current_setting('roomly.expected_marker', true) then
    raise exception 'CLEANUP NO VERIFICABLE: la marca de la base de datos no es la esperada';
  end if;
  if to_regclass('auth.users') is null or to_regclass('storage.objects') is null
     or to_regclass('public.profiles') is null then
    raise exception 'CLEANUP NO VERIFICABLE: faltan auth.users, storage.objects o public.profiles';
  end if;
  select r.rolsuper or r.rolbypassrls into can_bypass
  from pg_roles r where r.rolname = current_user;
  for tbl in
    select c.oid::regclass::text as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           pg_get_userbyid(c.relowner) = current_user as is_owner
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and (n.nspname = 'public' or c.oid in ('auth.users'::regclass, 'storage.objects'::regclass))
    order by 1
  loop
    if tbl.rls and not coalesce(can_bypass, false) and (tbl.forced or not tbl.is_owner) then
      raise exception 'CLEANUP NO VERIFICABLE: % tiene la RLS activa y el rol % podría no ver todas las filas',
        tbl.name, current_user;
    end if;
  end loop;
end $$;

-- 1. Marca comprobada.
select 'marca', shobj_description(d.oid, 'pg_database')
from pg_database d where d.datname = current_database();

-- 2. Restos de las suites, con sus patrones conocidos:
--   - usuarios de la suite SQL (`%@test`, tests/supabase/sql-suite-lib.sh) y
--     de la api-suite (`roomly-val-…@example.com`,
--     tests/integration/supabase-validation.test.ts);
--   - el esquema y las políticas temporales de la suite SQL.
select 'usuarios_de_prueba',
       count(*)::text from auth.users u
where u.email like '%@test' or u.email like 'roomly-val-%@example.com';
select 'esquema_roomly_test', (to_regnamespace('roomly_test') is not null)::int::text;
select 'politicas_zz_test', count(*)::text from pg_policies where policyname like 'zz_test%';

-- 3. Cualquier dato de usuario (en un proyecto sin datos reales, todo es de
-- las pruebas). Las tablas de referencia (ciudades, barrios, universidades)
-- vienen del seed y de las migraciones y no se cuentan.
select 'auth_users', count(*)::text from auth.users;
select 'objetos_room_images', count(*)::text from storage.objects o where o.bucket_id = 'room-images';
select 'objetos_otros_buckets', count(*)::text from storage.objects o where o.bucket_id <> 'room-images';
select 'profiles', count(*)::text from public.profiles;
select 'housing_preferences', count(*)::text from public.housing_preferences;
select 'compatibility_responses', count(*)::text from public.compatibility_responses;
select 'rooms', count(*)::text from public.rooms;
select 'room_addresses', count(*)::text from public.room_addresses;
select 'room_images', count(*)::text from public.room_images;
select 'favorites', count(*)::text from public.favorites;
select 'interests', count(*)::text from public.interests;
select 'matches', count(*)::text from public.matches;
select 'conversations', count(*)::text from public.conversations;
select 'conversation_participants', count(*)::text from public.conversation_participants;
select 'messages', count(*)::text from public.messages;
select 'notifications', count(*)::text from public.notifications;
select 'reports', count(*)::text from public.reports;
select 'admin_action_logs', count(*)::text from public.admin_action_logs;
