-- ============================================================
-- Fase 4.1 — Habitaciones: integridad, catálogo, ocupación, publicación y
-- columnas reservadas al servidor (sin interfaz)
-- ============================================================
-- Decisiones del propietario (2026-10-15): R1 (coherencia barrio ↔ ciudad),
-- R6 (catálogo cerrado de características), R7 (requisitos para publicar),
-- R9 (semántica de la ocupación) y la protección de las columnas que
-- gestiona el servidor. Detalle y razonamiento en docs/DATABASE.md
-- («Fase 4.1»).
--
-- No incluye el catálogo de barrios oficiales: va en una migración de datos
-- aparte, cuando se haya verificado la fuente (Open Data BCN).
--
-- Todo es declarativo (FK, CHECK, GRANT): no añade políticas, triggers ni
-- funciones. Siguen 18 tablas, 44 políticas, 13 triggers y 11 funciones.
-- No toca la RLS de la 4.0 (cuentas desactivadas), la lectura pública, el
-- trigger de moderación (H5), room_addresses, room_images ni service_role.
--
-- Las restricciones se aplican a todos los roles, también a un admin y a
-- service_role: son invariantes de los datos, no permisos.

-- ------------------------------------------------------------
-- 0. Comprobación previa de los datos existentes
-- ------------------------------------------------------------
-- Si alguna habitación incumple una regla nueva, la migración se detiene con
-- un error que dice cuántas y por qué. Nunca borra ni transforma filas: quien
-- opere la base de datos decide qué hacer con ellas antes de reintentar.
do $$
declare
  bad_features int;
  bad_occupancy int;
  bad_neighborhood int;
  bad_active int;
begin
  select count(*) into bad_features
  from public.rooms r
  where not (r.features <@ array[
          'wifi', 'heating', 'air_conditioning', 'elevator', 'washing_machine',
          'dishwasher', 'balcony', 'furnished', 'private_bathroom', 'double_bed',
          'desk', 'exterior'
        ]::text[])
     or cardinality(r.features) <> (select count(distinct f.feature)
                                    from unnest(r.features) as f(feature));

  select count(*) into bad_occupancy
  from public.rooms r
  where r.total_roommates < 0 or r.total_rooms < 1;

  select count(*) into bad_neighborhood
  from public.rooms r
  where r.neighborhood_id is not null
    and not exists (
      select 1 from public.neighborhoods n
      where n.id = r.neighborhood_id and n.city_id = r.city_id
    );

  select count(*) into bad_active
  from public.rooms r
  where r.status = 'active'
    and (r.neighborhood_id is null or r.total_roommates is null or r.total_rooms is null);

  if bad_features + bad_occupancy + bad_neighborhood + bad_active > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'rooms_4_1_precheck: hay habitaciones que incumplen las reglas nuevas '
        '(características fuera del catálogo o repetidas: %s; ocupación no válida: %s; '
        'barrio de otra ciudad: %s; activas sin barrio u ocupación: %s). '
        'No se ha cambiado nada.',
        bad_features, bad_occupancy, bad_neighborhood, bad_active);
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. R1 — El barrio de una habitación es de su ciudad
-- ------------------------------------------------------------
-- FK compuesta: si `neighborhood_id` tiene valor, el par (barrio, ciudad) de
-- la habitación tiene que existir en `neighborhoods`. Cubre INSERT y UPDATE,
-- también cambiar solo la ciudad o solo el barrio, y con NO ACTION impide
-- mover de ciudad (o borrar) un barrio que use alguna habitación. Con
-- `neighborhood_id` nulo no se comprueba (MATCH SIMPLE): un borrador puede no
-- tenerlo. Se conserva la FK simple `rooms_neighborhood_id_fkey`.
-- (En `housing_preferences` se usan triggers porque los barrios son un array;
-- aquí la columna es escalar y basta una FK.)
alter table public.neighborhoods
  add constraint neighborhoods_id_city_id_key unique (id, city_id);

alter table public.rooms
  add constraint fk_rooms_neighborhood_city
  foreign key (neighborhood_id, city_id)
  references public.neighborhoods (id, city_id);

-- ------------------------------------------------------------
-- 2. R6 — Catálogo cerrado de características
-- ------------------------------------------------------------
-- Las claves son las de `ROOM_FEATURES` en lib/validation/rooms.ts (fuente
-- única; tests/unit/validation-infra.test.ts comprueba que coinciden).
-- Array vacío permitido; claves fuera del catálogo, `NULL` dentro del array y
-- repetidas, rechazadas (23514). Mascotas, tabaco y «solo estudiantes» siguen
-- siendo las columnas booleanas propias: no están en el catálogo.
-- Sin funciones: un CHECK no admite subconsultas, y una función `immutable`
-- con una consulta dentro sería una restricción falsa (docs/DATABASE.md,
-- Fase 2.0).
alter table public.rooms
  add constraint chk_rooms_features_catalog
  check (features <@ array[
    'wifi', 'heating', 'air_conditioning', 'elevator', 'washing_machine',
    'dishwasher', 'balcony', 'furnished', 'private_bathroom', 'double_bed',
    'desk', 'exterior'
  ]::text[]);

