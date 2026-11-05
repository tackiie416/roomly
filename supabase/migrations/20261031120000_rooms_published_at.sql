-- ============================================================
-- Fase 4.4 (sesión 71) — Fecha de publicación de las habitaciones (R3)
-- ============================================================
-- Decisión del propietario (2026-10-31): la búsqueda pública ordena «Más
-- recientes» por `published_at DESC, id DESC`, no por `updated_at` (cualquier
-- edición lo cambia) ni por `created_at` (la creación del borrador).
--
-- 1. Columna `published_at` (timestamptz, sin valor por defecto). Ningún
--    cliente la escribe: el GRANT de INSERT y UPDATE de `authenticated` es por
--    columnas (20261015120000) y no la incluye, y el trigger de abajo decide
--    su valor también para service_role y el admin.
-- 2. Histórico: las habitaciones ya activas reciben `created_at` como
--    aproximación documentada de su fecha de publicación (no se guardaba). El
--    relleno desactiva solo durante esta transacción `trg_rooms_updated_at`,
--    para no cambiar su `updated_at`; ningún otro trigger se dispara (no se
--    toca `status`). Las que no están activas quedan sin fecha.
-- 3. Trigger `trg_rooms_published_at` (BEFORE INSERT OR UPDATE, cada fila):
--    - al insertar una habitación activa, o al pasar a `active` desde otro
--      estado (borrador, pausada, alquilada o retirada), `clock_timestamp()`:
--      la hora real de la publicación, no la del inicio de la transacción
--      (`now()`), para que una re-publicación dentro de la misma transacción
--      también quede después de la anterior;
--    - en cualquier otra escritura conserva el valor anterior (al insertar
--      sin estar activa, NULL): una edición ordinaria no la cambia, y nadie
--      la fija a mano.
--    Se dispara después de `trg_rooms_moderation` (orden alfabético de los
--    BEFORE): si H5 rechaza el cambio de estado, no llega a ejecutarse. No
--    toca R7 (`is_room_publicly_visible` y las políticas, sin cambios).
-- 4. `chk_rooms_published_at`: una habitación activa tiene fecha de
--    publicación. La búsqueda pública no tiene que tratar nulos.
-- 5. Índice parcial `idx_rooms_public_recent` (city_id, published_at desc,
--    id desc) sobre las activas sin borrado lógico: el orden por defecto de la
--    búsqueda, que siempre filtra por ciudad.
--
-- Pasan de 14 a 15 triggers y de 14 a 15 funciones; las políticas no cambian
-- aquí. Sin subconsultas: la lección de `messages` (docs/SECURITY.md) no
-- aplica, pero el UPDATE cualifica sus columnas igualmente.

-- ------------------------------------------------------------
-- 1. Columna
-- ------------------------------------------------------------
alter table public.rooms add column published_at timestamptz;

comment on column public.rooms.published_at is
  'Fecha de la última publicación (paso a active). La pone el trigger trg_rooms_published_at; las activas anteriores a 20261031120000 tienen created_at como aproximación.';

-- ------------------------------------------------------------
-- 2. Histórico: created_at como aproximación, sin tocar updated_at
-- ------------------------------------------------------------
alter table public.rooms disable trigger trg_rooms_updated_at;
update public.rooms r
  set published_at = r.created_at
  where r.status = 'active' and r.published_at is null;
alter table public.rooms enable trigger trg_rooms_updated_at;

-- ------------------------------------------------------------
-- 3. Trigger de publicación
-- ------------------------------------------------------------
create function public.set_room_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.published_at := clock_timestamp();
  elsif tg_op = 'INSERT' then
    new.published_at := null;
  else
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;

-- Solo la usa el trigger.
revoke all on function public.set_room_published_at()
  from public, anon, authenticated;

create trigger trg_rooms_published_at
  before insert or update on public.rooms
  for each row execute function public.set_room_published_at();

-- ------------------------------------------------------------
-- 4. Toda habitación activa tiene fecha de publicación
-- ------------------------------------------------------------
alter table public.rooms
  add constraint chk_rooms_published_at
  check (status <> 'active' or published_at is not null);

-- ------------------------------------------------------------
-- 5. Índice del orden por defecto de la búsqueda pública
-- ------------------------------------------------------------
create index idx_rooms_public_recent
  on public.rooms (city_id, published_at desc, id desc)
  where status = 'active' and deleted_at is null;
