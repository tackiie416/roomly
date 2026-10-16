-- Fase 4.1 — R1: catálogo de barrios oficiales de Barcelona (migración
-- 20261016120000; fuente: Ajuntament de Barcelona, Open Data BCN, CC BY 4.0).
-- Debe fallar si:
--   - falta, sobra o cambia (slug o nombre) alguno de los 73 barrios
--     oficiales, o si tienen coordenadas (R2);
--   - Barcelona no existe una sola vez con los valores del seed, o el seed no
--     terminó después de la migración (orden migraciones → seed);
--   - otro barrio de Barcelona usa el nombre de uno oficial con otro slug;
--   - un usuario sin rol admin o anon escribe en el catálogo;
--   - los barrios oficiales no sirven para las reglas de la 4.1 (barrio ↔
--     ciudad, publicación) ni para las preferencias.
-- La lista de abajo es la de la migración (validation-infra comprueba que
-- coinciden) y su huella es la que exige P1 del preflight.
-- Las demás pruebas crean barrios sintéticos en Barcelona y, en local, siguen
-- ahí; por eso este test no exige que Barcelona tenga solo los 73. Eso lo
-- exige P1 del preflight, y la comprobación previa de la migración lo prueba
-- migration-upgrade-selftest.

reset role;
create table roomly_test.official_neighborhoods (code text, slug text, name text);
insert into roomly_test.official_neighborhoods (code, slug, name) values
  ('01', 'el-raval', 'el Raval'),
  ('02', 'el-barri-gotic', 'el Barri Gòtic'),
  ('03', 'la-barceloneta', 'la Barceloneta'),
  ('04', 'sant-pere-santa-caterina-i-la-ribera', 'Sant Pere, Santa Caterina i la Ribera'),
  ('05', 'el-fort-pienc', 'el Fort Pienc'),
  ('06', 'la-sagrada-familia', 'la Sagrada Família'),
  ('07', 'la-dreta-de-l-eixample', 'la Dreta de l''Eixample'),
  ('08', 'l-antiga-esquerra-de-l-eixample', 'l''Antiga Esquerra de l''Eixample'),
  ('09', 'la-nova-esquerra-de-l-eixample', 'la Nova Esquerra de l''Eixample'),
  ('10', 'sant-antoni', 'Sant Antoni'),
  ('11', 'el-poble-sec', 'el Poble-sec'),
  ('12', 'la-marina-del-prat-vermell', 'la Marina del Prat Vermell'),
  ('13', 'la-marina-de-port', 'la Marina de Port'),
  ('14', 'la-font-de-la-guatlla', 'la Font de la Guatlla'),
  ('15', 'hostafrancs', 'Hostafrancs'),
  ('16', 'la-bordeta', 'la Bordeta'),
  ('17', 'sants-badal', 'Sants - Badal'),
  ('18', 'sants', 'Sants'),
  ('19', 'les-corts', 'les Corts'),
  ('20', 'la-maternitat-i-sant-ramon', 'la Maternitat i Sant Ramon'),
  ('21', 'pedralbes', 'Pedralbes'),
  ('22', 'vallvidrera-el-tibidabo-i-les-planes', 'Vallvidrera, el Tibidabo i les Planes'),
  ('23', 'sarria', 'Sarrià'),
  ('24', 'les-tres-torres', 'les Tres Torres'),
  ('25', 'sant-gervasi-la-bonanova', 'Sant Gervasi - la Bonanova'),
  ('26', 'sant-gervasi-galvany', 'Sant Gervasi - Galvany'),
  ('27', 'el-putxet-i-el-farro', 'el Putxet i el Farró'),
  ('28', 'vallcarca-i-els-penitents', 'Vallcarca i els Penitents'),
  ('29', 'el-coll', 'el Coll'),
  ('30', 'la-salut', 'la Salut'),
  ('31', 'la-vila-de-gracia', 'la Vila de Gràcia'),
  ('32', 'el-camp-d-en-grassot-i-gracia-nova', 'el Camp d''en Grassot i Gràcia Nova'),
  ('33', 'el-baix-guinardo', 'el Baix Guinardó'),
  ('34', 'can-baro', 'Can Baró'),
  ('35', 'el-guinardo', 'el Guinardó'),
  ('36', 'la-font-d-en-fargues', 'la Font d''en Fargues'),
  ('37', 'el-carmel', 'el Carmel'),
  ('38', 'la-teixonera', 'la Teixonera'),
  ('39', 'sant-genis-dels-agudells', 'Sant Genís dels Agudells'),
  ('40', 'montbau', 'Montbau'),
  ('41', 'la-vall-d-hebron', 'la Vall d''Hebron'),
  ('42', 'la-clota', 'la Clota'),
  ('43', 'horta', 'Horta'),
  ('44', 'vilapicina-i-la-torre-llobeta', 'Vilapicina i la Torre Llobeta'),
  ('45', 'porta', 'Porta'),
  ('46', 'el-turo-de-la-peira', 'el Turó de la Peira'),
  ('47', 'can-peguera', 'Can Peguera'),
  ('48', 'la-guineueta', 'la Guineueta'),
  ('49', 'canyelles', 'Canyelles'),
  ('50', 'les-roquetes', 'les Roquetes'),
  ('51', 'verdun', 'Verdun'),
  ('52', 'la-prosperitat', 'la Prosperitat'),
  ('53', 'la-trinitat-nova', 'la Trinitat Nova'),
  ('54', 'torre-baro', 'Torre Baró'),
  ('55', 'ciutat-meridiana', 'Ciutat Meridiana'),
  ('56', 'vallbona', 'Vallbona'),
  ('57', 'la-trinitat-vella', 'la Trinitat Vella'),
  ('58', 'baro-de-viver', 'Baró de Viver'),
  ('59', 'el-bon-pastor', 'el Bon Pastor'),
  ('60', 'sant-andreu', 'Sant Andreu'),
  ('61', 'la-sagrera', 'la Sagrera'),
  ('62', 'el-congres-i-els-indians', 'el Congrés i els Indians'),
  ('63', 'navas', 'Navas'),
  ('64', 'el-camp-de-l-arpa-del-clot', 'el Camp de l''Arpa del Clot'),
  ('65', 'el-clot', 'el Clot'),
  ('66', 'el-parc-i-la-llacuna-del-poblenou', 'el Parc i la Llacuna del Poblenou'),
  ('67', 'la-vila-olimpica-del-poblenou', 'la Vila Olímpica del Poblenou'),
  ('68', 'el-poblenou', 'el Poblenou'),
  ('69', 'diagonal-mar-i-el-front-maritim-del-poblenou', 'Diagonal Mar i el Front Marítim del Poblenou'),
  ('70', 'el-besos-i-el-maresme', 'el Besòs i el Maresme'),
  ('71', 'provencals-del-poblenou', 'Provençals del Poblenou'),
  ('72', 'sant-marti-de-provencals', 'Sant Martí de Provençals'),
  ('73', 'la-verneda-i-la-pau', 'la Verneda i la Pau')
