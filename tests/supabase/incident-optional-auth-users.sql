-- ============================================================
-- Incidente public_profile_previews — Q11: cuentas de Auth sin perfil.
-- Runbook: docs/INCIDENT_PUBLIC_PROFILE_PREVIEWS.md.
-- ============================================================
-- Archivo de psql (usa \gset e \if). En el editor SQL de Supabase se ejecuta
-- directamente la consulta Q11 (allí auth.users siempre tiene esas columnas).
--
-- Solo existe en Supabase: el shim local de tests/db tiene un auth.users
-- mínimo (id y email). Si faltan las columnas, este archivo lo dice y no hace
-- nada. Necesita leer auth.users (en Supabase, `postgres` puede; no
-- comprobado en estos proyectos).
--
-- Es un indicio AMBIGUO: una cuenta sin perfil puede venir de un borrado por
-- la vista (que además borra en cascada sus datos) o de alguien que no
-- terminó el alta. La salida lleva ids y fechas: solo en la evidencia
-- privada; en el informe compartido, el recuento.

select count(*) = 2 as q11_aplica
from pg_attribute
where attrelid = to_regclass('auth.users')
  and attname in ('created_at', 'last_sign_in_at')
  and not attisdropped
\gset

\if :q11_aplica
  begin transaction read only;
  -- Q11 Cuentas de Auth sin fila en public.profiles.
  select u.id, u.created_at, u.last_sign_in_at
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  order by u.last_sign_in_at desc nulls last;
  select count(*) as cuentas_sin_perfil
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id);
  rollback;
\else
  \echo 'Q11 omitida: auth.users no tiene created_at ni last_sign_in_at (no es Supabase).'
\endif
