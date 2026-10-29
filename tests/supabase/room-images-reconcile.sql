-- Informe de conciliación de las fotos (Fase 4.2, D3). SOLO LECTURA.
--
-- Lo ejecuta tests/supabase/room-images-reconcile.sh dentro de una
-- transacción de solo lectura (`begin ... read only` y
-- `default_transaction_read_only`), que termina en ROLLBACK. Aquí solo hay
-- lecturas: ni escrituras, ni borrados, ni cambios de configuración
-- (tests/unit/validation-infra.test.ts lo comprueba).
--
-- Variables de psql (las pone el script, ya validadas):
--   :'as_of'          fecha de referencia ISO 8601, o vacía para now();
--   :min_age_hours    antigüedad mínima, en horas, de un objeto sin fila para
--                     ser candidato a huérfano (24 por defecto).
--
-- Compara los METADATOS de Storage (`storage.objects`, bucket room-images)
-- con `public.room_images`. No comprueba que el archivo exista físicamente en
-- el almacenamiento de Storage: eso solo lo puede decir la API de Storage, y
-- este informe no la usa.

-- 0. ¿Se puede inspeccionar? Si la RLS pudiera ocultar filas a este rol, «no
-- hay objetos» no se distinguiría de «no los veo»: se para sin informe.
do $$
declare
  can_bypass boolean;
  tbl record;
begin
  if to_regclass('storage.objects') is null or to_regclass('public.room_images') is null then
    raise exception 'RECONCILE NO VERIFICABLE: faltan storage.objects o public.room_images';
  end if;
  select r.rolsuper or r.rolbypassrls into can_bypass
  from pg_roles r where r.rolname = current_user;
  for tbl in
    select c.oid::regclass::text as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           pg_get_userbyid(c.relowner) = current_user as is_owner
    from pg_class c
    where c.oid in ('storage.objects'::regclass, 'public.room_images'::regclass)
    order by c.relname
  loop
    if tbl.rls and not coalesce(can_bypass, false) and (tbl.forced or not tbl.is_owner) then
      raise exception 'RECONCILE NO VERIFICABLE: % tiene la RLS activa y el rol % podría no ver todas las filas',
        tbl.name, current_user;
    end if;
  end loop;
end $$;

-- 1. Referencia del informe: fecha y antigüedad mínima.
select 'referencia',
       to_char(coalesce(nullif(:'as_of', ''), now()::text)::timestamptz at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       :min_age_hours::text;

-- 2. Detalle, ordenado de forma estable (categoría y ruta, en orden de bytes).
--   - objeto_sin_fila: objeto canónico (`room_id/id.webp`, UUID en minúsculas)
--     sin fila, más antiguo que el umbral: candidato a huérfano;
--   - objeto_sin_fila_reciente: igual, pero más reciente (una subida puede
--     estar en curso): no concluyente;
--   - objeto_sin_fila_sin_fecha: igual, sin `created_at`: no se puede saber
--     su antigüedad;
--   - ruta_no_canonica: objeto del bucket con otro nombre (ajeno a la app, o
--     restos de una prueba): nunca es de una fila;
--   - fila_sin_objeto: fila cuya ruta no tiene objeto en los metadatos.
-- Las horas se cuentan hasta la fecha de referencia («-» si no hay fecha).
with params as (
  select coalesce(nullif(:'as_of', ''), now()::text)::timestamptz as as_of,
         make_interval(hours => :min_age_hours) as min_age
),
bucket_objects as (
  select o.name, o.created_at,
         o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'
           as canonical
  from storage.objects o
  where o.bucket_id = 'room-images'
),
report as (
  select case
           when not o.canonical then 'ruta_no_canonica'
           when o.created_at is null then 'objeto_sin_fila_sin_fecha'
           when o.created_at <= p.as_of - p.min_age then 'objeto_sin_fila'
           else 'objeto_sin_fila_reciente'
         end as category,
         o.name as path,
         case
           when o.created_at is null then '-'
           else floor(extract(epoch from (p.as_of - o.created_at)) / 3600)::bigint::text
         end as age_hours
  from bucket_objects o
  cross join params p
  where not exists (select 1 from public.room_images i where i.storage_path = o.name)
  union all
  select 'fila_sin_objeto', i.storage_path, '-'
  from public.room_images i
  where not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'room-images' and o.name = i.storage_path
  )
)
select r.category, r.path, r.age_hours
from report r
order by r.category collate "C", r.path collate "C";
