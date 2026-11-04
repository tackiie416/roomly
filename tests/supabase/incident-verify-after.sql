-- ============================================================
-- Incidente public_profile_previews — VERIFICACIÓN después de aplicar el
-- hotfix 20261014120000 (contención, paso 3). Solo lectura.
-- Runbook: docs/INCIDENT_PUBLIC_PROFILE_PREVIEWS.md.
-- ============================================================
-- Devuelve dos líneas, cada una «OK: …» o «FALLO: …». Funciona en psql y en
-- el editor SQL. Si alguna dice FALLO, la contención no está hecha: no
-- sigas; revisa Q2 de la captura (¿otro concedente?).

begin transaction read only;

-- V1 La vista existe, tiene el comentario del hotfix y PUBLIC, anon y
-- authenticated no tienen NINGÚN privilegio (ni por tabla ni por columnas).
with vista as (
  select c.oid, coalesce(obj_description(c.oid, 'pg_class'), '') as comentario
  from pg_class c
  where c.oid = to_regclass('public.public_profile_previews')
),
privs as (
  select r || ':' || p as concedido
  from vista v
  cross join unnest(array['public', 'anon', 'authenticated']) r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  where has_table_privilege(r, v.oid, p)
     or (p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege(r, v.oid, p))
)
select case
  when not exists (select 1 from vista) then
    'FALLO: V1 public.public_profile_previews no existe en esta base de datos (¿proyecto equivocado?)'
  when exists (select 1 from privs) then
    'FALLO: V1 la vista sigue dando privilegios a clientes: '
      || (select string_agg(concedido, ' ' order by concedido) from privs)
  when (select comentario from vista) not like '%20261014120000%' then
    'FALLO: V1 sin privilegios de clientes, pero sin el comentario del hotfix (¿aplicado a mano?)'
  else 'OK: V1 public_profile_previews sin privilegios para PUBLIC, anon ni authenticated (hotfix 20261014120000)'
end as v1;

-- V2 Ninguna OTRA vista de public deja escribir a esos roles, y ninguna vista
-- con security_invoker = false ni materializada les deja hacer nada (la
-- misma regla que P5 del preflight).
with clientes as (
  select c.oid::regclass::text || ' (' || r || ':' || p || ')' as hallazgo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['public', 'anon', 'authenticated']) r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and (has_table_privilege(r, c.oid, p)
         or (p in ('SELECT', 'INSERT', 'UPDATE') and has_any_column_privilege(r, c.oid, p)))
    and (p <> 'SELECT'
         or c.relkind = 'm'
         or not coalesce(c.reloptions && array['security_invoker=true', 'security_invoker=on'], false))
)
select case
  when exists (select 1 from clientes) then
    'FALLO: V2 vistas con privilegios de clientes indebidos: '
      || (select string_agg(hallazgo, ', ' order by hallazgo) from clientes)
  else 'OK: V2 ninguna vista de public da escritura a clientes, ni lectura si es security_invoker = false o materializada'
end as v2;

rollback;
