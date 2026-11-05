-- Fase 4.1 — R1: catálogo de barrios oficiales de Barcelona (solo datos).
--
-- Fuente: Ajuntament de Barcelona, Open Data BCN. Archivo
-- BarcelonaCiutat_Barris.json, facilitado por el propietario el 2026-10-16
-- (sha256 038ccc3e124493afa9378187968e29c79519d63522fac3733ce035fe19207990).
-- Licencia CC BY 4.0: hay que reconocer la autoría del Ajuntament de
-- Barcelona. El archivo no se versiona; esta migración no depende de él.
--
-- Contenido verificado del archivo: 73 barrios (codi_barri 01–73, sin huecos)
-- de los 10 districtes; sus geometrías suman 101,70 km². De cada barrio se
-- carga:
--   - name: nom_barri, tal cual;
--   - slug: derivado de nom_barri (minúsculas, sin acentos, y cada tramo que no
--     sea [a-z0-9] pasa a ser un «-»). Es la clave estable del barrio en la
--     ciudad: si un nombre oficial cambia, una migración posterior actualiza
--     `name` y conserva el slug.
-- El codi_barri queda aquí para trazar cada fila, pero no se guarda: no hay
-- columna para él. No se cargan el distrito ni coordenadas (R2: center_lat y
-- center_lng quedan vacíos).
--
-- Orden: en una instalación limpia las migraciones van antes que
-- supabase/seed.sql, que es quien crea Barcelona. Si Barcelona aún no existe,
-- esta migración la crea con los mismos valores que el seed, y el seed ya no
-- falla al encontrarla (`on conflict (slug) do nothing`). En una instalación
-- existente, Barcelona ya está y solo se añaden los barrios que falten.
--
-- Idempotente: volver a ejecutarla no cambia nada. Todo va en un único bloque,
-- así que, aun fuera de una transacción, o se aplica entero o no se aplica.
--
-- Datos incompatibles: si Barcelona ya tiene algún barrio que no coincide
-- exactamente (slug y nombre) con uno oficial, se detiene sin escribir nada
-- (`23514`, `neighborhoods_r1_precheck:`). No borra, renombra ni fusiona
-- barrios: quien opere la base de datos decide antes de reintentar.
--
-- Sin cambios de esquema, políticas, triggers, funciones ni permisos.

