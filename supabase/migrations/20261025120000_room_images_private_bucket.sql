-- ============================================================
-- Fase 4.2 (D1) — bucket `room-images` privado, con URL firmadas
-- ============================================================
-- Decisiones del propietario (2026-10-25; reconstruida el 2026-10-29 a partir
-- del diseño documentado, ver PROGRESS.md):
--   - D1: el bucket `room-images` pasa a ser privado. Ocultar una habitación
--     (R7) no revocaba el acceso a sus fotos mientras el bucket fuera
--     público: quien tuviera la URL seguía descargándola. Desde aquí, las
--     fotos solo se sirven con URL firmadas de corta duración, que emite el
--     servidor (lib/services/room-images.ts) después de comprobar con el
--     cliente del usuario que puede ver la habitación y sus fotos.
--   - L6_N2: antes de cambiar nada se comprueba el bucket (id y nombre
--     coherentes, límites de 20261024120000), que `storage.objects` y
--     `storage.buckets` tienen la RLS activa, y que `storage.objects` no tiene
--     ninguna política ni `storage.buckets` políticas de escritura. Una
--     política preexistente podría dar a los clientes la subida directa (sin
--     la limpieza de metadatos del servidor) o la lectura de las fotos sin
--     pasar por la autorización. La migración no borra ni cambia ninguna
--     política: se detiene y dice cuáles hay.
--
-- Migración aditiva: no modifica 20261024120000, que crea el bucket público;
-- esta lo deja privado. Sin tablas, políticas, triggers ni funciones nuevas:
-- siguen 42 políticas, 14 triggers y 13 funciones en `public`, y 0 políticas
-- en `storage.objects`.
-- Los errores distinguen una comprobación negativa (el estado no es el
-- esperado) de una comprobación que no se pudo hacer («no se puede
-- comprobar»). En los dos casos se detiene sin cambiar nada.

-- ------------------------------------------------------------
-- 0. Comprobación previa
-- ------------------------------------------------------------
do $$
declare
  can_bypass boolean;
  tbl record;
  bucket record;
  bucket_found boolean;
  other_ids text;
  object_policies text;
  bucket_write_policies text;
