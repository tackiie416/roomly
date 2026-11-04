-- ============================================================
-- Incidente public_profile_previews — CAPTURA de solo lectura (Q0–Q7, Q9,
-- Q10, Q12). Runbook: docs/INCIDENT_PUBLIC_PROFILE_PREVIEWS.md.
-- ============================================================
-- No cambia nada: todo va en una transacción READ ONLY que termina en
-- ROLLBACK. Funciona en psql y en el editor SQL de Supabase (sin comandos
-- de psql). No falla si la vista no existe (to_regclass) ni si faltan roles
-- o tablas posteriores a la Fase 1.
--
-- Quién la ejecuta: el propietario, con autorización, conectado como
-- `postgres` (dueño de las tablas y con BYPASSRLS). Q0–Q7 y Q12 leen el
-- catálogo y las estadísticas, y valen con cualquier rol. Q9 y Q10 leen
-- public.profiles: sin BYPASSRLS (ni ser superusuario ni el dueño) la RLS
-- filtra las filas EN SILENCIO y los recuentos salen más bajos o vacíos;
-- Q9a lo indica.
--
-- Las salidas contienen ids y fechas: se guardan en un sitio privado (ver el
-- runbook, «Evidencias»), nunca en un informe compartido.
-- Comprobado en local con tests/supabase/incident-runbook-selftest.sh.

begin transaction read only;

-- Q0 Identidad del proyecto: la marca de la base de datos y la versión.
select current_user as rol_actual,
       current_database() as base_de_datos,
       coalesce(shobj_description(d.oid, 'pg_database'), '(sin marca)') as marca,
       current_setting('server_version') as version_pg,
       now() as capturado_en
from pg_database d
where d.datname = current_database();

-- Q1 La vista: dueño, opciones, si admite escritura y si tiene el hotfix.
-- mascara_escritura 28 = admite INSERT, UPDATE y DELETE (lo esperado: el
-- hotfix quita privilegios, no cambia la vista). Sin filas: la vista no existe.
select c.oid::regclass as vista,
       pg_get_userbyid(c.relowner) as dueno,
       c.reloptions as opciones,
       pg_relation_is_updatable(c.oid::regclass, false) as mascara_escritura,
       coalesce(obj_description(c.oid, 'pg_class'), '') like '%20261014120000%' as hotfix_aplicado,
       obj_description(c.oid, 'pg_class') as comentario
from pg_class c
where c.oid = to_regclass('public.public_profile_previews');

-- Q2 ACL de la vista, con QUIÉN concedió cada privilegio. Si aparece un
-- concedente distinto de `postgres` (el dueño), el hotfix no puede quitarlo:
-- su comprobación final aborta sin cambiar nada. Parar y decidir.
select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as rol,
       pg_get_userbyid(a.grantor) as concedido_por,
       a.privilege_type as privilegio,
       a.is_grantable as con_grant_option
from pg_class c,
     aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where c.oid = to_regclass('public.public_profile_previews')
order by 1, 3;

-- Q2b Privilegios por columnas de la vista (un GRANT por columnas no aparece
-- en Q2).
select c.oid::regclass as vista, a.attname as columna, a.attacl as acl_columna
from pg_class c
join pg_attribute a on a.attrelid = c.oid
where c.oid = to_regclass('public.public_profile_previews')
  and a.attnum > 0 and not a.attisdropped and a.attacl is not null
order by 2;

-- Q3 Privilegios EFECTIVOS (incluye PUBLIC, pertenencias y columnas).
-- Vulnerable: cualquier `true` en INSERT, UPDATE o DELETE para public, anon o
-- authenticated. Con el hotfix: todo `false` para esos tres.
select x.rol,
       p.priv as privilegio,
       has_table_privilege(x.rol, c.oid, p.priv) as en_la_vista,
       case when p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            then has_any_column_privilege(x.rol, c.oid, p.priv) end as en_alguna_columna
from pg_class c
cross join (
  select 'public'::text as rol
  union all
  select rolname::text from pg_roles
  where rolname in ('anon', 'authenticated', 'authenticator', 'service_role')
) x
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
where c.oid = to_regclass('public.public_profile_previews')
order by 1, 2;

-- Q4 Roles y pertenencias (quién puede actuar como anon o authenticated, y
-- de quién heredan).
select rolname, rolsuper, rolinherit, rolcanlogin, rolbypassrls
from pg_roles
where rolname in ('postgres', 'supabase_admin', 'authenticator', 'anon', 'authenticated', 'service_role')
order by 1;
select m.roleid::regrole as rol, m.member::regrole as miembro, m.admin_option
from pg_auth_members m
where m.member::regrole::text in ('anon', 'authenticated', 'authenticator')
   or m.roleid::regrole::text in ('anon', 'authenticated', 'service_role')