alter table public.rooms
  add constraint chk_rooms_features_unique
  check (
    cardinality(array_positions(features, 'wifi')) <= 1
    and cardinality(array_positions(features, 'heating')) <= 1
    and cardinality(array_positions(features, 'air_conditioning')) <= 1
    and cardinality(array_positions(features, 'elevator')) <= 1
    and cardinality(array_positions(features, 'washing_machine')) <= 1
    and cardinality(array_positions(features, 'dishwasher')) <= 1
    and cardinality(array_positions(features, 'balcony')) <= 1
    and cardinality(array_positions(features, 'furnished')) <= 1
    and cardinality(array_positions(features, 'private_bathroom')) <= 1
    and cardinality(array_positions(features, 'double_bed')) <= 1
    and cardinality(array_positions(features, 'desk')) <= 1
    and cardinality(array_positions(features, 'exterior')) <= 1
  );

comment on column public.rooms.features is
  'Características del catálogo cerrado (R6, Fase 4.1): claves de ROOM_FEATURES en lib/validation/rooms.ts, sin repetir. Mascotas, tabaco y solo estudiantes son columnas propias.';

-- ------------------------------------------------------------
-- 3. R9 — Ocupación
-- ------------------------------------------------------------
-- Las columnas no se renombran. El comentario de 20260925120000 («plazas que
-- se buscan», marcada como ambigua) queda sustituido por estos.
alter table public.rooms
  add constraint chk_rooms_total_roommates
  check (total_roommates is null or total_roommates >= 0);

alter table public.rooms
  add constraint chk_rooms_total_rooms
  check (total_rooms is null or total_rooms >= 1);

comment on column public.rooms.total_roommates is
  'Número de personas con las que convivirá quien entre en la habitación, sin contarse a sí mismo (R9, Fase 4.1). Cada anuncio es una habitación. Obligatorio para publicar.';
comment on column public.rooms.total_rooms is
  'Número total de dormitorios de la vivienda (R9, Fase 4.1). Obligatorio para publicar.';

-- ------------------------------------------------------------
-- 4. R7 — Requisitos para publicar (`active`)
-- ------------------------------------------------------------
-- Además de lo que el esquema ya exige siempre (título, ciudad, precio > 0 y
-- fecha de disponibilidad no nulos; características del catálogo), una
-- habitación `active` tiene que tener barrio (de su ciudad, por la FK de arriba)
-- y la ocupación informada. Es un CHECK de fila: se evalúa en cada INSERT y
-- UPDATE, así que publicar una habitación incompleta falla y una activa no
-- puede quedarse incompleta después. Los borradores (y `paused`, `rented` o
-- `removed`) pueden estar incompletos. No exige fotos: Storage es posterior.
alter table public.rooms
  add constraint chk_rooms_publishable
  check (
    status <> 'active'
    or (neighborhood_id is not null
        and total_roommates is not null
        and total_rooms is not null)
  );

-- ------------------------------------------------------------
-- 5. Columnas reservadas al servidor
-- ------------------------------------------------------------
-- Mismo patrón que `profiles` y `housing_preferences`: la RLS filtra filas y
-- el GRANT limita columnas. Revocar una columna no quita el privilegio de
-- tabla, así que se revoca el de tabla y se conceden las columnas.
--   - INSERT de authenticated: los datos del anuncio. Fuera: `status` (toda
--     habitación nace `draft`), `deleted_at`, `created_at`, `updated_at`,
--     `approx_lat` y `approx_lng`.
--   - UPDATE de authenticated: los mismos datos y `status`; fuera también
--     `id` y `owner_id`. `status` se queda porque publicar, pausar o marcar
--     como alquilada son acciones del propietario (y moderar, del admin), y ya
--     las acotan la RLS de la 4.0, el trigger de moderación (H5: solo un admin
--     o el servidor entran o salen de `removed`) y `chk_rooms_publishable`.
--     `updated_at` la sigue poniendo `trg_rooms_updated_at`.
--   - anon: sin INSERT, UPDATE ni DELETE (la RLS ya se lo impedía); conserva
--     SELECT para la lectura pública.
--   - DELETE y SELECT de authenticated, sin cambios (RLS).
-- Consecuencias: como en `profiles`, el GRANT es por rol de Postgres, así que
-- un admin desde el cliente tampoco escribe esas columnas (el borrado lógico y
-- las coordenadas se harán desde el servidor); y `upsert()` de supabase-js no
-- sirve para esta tabla (actualiza `id` y `owner_id`).
revoke insert, update on public.rooms from authenticated;

grant insert (
  id, owner_id, title, description, city_id, neighborhood_id, price_month,
  expenses_included, deposit_amount, available_from, min_stay_months,
  max_stay_months, total_roommates, total_rooms, features, pets_allowed,
  smoking_allowed, students_only, house_rules, roommate_preferences
) on public.rooms to authenticated;

grant update (
  title, description, city_id, neighborhood_id, price_month,
  expenses_included, deposit_amount, available_from, min_stay_months,
  max_stay_months, total_roommates, total_rooms, features, pets_allowed,
  smoking_allowed, students_only, house_rules, roommate_preferences, status
) on public.rooms to authenticated;

revoke insert, update, delete on public.rooms from anon;