begin
  -- ¿Se puede comprobar? Las tablas de Storage tienen que existir, y la RLS
  -- no puede ocultar filas al rol que ejecuta la migración (sin ser su dueño
  -- ni tener BYPASSRLS, «no hay bucket» no se distinguiría de «no lo veo»).
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception using
      errcode = '55000',
      message = 'room_images_private_precheck: no se puede comprobar: faltan storage.buckets '
                'o storage.objects (Supabase Storage, o el shim de los tests locales). '
                'No se ha cambiado nada.';
  end if;

  select r.rolsuper or r.rolbypassrls into can_bypass
  from pg_catalog.pg_roles r
  where r.rolname = current_user;

  for tbl in
    select c.oid::regclass::text as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           pg_catalog.pg_get_userbyid(c.relowner) = current_user as is_owner
    from pg_catalog.pg_class c
    where c.oid in ('storage.buckets'::regclass, 'storage.objects'::regclass)
    order by c.relname
  loop
    if tbl.rls and not coalesce(can_bypass, false) and (tbl.forced or not tbl.is_owner) then
      raise exception using
        errcode = '55000',
        message = format(
          'room_images_private_precheck: no se puede comprobar %s: tiene la RLS activa y '
          'el rol %s no es su dueño ni tiene BYPASSRLS, así que podría no ver todas las '
          'filas. Ejecuta la migración con el rol de las migraciones. No se ha cambiado nada.',
          tbl.name, current_user);
    end if;
  end loop;

  begin
    select b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types into bucket
    from storage.buckets b
    where b.id = 'room-images';
    bucket_found := found;

    select string_agg(b.id, ', ' order by b.id) into other_ids
    from storage.buckets b
    where b.name = 'room-images' and b.id <> 'room-images';
  exception when insufficient_privilege then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_private_precheck: no se puede comprobar storage.buckets: el rol %s no '
        'tiene permiso para leerla. No se ha cambiado nada.', current_user);
  end;

  -- 1. El bucket: existe, id y nombre coherentes, y con los límites de la 4.2.
  if other_ids is not null then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_private_precheck: hay un bucket llamado room-images con otro id (%s). '
        'Se espera un solo bucket con id = nombre = room-images. No se ha cambiado nada.',
        other_ids);
  end if;
  if not bucket_found then
    raise exception using
      errcode = '55000',
      message = 'room_images_private_precheck: falta el bucket room-images (lo crea '
                '20261024120000; puede que esa migración no se aplicara o que el bucket se '
                'borrara). No se ha cambiado nada.';
  end if;
  if bucket.name is distinct from 'room-images' then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_private_precheck: el bucket con id room-images se llama %s; se espera '
        'id = nombre = room-images. No se ha cambiado nada.', coalesce(bucket.name, '(nulo)'));
  end if;
  if not (
    bucket.file_size_limit is not distinct from 5242880
    and bucket.allowed_mime_types is not distinct from array['image/webp']::text[]
  ) then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_private_precheck: el bucket room-images tiene otra configuración '
        '(límite %s, tipos %s); se espera 5242880 bytes e image/webp. No se ha cambiado nada.',
        coalesce(bucket.file_size_limit::text, 'ninguno'),
        coalesce(bucket.allowed_mime_types::text, 'todos'));
  end if;
  -- `public` puede ser true (lo deja así 20261024120000) o false (esta
  -- migración ya se aplicó): en los dos casos termina en false.

  -- 2. storage.objects: RLS activa y ninguna política. Sin políticas, ningún
  -- cliente sube, cambia, borra, lista ni descarga objetos; solo service_role,
  -- que se salta la RLS. Las fotos se sirven con URL firmadas por el servidor.
  if not coalesce((select c.relrowsecurity from pg_catalog.pg_class c
                   where c.oid = 'storage.objects'::regclass), false) then
    raise exception using
      errcode = '55000',
      message = 'room_images_private_precheck: storage.objects no tiene la RLS activa: '
                'cualquier rol con permisos de tabla leería o escribiría objetos. '
                'No se ha cambiado nada.';
  end if;

  select string_agg(p.policyname || ' (' || p.cmd || ')', ', ' order by p.policyname)
  into object_policies
  from pg_catalog.pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects';
  if object_policies is not null then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_private_precheck: storage.objects tiene políticas: %s. La 4.2 no admite '
        'ninguna: darían a los clientes la subida directa (sin limpiar la foto) o la lectura '
        'sin la autorización del servidor. Revísalas a mano; esta migración no las cambia. '
        'No se ha cambiado nada.', object_policies);
  end if;

  -- 3. storage.buckets: RLS activa y ninguna política de escritura. Sin la
  -- RLS, no tener políticas no protege nada: cualquier rol con permisos de
  -- tabla podría volver a hacer público el bucket o cambiar sus límites.
  if not coalesce((select c.relrowsecurity from pg_catalog.pg_class c
                   where c.oid = 'storage.buckets'::regclass), false) then
    raise exception using
      errcode = '55000',
      message = 'room_images_private_precheck: storage.buckets no tiene la RLS activa: '
                'cualquier rol con permisos de tabla podría cambiar el bucket (hacerlo '
                'público, por ejemplo). No se ha cambiado nada.';
  end if;

  select string_agg(p.policyname || ' (' || p.cmd || ')', ', ' order by p.policyname)
  into bucket_write_policies
  from pg_catalog.pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'buckets' and p.cmd <> 'SELECT';
  if bucket_write_policies is not null then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_private_precheck: storage.buckets tiene políticas de escritura: %s. '
        'Revísalas a mano; esta migración no las cambia. No se ha cambiado nada.',
        bucket_write_policies);
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. Bucket privado
-- ------------------------------------------------------------
-- Las URL `/storage/v1/object/public/room-images/...` dejan de servir los
-- objetos. Idempotente: si ya es privado, no cambia nada.
update storage.buckets
set public = false, updated_at = now()
where id = 'room-images' and public;

-- ------------------------------------------------------------
-- 2. Comprobación final
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from storage.buckets b
    where b.id = 'room-images' and b.name = 'room-images' and not b.public
      and b.file_size_limit = 5242880
      and b.allowed_mime_types = array['image/webp']::text[]
  ) then
    raise exception using
      errcode = '55000',
      message = 'room_images_private_postcheck: el bucket room-images no ha quedado privado con '
                '5242880 bytes e image/webp. La migración falla aquí (las herramientas del '
                'proyecto la aplican en una transacción, que se deshace entera).';
  end if;
end $$;