order by 1, 2;

-- Q5 TODAS las vistas y vistas materializadas de public, con lo que pueden
-- hacer PUBLIC, anon y authenticated (tabla y columnas). Lo mismo que vigila
-- P5 del preflight.
select c.oid::regclass as vista,
       case c.relkind when 'm' then 'materializada' else 'vista' end as tipo,
       pg_get_userbyid(c.relowner) as dueno,
       coalesce(c.reloptions::text, '(sin opciones: security_invoker = false)') as opciones,
       (select string_agg(r || ':' || p, ' ' order by r, p)
        from unnest(array['public', 'anon', 'authenticated']) r
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
        where has_table_privilege(r, c.oid, p)
           or (p in ('SELECT', 'INSERT', 'UPDATE') and has_any_column_privilege(r, c.oid, p))) as clientes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')
order by 1;

-- Q6 Privilegios por defecto reales (todas las entradas, de todos los
-- creadores) y quién puede crear objetos en public. Necesaria antes de
-- decidir la propuesta tests/supabase/default-privileges-proposal.sql.
select pg_get_userbyid(d.defaclrole) as creador,
       coalesce(n.nspname, '(global)') as esquema,
       d.defaclobjtype::text as tipo,
       d.defaclacl::text as acl
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
order by 1, 2, 3;
select rolname as puede_crear_en_public
from pg_roles
where has_schema_privilege(oid, 'public', 'CREATE')
order by 1;

-- Q7 Fuentes de registro y qué puede ver este rol. No supongas ninguna.
-- Se lee pg_settings y no current_setting(): sin ser superusuario ni miembro
-- de pg_read_all_settings, shared_preload_libraries está OCULTA
-- (oculta_para_este_rol = true) y current_setting() daría un error.
select s0.nombre, s.setting as valor, s.name is null as oculta_para_este_rol
from unnest(array['log_statement', 'log_min_duration_statement', 'shared_preload_libraries']) s0(nombre)
left join pg_settings s on s.name = s0.nombre
order by 1;
select extname as extension, extversion as version, extnamespace::regnamespace as esquema
from pg_extension
where extname in ('pg_stat_statements', 'pgaudit', 'pg_graphql', 'pg_net')
order by 1;
select r.rolsuper as superusuario,
       r.rolbypassrls as bypassrls,
       pg_has_role(current_user, 'pg_read_all_settings', 'USAGE') as lee_toda_la_configuracion,
       pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') as lee_todas_las_estadisticas
from pg_roles r
where r.rolname = current_user;

-- Q9a ¿Ve este rol TODAS las filas de profiles? Hace falta ser superusuario,
-- tener BYPASSRLS o ser (miembro del) dueño sin FORCE ROW LEVEL SECURITY. Si
-- dice false, Q9 y Q10 NO valen: la RLS filtra en silencio (puede salir
-- vacío). Va en una fila aparte porque, si la RLS lo filtra todo, Q9 no
-- devolvería ninguna fila donde avisarlo.
select r.rolname as rol_actual,
       r.rolsuper or r.rolbypassrls
         or (pg_has_role(r.oid, c.relowner, 'USAGE') and not c.relforcerowsecurity) as ve_todas_las_filas
from pg_roles r, pg_class c
where r.rolname = current_user and c.oid = to_regclass('public.profiles');

-- Q9 Roles de las cuentas: recuentos (compartibles) e ids de admins (solo en
-- la evidencia privada; compárala con la lista de admins legítimos).
select role, (deleted_at is not null) as desactivada, count(*) as cuentas
from public.profiles
group by 1, 2
order by 1, 2;
select id, created_at, updated_at
from public.profiles
where role = 'admin'
order by updated_at desc;

-- Q10 Última edición por día (updated_at guarda solo la ÚLTIMA: una edición
-- legítima posterior tapa la anterior). Vale solo si Q9a dice true.
select date_trunc('day', updated_at) as dia, count(*) as perfiles
from public.profiles
group by 1
order by 1;

-- Q12 Contadores acumulados desde el último reinicio de estadísticas (no dicen
-- quién ni cuándo).
select relname as tabla, n_tup_ins as insertadas, n_tup_upd as actualizadas, n_tup_del as borradas
from pg_stat_user_tables
where schemaname = 'public'
  and relname in ('profiles', 'housing_preferences', 'compatibility_responses', 'rooms')
order by 1;
select stats_reset as estadisticas_desde
from pg_stat_database
where datname = current_database();

rollback;
