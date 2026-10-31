-- ============================================================
-- PROPUESTA (sesión 73) — NO ES UNA MIGRACIÓN
-- ============================================================
-- Endurecimiento de los privilegios por defecto del rol `postgres` en el
-- esquema `public`. Está fuera de supabase/migrations a propósito: nada la
-- aplica. La prueba tests/supabase/default-privileges-selftest.sh (local) y,
-- antes de convertirla en migración, el propietario tiene que revisar el
-- estado real de cada proyecto (consulta Q6 del runbook,
-- docs/INCIDENT_PUBLIC_PROFILE_PREVIEWS.md).
--
-- Qué cambia (solo para objetos NUEVOS que cree `postgres`; los existentes no
-- cambian, comprobado en local):
--   - tablas, vistas y vistas materializadas: ningún privilegio para anon ni
--     authenticated (service_role conserva ALL);
--   - secuencias: ídem;
--   - funciones: ningún EXECUTE para anon ni authenticated, y tampoco para
--     PUBLIC, que lo recibe «de fábrica» en PostgreSQL y que un REVOKE por
--     esquema no puede quitar (hace falta uno global, sin IN SCHEMA).
-- Después, cada objeto nuevo necesita su GRANT explícito para los roles que
-- deban usarlo (como ya hacen las migraciones con sus funciones).
--
-- Qué NO cambia: los privilegios por defecto de otros roles (por ejemplo
-- `supabase_admin`, que no administramos), los de otros esquemas, ni ningún
-- objeto existente.
--
-- Falla de forma segura: solo actúa si los privilegios por defecto de
-- `postgres` son EXACTAMENTE los esperados (los de Supabase según el shim) o
-- si ya está aplicada (no hace nada). Cualquier otro estado aborta sin
-- cambiar nada y muestra lo que encontró. Ejecutar como `postgres` y en una
-- transacción.
--
-- Lo que comprobó el autotest local (sesión 73) y condiciona su uso:
--   - Hoy, 60 objetos (las 18 tablas, las funciones de public y las de
--     pgcrypto local) tienen privilegios de anon o authenticated que SOLO
--     vienen de los privilegios por defecto; por ejemplo, el SELECT de
--     authenticated en profiles. Por eso solo vale como migración POSTERIOR a
--     todas las existentes (el orden de los timestamps lo garantiza también
--     en una instalación desde cero) y nunca delante.
--   - Una migración futura que BORRE y vuelva a crear un objeto existente
--     (DROP + CREATE) le quita esos privilegios: tiene que concederlos
--     explícitamente. CREATE OR REPLACE conserva los que ya tenía.
--   - Las funciones nuevas de 4.1–4.4 ya revocan todo y conceden EXECUTE
--     explícito; los helpers de tests/db (roomly_test) también
--     (tests/db/helpers.sql), así que la suite SQL pasa sin cambios.
--   - El REVOKE global de EXECUTE a PUBLIC afecta a las funciones que cree
--     `postgres` en CUALQUIER esquema. Hoy todas las funciones de las
--     migraciones están en public.
--   - Efecto operativo: una tabla creada después desde el panel de Supabase
--     por `postgres` no será accesible por la Data API hasta su GRANT.
--   - El estado real de pg_default_acl en los proyectos NO se ha consultado
--     (no hay autorización para SQL remoto). Si difiere de `original` (p. ej.
--     porque Supabase lista también a `postgres` como destinatario), la
--     propuesta aborta: ajustar `original` es una decisión revisada, no un
--     cambio automático.

do $$
declare
  state text;
  -- Estado de partida esperado: por esquema `public`, tablas (r), secuencias
  -- (S) y funciones (f) con todos sus privilegios para anon, authenticated y
  -- service_role; ninguna entrada global de `postgres`. Si el proyecto real
  -- también lista a `postgres` como destinatario, hay que revisarlo y
  -- ajustar esta línea a propósito: no se acepta por omisión.
  original constant text :=
    'public|S|anon=SELECT+UPDATE+USAGE,authenticated=SELECT+UPDATE+USAGE,service_role=SELECT+UPDATE+USAGE;'
    'public|f|anon=EXECUTE,authenticated=EXECUTE,service_role=EXECUTE;'
    'public|r|anon=DELETE+INSERT+REFERENCES+SELECT+TRIGGER+TRUNCATE+UPDATE,authenticated=DELETE+INSERT+REFERENCES+SELECT+TRIGGER+TRUNCATE+UPDATE,service_role=DELETE+INSERT+REFERENCES+SELECT+TRIGGER+TRUNCATE+UPDATE';
  hardened constant text :=
    '(global)|f|postgres=EXECUTE;'
    'public|S|service_role=SELECT+UPDATE+USAGE;'
    'public|f|service_role=EXECUTE;'
    'public|r|service_role=DELETE+INSERT+REFERENCES+SELECT+TRIGGER+TRUNCATE+UPDATE';
begin
  if current_user <> 'postgres' then
    raise exception 'default_privileges_hardening: hay que ejecutarla como postgres (current_user = %)', current_user;
  end if;

  select string_agg(entry, ';' order by entry collate "C") into state
  from (
    select format('%s|%s|%s', coalesce(n.nspname, '(global)'), d.defaclobjtype,
             (select string_agg(g.grantee || '=' || g.privs, ',' order by g.grantee collate "C")
              from (select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
                           string_agg(a.privilege_type, '+' order by a.privilege_type collate "C") as privs
                    from aclexplode(d.defaclacl) a group by 1) g)) as entry
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclrole = 'postgres'::regrole
  ) entries;

  if state = hardened then
    raise notice 'default_privileges_hardening: ya aplicada; no cambia nada';
    return;
  end if;
  if state is distinct from original then
    raise exception 'default_privileges_hardening: los privilegios por defecto de postgres no son los esperados; no se cambia nada. Encontrado: %', coalesce(state, '(ninguno)');
  end if;

  execute 'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated';
  execute 'alter default privileges for role postgres revoke execute on functions from public';

  select string_agg(entry, ';' order by entry collate "C") into state
  from (
    select format('%s|%s|%s', coalesce(n.nspname, '(global)'), d.defaclobjtype,
             (select string_agg(g.grantee || '=' || g.privs, ',' order by g.grantee collate "C")
              from (select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
                           string_agg(a.privilege_type, '+' order by a.privilege_type collate "C") as privs
                    from aclexplode(d.defaclacl) a group by 1) g)) as entry
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclrole = 'postgres'::regrole
  ) entries;
  if state is distinct from hardened then
    raise exception 'default_privileges_hardening: el resultado no es el esperado; se deshace. Resultado: %', coalesce(state, '(ninguno)');
  end if;
  raise notice 'default_privileges_hardening: aplicada';
end $$;