do $$
declare
  -- codi_barri, slug, nom_barri
  official constant text[] := array[
    ['01', 'el-raval', 'el Raval'],
    ['02', 'el-barri-gotic', 'el Barri Gòtic'],
    ['03', 'la-barceloneta', 'la Barceloneta'],
    ['04', 'sant-pere-santa-caterina-i-la-ribera', 'Sant Pere, Santa Caterina i la Ribera'],
    ['05', 'el-fort-pienc', 'el Fort Pienc'],
    ['06', 'la-sagrada-familia', 'la Sagrada Família'],
    ['07', 'la-dreta-de-l-eixample', 'la Dreta de l''Eixample'],
    ['08', 'l-antiga-esquerra-de-l-eixample', 'l''Antiga Esquerra de l''Eixample'],
    ['09', 'la-nova-esquerra-de-l-eixample', 'la Nova Esquerra de l''Eixample'],
    ['10', 'sant-antoni', 'Sant Antoni'],
    ['11', 'el-poble-sec', 'el Poble-sec'],
    ['12', 'la-marina-del-prat-vermell', 'la Marina del Prat Vermell'],
    ['13', 'la-marina-de-port', 'la Marina de Port'],
    ['14', 'la-font-de-la-guatlla', 'la Font de la Guatlla'],
    ['15', 'hostafrancs', 'Hostafrancs'],
    ['16', 'la-bordeta', 'la Bordeta'],
    ['17', 'sants-badal', 'Sants - Badal'],
    ['18', 'sants', 'Sants'],
    ['19', 'les-corts', 'les Corts'],
    ['20', 'la-maternitat-i-sant-ramon', 'la Maternitat i Sant Ramon'],
    ['21', 'pedralbes', 'Pedralbes'],
    ['22', 'vallvidrera-el-tibidabo-i-les-planes', 'Vallvidrera, el Tibidabo i les Planes'],
    ['23', 'sarria', 'Sarrià'],
    ['24', 'les-tres-torres', 'les Tres Torres'],
    ['25', 'sant-gervasi-la-bonanova', 'Sant Gervasi - la Bonanova'],
    ['26', 'sant-gervasi-galvany', 'Sant Gervasi - Galvany'],
    ['27', 'el-putxet-i-el-farro', 'el Putxet i el Farró'],
    ['28', 'vallcarca-i-els-penitents', 'Vallcarca i els Penitents'],
    ['29', 'el-coll', 'el Coll'],
    ['30', 'la-salut', 'la Salut'],
    ['31', 'la-vila-de-gracia', 'la Vila de Gràcia'],
    ['32', 'el-camp-d-en-grassot-i-gracia-nova', 'el Camp d''en Grassot i Gràcia Nova'],
    ['33', 'el-baix-guinardo', 'el Baix Guinardó'],
    ['34', 'can-baro', 'Can Baró'],
    ['35', 'el-guinardo', 'el Guinardó'],
    ['36', 'la-font-d-en-fargues', 'la Font d''en Fargues'],
    ['37', 'el-carmel', 'el Carmel'],
    ['38', 'la-teixonera', 'la Teixonera'],
    ['39', 'sant-genis-dels-agudells', 'Sant Genís dels Agudells'],
    ['40', 'montbau', 'Montbau'],
    ['41', 'la-vall-d-hebron', 'la Vall d''Hebron'],
    ['42', 'la-clota', 'la Clota'],
    ['43', 'horta', 'Horta'],
    ['44', 'vilapicina-i-la-torre-llobeta', 'Vilapicina i la Torre Llobeta'],
    ['45', 'porta', 'Porta'],
    ['46', 'el-turo-de-la-peira', 'el Turó de la Peira'],
    ['47', 'can-peguera', 'Can Peguera'],
    ['48', 'la-guineueta', 'la Guineueta'],
    ['49', 'canyelles', 'Canyelles'],
    ['50', 'les-roquetes', 'les Roquetes'],
    ['51', 'verdun', 'Verdun'],
    ['52', 'la-prosperitat', 'la Prosperitat'],
    ['53', 'la-trinitat-nova', 'la Trinitat Nova'],
    ['54', 'torre-baro', 'Torre Baró'],
    ['55', 'ciutat-meridiana', 'Ciutat Meridiana'],
    ['56', 'vallbona', 'Vallbona'],
    ['57', 'la-trinitat-vella', 'la Trinitat Vella'],
    ['58', 'baro-de-viver', 'Baró de Viver'],
    ['59', 'el-bon-pastor', 'el Bon Pastor'],
    ['60', 'sant-andreu', 'Sant Andreu'],
    ['61', 'la-sagrera', 'la Sagrera'],
    ['62', 'el-congres-i-els-indians', 'el Congrés i els Indians'],
    ['63', 'navas', 'Navas'],
    ['64', 'el-camp-de-l-arpa-del-clot', 'el Camp de l''Arpa del Clot'],
    ['65', 'el-clot', 'el Clot'],
    ['66', 'el-parc-i-la-llacuna-del-poblenou', 'el Parc i la Llacuna del Poblenou'],
    ['67', 'la-vila-olimpica-del-poblenou', 'la Vila Olímpica del Poblenou'],
    ['68', 'el-poblenou', 'el Poblenou'],
    ['69', 'diagonal-mar-i-el-front-maritim-del-poblenou', 'Diagonal Mar i el Front Marítim del Poblenou'],
    ['70', 'el-besos-i-el-maresme', 'el Besòs i el Maresme'],
    ['71', 'provencals-del-poblenou', 'Provençals del Poblenou'],
    ['72', 'sant-marti-de-provencals', 'Sant Martí de Provençals'],
    ['73', 'la-verneda-i-la-pau', 'la Verneda i la Pau']
  ];
  barcelona uuid;
  bad bigint;
  examples text;
  loaded bigint;
begin
  select id into barcelona from public.cities where slug = 'barcelona';

  if barcelona is not null then
    with o as (
      select official[i][2] as slug, official[i][3] as name
      from generate_subscripts(official, 1) as i
    )
    select count(*),
           array_to_string((array_agg(format('%s (%s)', n.slug, n.name) order by n.slug))[1:10], ', ')
      into bad, examples
    from public.neighborhoods n
    where n.city_id = barcelona
      and not exists (select 1 from o where o.slug = n.slug and o.name = n.name);
    if bad > 0 then
      raise exception using
        errcode = '23514',
        message = format('neighborhoods_r1_precheck: Barcelona tiene %s barrios que no coinciden con ninguno oficial (slug y nombre): %s. No se ha cambiado nada.', bad, examples),
        hint = 'Decide si se renombran, se sustituyen por el oficial o se borran, y vuelve a aplicar la migración.';
    end if;
  else
    -- Los mismos valores que supabase/seed.sql (lo comprueba validation-infra).
    insert into public.cities (name, slug, is_active, center_lat, center_lng)
    values ('Barcelona', 'barcelona', true, 41.3874, 2.1686)
    returning id into barcelona;
  end if;

  insert into public.neighborhoods (city_id, name, slug)
  select barcelona, official[i][3], official[i][2]
  from generate_subscripts(official, 1) as i
  on conflict (city_id, slug) do nothing;

  -- Defensa: al terminar, Barcelona tiene exactamente los oficiales.
  select count(*) into loaded
  from public.neighborhoods n, generate_subscripts(official, 1) as i
  where n.city_id = barcelona and n.slug = official[i][2] and n.name = official[i][3];
  if loaded <> array_length(official, 1) then
    raise exception using
      errcode = '23514',
      message = format('neighborhoods_r1_precheck: se esperaban %s barrios oficiales en Barcelona y hay %s. No se ha cambiado nada.',
                       array_length(official, 1), loaded);
  end if;
end $$;
