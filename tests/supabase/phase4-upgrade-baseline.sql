-- R8 — estado de partida de la actualización de la Fase 4, además del preflight
-- congelado de la Fase 3 (tests/supabase/phase3-baseline-preflight.sql).
--
-- Solo lectura. Lo ejecuta tests/supabase/phase4-upgrade.sh dentro de su
-- transacción, antes de la primera migración. Si algo no coincide con el
-- estado esperado de roomly-validation-3 tras los runs 16–19, se detiene con
-- `FALLO R8-BASE` y no se aplica nada:
--   - ningún objeto de la Fase 4.1: ni las restricciones de `rooms`, ni la
--     clave única de `neighborhoods`, ni el GRANT por columnas (`authenticated`
--     conserva INSERT y UPDATE de tabla completa en `rooms`). Las políticas de
--     la 4.0 ya las descarta P3 del preflight de la Fase 3 (exactamente 37);
--   - sin datos que las migraciones tendrían que juzgar: 0 habitaciones,
--     direcciones, imágenes y barrios;
--   - los datos de referencia del seed: 9 ciudades y 7 universidades;
--   - sin restos de pruebas: usuarios `@test` o `roomly-val-…`, el schema
--     `roomly_test`;
--   - las tablas que tocan las migraciones son del rol que conecta, que es el
--     que puede alterarlas.

do $$
declare
  failures text[] := '{}';
  found text;
  n bigint;
begin
  select string_agg(c.conname, ', ' order by c.conname) into found
  from pg_constraint c
  where (c.conrelid = 'public.rooms'::regclass
         and c.conname in ('chk_rooms_features_catalog', 'chk_rooms_features_unique',
                           'chk_rooms_total_roommates', 'chk_rooms_total_rooms',
                           'chk_rooms_publishable', 'fk_rooms_neighborhood_city'))
     or (c.conrelid = 'public.neighborhoods'::regclass
         and c.conname = 'neighborhoods_id_city_id_key');
  if found is not null then
    failures := failures || format('ya hay restricciones de la Fase 4.1: %s', found);
  end if;

  if not (has_table_privilege('authenticated', 'public.rooms', 'INSERT')
          and has_table_privilege('authenticated', 'public.rooms', 'UPDATE')) then
    failures := failures || 'authenticated ya no tiene INSERT/UPDATE de tabla completa en rooms (GRANT de la 4.1 aplicado)'::text;
  end if;

  select count(*) into n from public.rooms;
  if n <> 0 then failures := failures || format('rooms tiene %s filas (se esperaban 0)', n); end if;
  select count(*) into n from public.room_addresses;
  if n <> 0 then failures := failures || format('room_addresses tiene %s filas (se esperaban 0)', n); end if;
  select count(*) into n from public.room_images;
  if n <> 0 then failures := failures || format('room_images tiene %s filas (se esperaban 0)', n); end if;
  select count(*) into n from public.neighborhoods;
  if n <> 0 then failures := failures || format('neighborhoods tiene %s filas (se esperaban 0)', n); end if;

  select count(*) into n from public.cities;
  if n <> 9 then failures := failures || format('cities tiene %s filas (el seed deja 9)', n); end if;
  select count(*) into n from public.universities;
  if n <> 7 then failures := failures || format('universities tiene %s filas (el seed deja 7)', n); end if;

  select count(*) into n from auth.users
  where email like '%@test' or email like 'roomly-val-%';
  if n <> 0 then failures := failures || format('quedan %s usuarios de prueba en auth.users', n); end if;
  if exists (select 1 from pg_namespace where nspname = 'roomly_test') then
    failures := failures || 'queda el schema roomly_test'::text;
  end if;

  select string_agg(t.tablename || ' (' || t.tableowner || ')', ', ' order by t.tablename) into found
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename in ('cities', 'neighborhoods', 'rooms', 'room_addresses', 'room_images')
    and t.tableowner <> current_user;
  if found is not null then
    failures := failures || format('tablas que no son del rol que conecta: %s', found);
  end if;

  if cardinality(failures) > 0 then
    raise exception 'FALLO R8-BASE: el esquema de partida no es el esperado de la Fase 3: %',
      array_to_string(failures, '; ');
  end if;
  raise notice 'ok - R8-BASE: sin objetos de la Fase 4.1, sin datos de habitaciones ni barrios, seed intacto, sin restos de pruebas y tablas del rol que conecta';
end $$;
