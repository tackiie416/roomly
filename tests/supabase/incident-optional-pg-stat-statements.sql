-- ============================================================
-- Incidente public_profile_previews — Q8, OPCIONAL: pg_stat_statements.
-- Runbook: docs/INCIDENT_PUBLIC_PROFILE_PREVIEWS.md.
-- ============================================================
-- Archivo de psql (usa \gset e \if). En el editor SQL de Supabase: ejecuta
-- Q8a y, solo si dice instalada = true, Q8b cambiando `extensions` por el
-- esquema que muestre Q8a.
--
-- Es opcional: si la extensión no está instalada, este archivo lo dice y no
-- hace nada, y eso no es un fallo. Requisitos para que el resultado sirva:
--   - la extensión instalada (en Supabase se cree que vive en el esquema
--     `extensions`; no se ha comprobado en estos proyectos: Q8a lo muestra);
--   - cargada en shared_preload_libraries; si no, Q8b da el error «must be
--     loaded via shared_preload_libraries» y Q8 no aplica;
--   - ver el texto de las consultas de OTROS roles: hace falta ser
--     superusuario o miembro de pg_read_all_stats. Si no, su texto sale como
--     «<insufficient privilege>» y el filtro de Q8b las descarta EN SILENCIO:
--     un resultado vacío no significa nada (columna lee_todas_las_consultas).
-- Aun con todo eso, las entradas se pierden con un reinicio de estadísticas o
-- cuando salen del límite (pg_stat_statements.max). Que no aparezca nada no
-- demuestra que no hubo uso indebido.

-- Q8a Precomprobación (solo catálogo).
select exists (select 1 from pg_extension where extname = 'pg_stat_statements') as q8_instalada,
       coalesce((select extnamespace::regnamespace::text from pg_extension
                 where extname = 'pg_stat_statements'), '(no instalada)') as q8_esquema,
       (select extversion from pg_extension where extname = 'pg_stat_statements') as q8_version,
       (select r.rolsuper or pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')
        from pg_roles r where r.rolname = current_user) as lee_todas_las_consultas
\gset
\echo Q8a: instalada=:q8_instalada esquema=:q8_esquema version=:q8_version lee_todas_las_consultas=:lee_todas_las_consultas

\if :q8_instalada
  -- Un error aquí (p. ej. no está precargada) no debe abortar el resto del
  -- runbook: esta parte es opcional.
  \set ON_ERROR_STOP off
  begin transaction read only;
  -- Q8b Consultas acumuladas sobre la vista, por rol. Un INSERT, UPDATE o
  -- DELETE de anon o authenticated es sospechoso: los tests reales solo
  -- leían la vista.
  select r.rolname as rol, s.calls as llamadas, s.rows as filas,
         left(s.query, 300) as consulta
  from :"q8_esquema".pg_stat_statements s
  join pg_roles r on r.oid = s.userid
  where s.query ilike '%public_profile_previews%'
  order by s.calls desc;
  -- Desde cuándo acumula (pg_stat_statements 1.9 o posterior).
  select stats_reset as acumula_desde from :"q8_esquema".pg_stat_statements_info;
  rollback;
  \set ON_ERROR_STOP on
\else
  \echo 'Q8 omitida: pg_stat_statements no está instalada en esta base de datos (no es un fallo).'
\endif
