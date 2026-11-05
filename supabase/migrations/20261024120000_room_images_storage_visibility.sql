-- ============================================================
-- Fase 4.2 — Fotos de habitaciones en Storage y visibilidad pública (R7)
-- ============================================================
-- Decisiones del propietario (2026-10-24; reconstruidas el 2026-10-29 a
-- partir del diseño documentado, ver PROGRESS.md): R7 (una habitación activa
-- de una cuenta desactivada deja de ser pública, y sus fotos también), D17
-- ampliada (solo el servidor escribe las fotos, con service_role, desde
-- lib/services/room-images.ts), 8 fotos por habitación y 5 MiB por objeto en
-- el bucket (la aplicación limita a 4 MiB). Detalle y razonamiento en
-- docs/DATABASE.md («Fase 4.2»).
--
-- Aditiva: no reescribe migraciones anteriores ni añade tablas. Quedan 18
-- tablas, 42 políticas (44 − 3 + 1), 14 triggers y 13 funciones en public.
--
-- Crea el bucket room-images público; 20261025120000 lo deja privado (D1) y
-- comprueba Storage (L6_N2). Las herramientas del proyecto aplican las dos en
-- orden: hasta la segunda, las fotos se servirían con su URL pública.

-- ------------------------------------------------------------
-- 0. Comprobación previa
-- ------------------------------------------------------------
-- Si los datos existentes o el bucket no encajan con las reglas nuevas, la
-- migración se detiene con un error que dice cuántos y por qué. Nunca borra ni
-- transforma filas: quien opere la base de datos decide antes de reintentar.
do $$
declare
  bad_path int;
  bad_position int;
  over_limit int;
  bucket record;
  other_ids text;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception using
      errcode = '55000',
      message = 'room_images_4_2_precheck: faltan storage.buckets o storage.objects '
                '(Supabase Storage, o el shim de los tests locales). No se ha cambiado nada.';
  end if;

  select count(*) into bad_path
  from public.room_images i
  where i.storage_path is distinct from i.room_id::text || '/' || i.id::text || '.webp';

  select count(*) into bad_position
  from public.room_images i
  where i.position < 0;

  select count(*) into over_limit
  from (
    select i.room_id from public.room_images i group by i.room_id having count(*) > 8
  ) as r;

  if bad_path + bad_position + over_limit > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'room_images_4_2_precheck: hay fotos que incumplen las reglas nuevas '
        '(ruta distinta de room_id/id.webp: %s; posición negativa: %s; '
        'habitaciones con más de 8 fotos: %s). No se ha cambiado nada.',
        bad_path, bad_position, over_limit);
  end if;

  select string_agg(b.id, ', ' order by b.id) into other_ids
  from storage.buckets b
  where b.name = 'room-images' and b.id <> 'room-images';
  if other_ids is not null then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_4_2_precheck: hay un bucket llamado room-images con otro id (%s). '
        'Se espera un solo bucket con id = nombre = room-images. No se ha cambiado nada.',
        other_ids);
  end if;

  select b.name, b.public, b.file_size_limit, b.allowed_mime_types into bucket
  from storage.buckets b
  where b.id = 'room-images';
  if found and not (
    bucket.name = 'room-images'
    and bucket.public is true
    and bucket.file_size_limit is not distinct from 5242880
    and bucket.allowed_mime_types is not distinct from array['image/webp']::text[]
  ) then
    raise exception using
      errcode = '55000',
      message = format(
        'room_images_4_2_precheck: el bucket room-images ya existe con otra configuración '
        '(nombre %s, público %s, límite %s, tipos %s). No se ha cambiado nada.',
        bucket.name, coalesce(bucket.public::text, 'nulo'),
        coalesce(bucket.file_size_limit::text, 'ninguno'),
        coalesce(bucket.allowed_mime_types::text, 'todos'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. R7 — Visibilidad pública según la cuenta del propietario
-- ------------------------------------------------------------
-- SECURITY DEFINER porque anon no puede leer profiles (H4): una subconsulta
-- normal no vería ningún perfil y ocultaría todas las habitaciones. Es del
-- mismo dueño que rooms y profiles, que no tienen FORCE RLS (P2).
-- Recibe el id de la habitación, no el del propietario: responde lo mismo que
-- ya revela un SELECT de la habitación y no sirve para preguntar por el estado
-- de una cuenta.
create function public.is_room_publicly_visible(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms r
    join public.profiles p on p.id = r.owner_id
    where r.id = p_room_id
      and r.status = 'active'
      and r.deleted_at is null
      and p.deleted_at is null
  );
$$;

-- La llama la lectura pública (anon y authenticated); nadie más.
revoke all on function public.is_room_publicly_visible(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_room_publicly_visible(uuid) to anon, authenticated;

-- Mismo nombre. Las dos primeras condiciones se repiten fuera de la función
-- para que el planificador filtre antes de llamarla.
drop policy "rooms_select_active_public" on public.rooms;
create policy "rooms_select_active_public" on public.rooms
  for select using (
    rooms.status = 'active'
    and rooms.deleted_at is null
    and public.is_room_publicly_visible(rooms.id)
  );

-- Una foto se ve si su habitación es pública o es de quien lee. Antes, la
-- condición pública era `status = 'active'`, sin mirar la cuenta.
drop policy "room_images_select" on public.room_images;
create policy "room_images_select" on public.room_images
  for select using (
    public.is_room_publicly_visible(room_images.room_id)
    or exists (
      select 1 from public.rooms r
      where r.id = room_images.room_id
        and r.owner_id = auth.uid()
    )
  );

-- El admin activo lee todas las fotos, también las de habitaciones ocultas
-- por R7, para moderar (las habitaciones ya las ve con rooms_admin_all). Solo
-- lectura: las fotos las escribe el servidor.
create policy "room_images_admin_select" on public.room_images
  for select to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 2. room_images: solo escribe el servidor
-- ------------------------------------------------------------
-- Sin escritura de clientes (D17 ampliada): el único escritor es
-- lib/services/room-images.ts con service_role, después de limpiar la foto.
drop policy "room_images_insert_own" on public.room_images;
drop policy "room_images_update_own" on public.room_images;
drop policy "room_images_delete_own" on public.room_images;

revoke insert, update, delete, truncate, references, trigger
  on public.room_images from anon, authenticated;

-- La ruta se deriva de la fila. El id lo genera el servidor (UUID aleatorio),
-- así que no se puede adivinar ni apuntar a la foto de otra habitación.
alter table public.room_images
  add constraint chk_room_images_storage_path
  check (storage_path = room_id::text || '/' || id::text || '.webp');

-- Sin unicidad: dos subidas simultáneas pueden recibir la misma posición. El
-- listado ordena por position, created_at e id, así que el orden es estable.
alter table public.room_images
  add constraint chk_room_images_position
  check (position >= 0);

-- Para todos los roles, también service_role (que se salta la RLS): mismo
-- precedente que trg_compatibility_responses_integrity. Errores 23514 con
-- prefijo estable, que el servicio traduce sin enseñar el mensaje:
--   - room_image_locked:   en un UPDATE solo cambia `position`;
--   - room_not_writable:   la habitación no existe, tiene deleted_at o está
--                          removed;
--   - account_deleted:     el propietario no existe o tiene deleted_at;
--   - room_images_limit:   en un INSERT, la habitación ya tiene 8 fotos.
-- El límite aguanta subidas simultáneas: antes de contar, se bloquea la fila
-- de la habitación con FOR NO KEY UPDATE (no choca con las comprobaciones de
-- FK), así que dos INSERT de la misma habitación se serializan y el segundo
-- cuenta la foto del primero (tests/db/concurrency_room_images.sh).
-- El DELETE no pasa por aquí: el servidor puede borrar siempre, y el borrado
-- en cascada de rooms no se bloquea.
create function public.enforce_room_images_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  room_owner uuid;
  room_status text;
  room_deleted_at timestamptz;
  n_images int;
begin
  if tg_op = 'UPDATE'
     and (new.id, new.room_id, new.storage_path, new.created_at)
         is distinct from (old.id, old.room_id, old.storage_path, old.created_at) then
    raise exception using
      errcode = '23514',
      message = 'room_image_locked: de una foto solo se puede cambiar la posición';
  end if;

  select r.owner_id, r.status::text, r.deleted_at
    into room_owner, room_status, room_deleted_at
  from public.rooms r
  where r.id = new.room_id
  for no key update;
  if not found or room_deleted_at is not null or room_status = 'removed' then
    raise exception using
      errcode = '23514',
      message = 'room_not_writable: la habitación no existe, está eliminada o retirada';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = room_owner
      and p.deleted_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'account_deleted: la cuenta no existe o está desactivada';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into n_images
    from public.room_images i
    where i.room_id = new.room_id;
    if n_images >= 8 then
      raise exception using
        errcode = '23514',
        message = 'room_images_limit: una habitación puede tener como máximo 8 fotos';
    end if;
  end if;

  return new;
end;
$$;

-- Solo se ejecuta como trigger: nadie necesita llamarla directamente.
revoke all on function public.enforce_room_images_integrity()
  from public, anon, authenticated;

create trigger trg_room_images_integrity
  before insert or update on public.room_images
  for each row execute function public.enforce_room_images_integrity();

-- ------------------------------------------------------------
-- 3. Storage: el bucket room-images
-- ------------------------------------------------------------
-- Solo image/webp (el servidor vuelve a codificar cada foto) y 5 MiB por
-- objeto: una defensa más que el límite de la aplicación (4 MiB), y que se
-- aplica también a service_role. Ninguna política en storage.objects, a
-- propósito: sin SELECT nadie lista el bucket ni descarga objetos por la API,
-- y sin INSERT, UPDATE ni DELETE ningún cliente sube, cambia, mueve ni borra
-- objetos. Solo service_role, que se salta la RLS.
-- Público hasta 20261025120000, que lo deja privado: entretanto, las URL
-- /storage/v1/object/public/room-images/<ruta> servirían los objetos sin RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-images', 'room-images', true, 5242880, array['image/webp'])
on conflict (id) do nothing;
