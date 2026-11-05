-- ============================================================
-- Fase 4.2 (sesión 65) — Una habitación solo se borra desde el servidor
-- ============================================================
-- Decisión del propietario (2026-10-30): el cliente ya no borra filas de
-- public.rooms por PostgREST. El borrado pasa por el servidor
-- (lib/services/rooms.ts), que comprueba la sesión y la cuenta, llama a esta
-- función con service_role y después limpia Storage con las rutas que
-- devuelve. Con el DELETE directo abierto, una habitación se podía borrar sin
-- esa limpieza (sus objetos quedaban huérfanos). D17 se amplía solo para esta
-- operación: service_role ejecuta `delete_own_room`, que exige propietario y
-- cuenta activa; no hay un borrado genérico con service_role.
--
-- 1. Privilegios: `anon` y `authenticated` pierden DELETE y TRUNCATE sobre
--    rooms (TRUNCATE también borra filas, sin RLS). No se toca nada más:
--    SELECT, el INSERT y el UPDATE por columnas de la 4.1, REFERENCES y
--    TRIGGER siguen igual, y service_role conserva todos sus privilegios.
--    Un admin desde el cliente tampoco borra: el GRANT es por rol de Postgres
--    (`rooms_admin_all` sigue sirviendo para leer y moderar con UPDATE).
-- 2. Se elimina `rooms_delete_own` (4.0): sin privilegio no hacía nada, y sin
--    ella un GRANT de DELETE futuro no reabriría por sí solo el borrado de la
--    propietaria. Pasan de 42 a 41 políticas.
-- 3. Función `public.delete_own_room(p_room_id, p_user_id)`, que borra en una
--    sola transacción y devuelve las rutas de Storage de sus fotos.
--    SECURITY INVOKER: se ejecuta con los privilegios de quien la llama, y
--    solo service_role tiene EXECUTE (que además tiene DELETE y BYPASSRLS).
--    Si alguien la pudiera llamar como authenticated, el DELETE fallaría
--    igual por falta de privilegio. Pasan de 13 a 14 funciones.
--
-- Sin cambios en tablas, columnas, triggers ni datos. Columnas siempre
-- cualificadas (ver la lección de `messages` en docs/SECURITY.md).

-- ------------------------------------------------------------
-- 1. Sin borrado directo de clientes
-- ------------------------------------------------------------
revoke delete, truncate on public.rooms from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. La política de DELETE de la propietaria ya no tiene uso
-- ------------------------------------------------------------
drop policy "rooms_delete_own" on public.rooms;

-- ------------------------------------------------------------
-- 3. delete_own_room: el único borrado de habitaciones de la aplicación
-- ------------------------------------------------------------
-- Comprueba, en este orden, y aborta sin borrar nada si algo falla:
--   - room_delete_invalid (22004): falta la habitación o el usuario;
--   - room_delete_isolation (P0001): la transacción no es READ COMMITTED. En
--     REPEATABLE READ o SERIALIZABLE, la lectura de las fotos usaría una
--     instantánea anterior al bloqueo y podría no ver una foto confirmada
--     mientras esperaba (PostgREST usa READ COMMITTED);
--   - account_deleted (42501): el perfil de p_user_id no existe o tiene
--     deleted_at (el criterio de cuenta activa de la decisión B y de la 4.0).
--     Se bloquea con FOR SHARE: una desactivación simultánea espera a que
--     termine el borrado, o el borrado ve la cuenta desactivada;
--   - room_not_found (P0002): la habitación no existe o no es de p_user_id.
--     Se bloquea con FOR UPDATE hasta el final. Choca con el FOR NO KEY UPDATE
--     de trg_room_images_integrity y con el FOR KEY SHARE de la FK de una
--     foto nueva: una subida en curso termina antes de que se lean las fotos
--     (y entonces su ruta se devuelve), o espera y después falla porque la
--     habitación ya no existe (room_not_writable, y M2 borra su objeto);
--   - room_delete_path_invalid (23514): alguna foto tiene una ruta que no es
--     `room_id/id.webp` con dos UUID en minúsculas. chk_room_images_storage_path
--     ya lo impide; esto es una defensa más, para no devolver al servidor una
--     ruta que pudiera apuntar fuera de la carpeta de la habitación.
-- Después borra la habitación. La cascada se lleva sus filas de room_images,
-- room_addresses y favorites. interests, matches y reports la referencian sin
-- cascada: si tiene alguna, el DELETE falla con 23503 y no se borra nada.
-- Devuelve las rutas de las fotos, de las filas reales, ordenadas como el
-- listado (posición, fecha e id); un array vacío si no tenía fotos.
create function public.delete_own_room(p_room_id uuid, p_user_id uuid)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  paths text[];
  n_invalid int;
  n_deleted int;
begin
  if p_room_id is null or p_user_id is null then
    raise exception using
      errcode = '22004',
      message = 'room_delete_invalid: faltan la habitación o el usuario';
  end if;

  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'room_delete_isolation: el borrado de una habitación necesita READ COMMITTED';
  end if;

  perform 1
  from public.profiles p
  where p.id = p_user_id
    and p.deleted_at is null
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'account_deleted: la cuenta no existe o está desactivada';
  end if;

  perform 1
  from public.rooms r
  where r.id = p_room_id
    and r.owner_id = p_user_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'room_not_found: la habitación no existe o no es de esta cuenta';
  end if;

  select
    coalesce(array_agg(i.storage_path order by i.position, i.created_at, i.id), '{}'),
    count(*) filter (
      where i.storage_path is distinct from (i.room_id::text || '/' || i.id::text || '.webp')
         or i.storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    )
  into paths, n_invalid
  from public.room_images i
  where i.room_id = p_room_id;
  if n_invalid > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'room_delete_path_invalid: %s fotos con una ruta no canónica; no se ha borrado nada',
        n_invalid
      );
  end if;

  delete from public.rooms r
  where r.id = p_room_id
    and r.owner_id = p_user_id;
  get diagnostics n_deleted = row_count;
  if n_deleted <> 1 then
    raise exception using
      errcode = 'P0002',
      message = 'room_not_found: la habitación no se ha podido borrar';
  end if;

  return paths;
end;
$$;

-- Solo el servidor: ni PUBLIC, ni anon, ni authenticated (los privilegios
-- por defecto de Supabase le darían EXECUTE a los tres).
revoke all on function public.delete_own_room(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_own_room(uuid, uuid) to service_role;
