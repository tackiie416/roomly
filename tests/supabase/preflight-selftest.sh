#!/usr/bin/env bash
# Auto-test de tests/supabase/preflight.sql (Fase 2.8) contra un PostgreSQL
# LOCAL (nunca contra Supabase). Aplica shim + migraciones + seed a una base
# temporal con la marca de identidad y comprueba:
#   - el esquema actual pasa P0–P6;
#   - cada mutación (política que falta, sobra, cambia de comando o de nombre;
#     tabla sin RLS; GRANT de más en housing_preferences; trigger que falta,
#     sobra o está desactivado; permisos y trigger de compatibility_responses (Fase 3.1); función con otra seguridad o search_path;
#     función de más; EXECUTE concedido; marcas anteriores) hace fallar la
#     comprobación que corresponde. Cada mutación va en su propia
#     transacción y se deshace.
#
# Conexión: variables estándar de libpq con un usuario que pueda crear bases
# de datos y roles (igual que tests/db/run.sh). Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
DB="preflight_selftest_$$"
WORK="$(mktemp -d)"
MARKER="$(sed -n 's/^ROOMLY_VALIDATION_MARKER="\(.*\)"$/\1/p' "$ROOT/tests/supabase/guard.sh")"

cleanup() {
  "${ADMIN[@]}" -c "drop database if exists ${DB}" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${ADMIN[@]}" -c "create database ${DB}" -c "comment on database ${DB} is '${MARKER}'" >/dev/null
P=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB")
"${P[@]}" -f "$ROOT/tests/db/supabase_shim.sql" >/dev/null 2>&1
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${P[@]}" -f "$migration" >/dev/null
done
"${P[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null

failed=0

# run_with <mutación SQL>: preflight dentro de la misma transacción, que se deshace.
run_with() {
  { echo "begin;"; printf '%s\n' "$1"; cat "$ROOT/tests/supabase/preflight.sql"; echo "rollback;"; } \
    | "${P[@]}" >"$WORK/out" 2>&1
}

echo "== positivo"
if run_with "select 1;"; then
  for check in P0 P1 P2 P3 P4 P5 P6; do
    if grep -q "ok - ${check}:" "$WORK/out"; then echo "   ok - ${check} pasa"; else echo "   FALLO: ${check} no aparece"; failed=1; fi
  done
else
  echo "   FALLO: el esquema actual no pasa el preflight"
  cat "$WORK/out"
  failed=1
fi

echo "== mutaciones (cada una debe fallar en su comprobación)"
# <comprobación esperada>|<descripción>|<SQL>
while IFS='|' read -r want label sql; do
  [ -z "$want" ] && continue
  if run_with "$sql"; then
    echo "   FALLO: ${label} no se detectó"
    failed=1
  elif grep -q "FALLO ${want}" "$WORK/out"; then
    echo "   ok - ${label} → ${want}"
  else
    echo "   FALLO: ${label} falló, pero no en ${want}:"
    grep -E "ERROR|FALLO" "$WORK/out" | head -3
    failed=1
  fi
done <<'CASES'
P0|marca antigua roomly-validation|do $$ begin execute format('comment on database %I is %L', current_database(), 'roomly-validation'); end $$;
P0|marca del proyecto anterior roomly-validation-2 (aislamiento)|do $$ begin execute format('comment on database %I is %L', current_database(), 'roomly-validation-2'); end $$;
P0|marca con espacio final|do $$ begin execute format('comment on database %I is %L', current_database(), 'roomly-validation-3 '); end $$;
P3|falta profiles_update_own|drop policy profiles_update_own on public.profiles;
P3|falta housing_preferences_delete_own|drop policy housing_preferences_delete_own on public.housing_preferences;
P3|sobra una política (aunque el total cambie)|create policy zz_extra on public.cities for select using (true);
P3|misma cantidad, otra política (37 = 37)|drop policy cities_select_all on public.cities; create policy cities_select_everything on public.cities for select using (true);
P3|mismo nombre, otro comando|drop policy housing_preferences_select_own on public.housing_preferences; create policy housing_preferences_select_own on public.housing_preferences for all to authenticated using (auth.uid() = profile_id);
P3|vuelve la política antigua housing_preferences_own|create policy housing_preferences_own on public.housing_preferences for all to authenticated using (auth.uid() = profile_id);
P3|tabla sin RLS|alter table public.housing_preferences disable row level security;
P4|anon con SELECT en housing_preferences|grant select on public.housing_preferences to anon;
P4|authenticated con UPDATE de profile_id|grant update (profile_id) on public.housing_preferences to authenticated;
P4|authenticated con UPDATE de updated_at|grant update (updated_at) on public.housing_preferences to authenticated;
P4|authenticated con INSERT de tabla completa|grant insert on public.housing_preferences to authenticated;
P4|authenticated sin DELETE|revoke delete on public.housing_preferences from authenticated;
P4|authenticated sin INSERT de city_id|revoke insert (city_id) on public.housing_preferences from authenticated;
P4|authenticated con UPDATE de profiles.role|grant update (role) on public.profiles to authenticated;
P3|vuelve la política antigua compatibility_responses_own|create policy compatibility_responses_own on public.compatibility_responses for all using (auth.uid() = profile_id);
P4|anon con SELECT en compatibility_responses|grant select on public.compatibility_responses to anon;
P4|authenticated con INSERT en compatibility_responses|grant insert on public.compatibility_responses to authenticated;
P4|authenticated con UPDATE de compatibility_responses.completed_at|grant update (completed_at) on public.compatibility_responses to authenticated;
P4|authenticated sin SELECT en compatibility_responses|revoke select on public.compatibility_responses from authenticated;
P6|falta trg_housing_preferences_university|drop trigger trg_housing_preferences_university on public.housing_preferences;
P6|falta trg_profiles_onboarding_completion|drop trigger trg_profiles_onboarding_completion on public.profiles;
P6|trigger desactivado|alter table public.housing_preferences disable trigger trg_housing_preferences_city_required;
P6|sobra un trigger|create trigger zz_extra before update on public.cities for each row execute function public.set_updated_at();
P6|función pasa a SECURITY DEFINER|alter function public.enforce_onboarding_completion() security definer;
P6|función pierde SECURITY DEFINER|alter function public.enforce_neighborhood_not_referenced() security invoker;
P6|search_path distinto|alter function public.enforce_housing_preferences_university() set search_path = public;
P6|función propia de más en public|create function public.zz_extra() returns int language sql set search_path = '' as 'select 1';
P6|authenticated puede ejecutar enforce_housing_city_after_onboarding|grant execute on function public.enforce_housing_city_after_onboarding() to authenticated;
P6|anon puede ejecutar enforce_housing_preferences_neighborhoods|grant execute on function public.enforce_housing_preferences_neighborhoods() to anon;
P6|PUBLIC puede ejecutar enforce_onboarding_completion|grant execute on function public.enforce_onboarding_completion() to public;
P6|falta trg_compatibility_responses_integrity|drop trigger trg_compatibility_responses_integrity on public.compatibility_responses;
P6|enforce_compatibility_responses_integrity pasa a SECURITY DEFINER|alter function public.enforce_compatibility_responses_integrity() security definer;
P6|authenticated puede ejecutar enforce_compatibility_responses_integrity|grant execute on function public.enforce_compatibility_responses_integrity() to authenticated;
CASES

echo "== el preflight no deja nada creado"
if "${P[@]}" -At -c "select count(*) from pg_class where relpersistence = 't'" | grep -qx 0 \
  && run_with "select 1;" \
  && [ "$("${P[@]}" -At -c "select count(*) from pg_policies where schemaname = 'public'")" = "37" ]; then
  echo "   ok - sin tablas temporales ni cambios; siguen 37 políticas"
else
  echo "   FALLO: el preflight dejó restos"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: el preflight tiene fallos"
  exit 1
fi
echo "RESULTADO: preflight exacto: el esquema actual pasa y cada mutación se detecta"