;

-- ------------------------------------------------------------
-- NB1. Barcelona y el seed, en el orden migraciones → seed
-- ------------------------------------------------------------
select roomly_test.ok(
  (select count(*) = 73 and count(distinct slug) = 73 and count(distinct name) = 73
          and count(distinct code) = 73 and min(code) = '01' and max(code) = '73'
   from roomly_test.official_neighborhoods),
  'NB0: la lista del test tiene 73 barrios distintos (códigos 01–73)');
select roomly_test.ok(
  (select count(*) = 1 from public.cities where slug = 'barcelona')
  and (select name = 'Barcelona' and is_active and center_lat = 41.3874 and center_lng = 2.1686
       from public.cities where slug = 'barcelona'),
  'NB1: Barcelona existe una sola vez, activa, con los valores del seed');
select roomly_test.ok(
  (select count(*) = 9 from public.cities)
  and (select count(*) = 7 from public.universities u
       join public.cities c on c.id = u.city_id where c.slug = 'barcelona'),
  'NB1: el seed terminó después de la migración: 9 ciudades y 7 universidades de Barcelona');

-- ------------------------------------------------------------
-- NB2. Los 73 barrios oficiales, exactos y sin coordenadas
-- ------------------------------------------------------------
select roomly_test.ok(
  (select count(*) = 73
   from roomly_test.official_neighborhoods o
   join public.neighborhoods n on n.slug = o.slug and n.name = o.name
   join public.cities c on c.id = n.city_id and c.slug = 'barcelona'),
  'NB2: los 73 barrios oficiales están en Barcelona con su slug y su nombre');
select roomly_test.ok(
  not exists (select 1 from public.neighborhoods n
              join roomly_test.official_neighborhoods o on o.slug = n.slug
              join public.cities c on c.id = n.city_id
              where c.slug <> 'barcelona'),
  'NB2: ninguno está en otra ciudad');
select roomly_test.ok(
  (select count(*) = 73
   from public.neighborhoods n
   join roomly_test.official_neighborhoods o on o.slug = n.slug
   join public.cities c on c.id = n.city_id and c.slug = 'barcelona'
   where n.center_lat is null and n.center_lng is null),
  'NB2: sin coordenadas (R2)');
select roomly_test.ok(
  not exists (
    select 1 from public.neighborhoods n
    join public.cities c on c.id = n.city_id and c.slug = 'barcelona'
    join roomly_test.official_neighborhoods o on lower(o.name) = lower(n.name)
    where n.slug <> o.slug),
  'NB3: ningún otro barrio de Barcelona repite el nombre de uno oficial con otro slug');
select roomly_test.ok(
  (select md5(string_agg(n.slug || '|' || n.name, chr(10) order by n.slug collate "C"))
   from public.neighborhoods n
   join public.cities c on c.id = n.city_id and c.slug = 'barcelona'
   where n.slug in (select slug from roomly_test.official_neighborhoods))
  = '9847876cf9e43791d3ad0a206f28813a',
  'NB4: la huella del catálogo es la que exige P1 del preflight');

