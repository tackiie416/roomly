-- ============================================================
-- Hotfix de seguridad (2026-10-31): sin privilegios de clientes sobre
-- public.public_profile_previews
-- ============================================================
-- Vulnerabilidad (comprobada en una base PostgreSQL local con las migraciones
-- de master y los privilegios por defecto de Supabase del shim):
--   - La vista se creó en 20260925120100 con `security_invoker = false`, de
--     una sola tabla (profiles) y con columnas simples: PostgreSQL la puede
--     actualizar sola (INSERT, UPDATE y DELETE se reescriben sobre profiles).
--   - Esa migración solo concede `select` a anon y authenticated, pero los
--     privilegios por defecto de Supabase (`alter default privileges in
--     schema public grant all on tables to anon, authenticated,
--     service_role`) ya les daban TODOS al crearla.
--   - Una escritura a través de una vista `security_invoker = false` se
--     comprueba con los privilegios del DUEÑO de la vista (postgres, dueño
--     también de profiles): sin la RLS de profiles ni su GRANT por columnas,
--     que no deja a authenticated escribir `role`.
--   - Resultado: un usuario autenticado se ponía `role = 'admin'`, anon
--     cambiaba el nombre o el rol de cualquier perfil activo, y anon o
--     cualquier usuario podían borrar perfiles ajenos (con su cascada).
-- No hay pruebas de que se haya explotado en un proyecto real: no se ha
-- revisado ninguno (docs/SECURITY.md, «Hotfix: public_profile_previews»).
--
-- Corrección mínima: PUBLIC, anon y authenticated pierden TODOS los
-- privilegios sobre la vista, también la lectura. Ningún código de la
-- aplicación la usa (ni en master ni en las ramas de la Fase 4); solo la
-- nombraban tests y documentación. Antes del hotfix, PUBLIC no tenía nada:
-- se revoca igualmente. No se toca:
--   - la definición de la vista (ni se borra: la migración 20261031120100 de
--     la Fase 4.4 la nombra y fallaría sin ella);
--   - service_role (ya escribe en profiles directamente y se salta la RLS);
--   - profiles, sus políticas, sus GRANT ni ningún otro objeto;
--   - los privilegios por defecto de Supabase (afectan a todo el esquema; un
--     cambio así necesita su propia decisión).
--
-- Orden: 20261014120000 va después de la última migración de master
-- (20261013120000) y antes de todas las que aún no se han fusionado
-- (20261015120000 en adelante, Fase 4.1–4.4). Así, un proyecto que reciba
-- primero el hotfix y después esas migraciones las aplica en orden. Es un
-- nombre de orden, no la fecha en que se escribió. 20261031120100 (4.4)
-- vuelve a revocar sobre la vista: es idempotente y no concede nada.
--
-- Comprobación al final: si después del REVOKE alguno de los tres roles
-- conserva un privilegio efectivo (de tabla o de columna, directo, heredado
-- o de PUBLIC), la migración falla y no se aplica nada.

revoke all on table public.public_profile_previews from public;
revoke all on table public.public_profile_previews from anon;
revoke all on table public.public_profile_previews from authenticated;

comment on view public.public_profile_previews is
  'Sin privilegios para PUBLIC, anon ni authenticated desde 20261014120000 (hotfix): con security_invoker = false, escribir por ella se saltaba la RLS de profiles. No conceder ningún privilegio de cliente sin una decisión de seguridad explícita.';

do $$
declare
  grantee text;
  privilege text;
begin
  foreach grantee in array array['public', 'anon', 'authenticated'] loop
    foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                     'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(grantee, 'public.public_profile_previews', privilege) then
        raise exception 'public_profile_previews_lockdown: % conserva % sobre la vista',
          grantee, privilege;
      end if;
    end loop;
    foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege(grantee, 'public.public_profile_previews', privilege) then
        raise exception 'public_profile_previews_lockdown: % conserva % de columna sobre la vista',
          grantee, privilege;
      end if;
    end loop;
  end loop;
end $$;