-- ------------------------------------------------------------
-- NB5. El catálogo no lo escribe el cliente (salvo un admin, como hasta ahora)
-- ------------------------------------------------------------
insert into auth.users (id, email) values
  ('18000000-0000-0000-0000-00000000000a', 'barrios-o@test'),
  ('18000000-0000-0000-0000-0000000000ad', 'barrios-admin@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('18000000-0000-0000-0000-00000000000a', 'Propietaria barrios', '2000-01-01', 'has_room_looking_for_roommate');
insert into public.profiles (id, full_name, date_of_birth, seeking_status, role) values
  ('18000000-0000-0000-0000-0000000000ad', 'Admin barrios', '1990-01-01', 'looking_for_room', 'admin');
set role authenticated;
select roomly_test.login('18000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.neighborhoods n join public.cities c on c.id = n.city_id
    where c.slug = 'barcelona' and n.slug = 'el-raval'$$,
  1, 'NB5: un usuario autenticado lee los barrios');
select roomly_test.expect_error(
  $$insert into public.neighborhoods (city_id, name, slug)
    select id, 'Barrio inventado', 'barrio-inventado' from public.cities where slug = 'barcelona'$$,
  '42501', 'NB5: pero no añade barrios');
select roomly_test.expect_affected(
  $$update public.neighborhoods set name = 'Raval' where slug = 'el-raval'$$,
  0, 'NB5: ni renombra uno oficial');
select roomly_test.expect_affected(
  $$delete from public.neighborhoods where slug = 'la-barceloneta'$$,
  0, 'NB5: ni lo borra');
set role anon;
select roomly_test.login(null);
select roomly_test.expect_rows(
  $$select 1 from public.neighborhoods where slug = 'el-raval'$$,
  1, 'NB5: anon también los lee');
select roomly_test.expect_error(
  $$insert into public.neighborhoods (city_id, name, slug)
    select id, 'Barrio inventado', 'barrio-inventado' from public.cities where slug = 'barcelona'$$,
  '42501', 'NB5: pero no los escribe');
reset role;
begin;
set role authenticated;
select roomly_test.login('18000000-0000-0000-0000-0000000000ad');
select roomly_test.expect_affected(
  $$update public.neighborhoods set name = 'Raval' where slug = 'el-raval'$$,
  1, 'NB5-control: el admin sí lo renombraría (política de la Fase 0, sin cambios)');
reset role;
rollback;
select roomly_test.ok(
  (select count(*) = 1 from public.neighborhoods where slug = 'el-raval' and name = 'el Raval'),
  'NB5: el renombrado del control se deshace y el oficial sigue intacto');

-- ------------------------------------------------------------
-- NB6. Los barrios oficiales con las reglas de la 4.1 y las preferencias
-- ------------------------------------------------------------
set role authenticated;
select roomly_test.login('18000000-0000-0000-0000-00000000000a');
select roomly_test.expect_affected(
  $$insert into public.rooms (id, owner_id, title, city_id, neighborhood_id, price_month,
                             available_from, total_roommates, total_rooms)
    select '18100000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-00000000000a',
           'Habitación en el Raval', c.id, n.id, 450, '2026-11-01', 2, 3
    from public.cities c join public.neighborhoods n on n.city_id = c.id and n.slug = 'el-raval'
    where c.slug = 'barcelona'$$,
  1, 'NB6: un borrador en un barrio oficial de Barcelona entra');
select roomly_test.expect_affected(
  $$update public.rooms set status = 'active' where id = '18100000-0000-0000-0000-000000000001'$$,
  1, 'NB6: y se publica');
select roomly_test.expect_error(
  $$update public.rooms set city_id = (select id from public.cities where slug = 'madrid')
    where id = '18100000-0000-0000-0000-000000000001'$$,
  '23503', 'NB6: un barrio oficial de Barcelona no vale para una habitación de Madrid');
reset role;
select roomly_test.expect_affected(
  $$insert into public.housing_preferences (profile_id, city_id, preferred_neighborhood_ids)
    select '18000000-0000-0000-0000-00000000000a', c.id, array_agg(n.id)
    from public.cities c join public.neighborhoods n on n.city_id = c.id
    where c.slug = 'barcelona' and n.slug in ('el-raval', 'la-vila-de-gracia')
    group by c.id$$,
  1, 'NB6: las preferencias aceptan barrios oficiales de su ciudad');
select roomly_test.expect_error(
  $$update public.housing_preferences
    set city_id = (select id from public.cities where slug = 'madrid')
    where profile_id = '18000000-0000-0000-0000-00000000000a'$$,
  '23514', 'NB6: pero no con otra ciudad');
select roomly_test.expect_error(
  $$delete from public.neighborhoods where slug = 'el-raval'$$,
  '23503', 'NB6: un barrio oficial en uso no se borra');
