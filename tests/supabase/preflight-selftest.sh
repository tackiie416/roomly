#!/usr/bin/env bash
# Auto-test de tests/supabase/preflight.sql (Fase 2.8) contra un PostgreSQL
# LOCAL (nunca contra Supabase). Aplica shim + migraciones + seed a una base
# temporal con la marca de identidad y comprueba:
#   - el esquema actual pasa P0–P6;
#   - cada mutación (política que falta, sobra, cambia de comando o de nombre;
#     tabla sin RLS; GRANT de más en housing_preferences; trigger que falta,
#     sobra o está desactivado; permisos y trigger de compatibility_responses (Fase 3.1); escrituras de habitaciones sin la comprobación de cuenta activa (Fase 4.0); restricciones de habitaciones que faltan, sin validar o con otro catálogo, GRANT por columnas de rooms y barrios de Barcelona que faltan, sobran o cambian (Fase 4.1); R7, restricciones, GRANT y trigger de room_images, bucket room-images y políticas en storage.objects (Fase 4.2); borrado directo de rooms y EXECUTE de delete_own_room (sesión 65); función con otra seguridad o search_path;
#     función de más; EXECUTE concedido; marcas anteriores; vistas nuevas
#     definer, con escritura de clientes, por columnas, para PUBLIC o
#     materializadas legibles (sesión 73)) hace fallar la comprobación que
#     corresponde. Cada mutación va en su propia transacción y se deshace;
#   - las variantes aceptadas (una vista invoker sin privilegios de clientes
#     y con un SELECT explícito) pasan el preflight completo.
#
# Conexión: variables estándar de libpq con un usuario que pueda crear bases
# de datos y roles (igual que tests/db/run.sh). Todo se borra al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d postgres)
DB="preflight_selftest_$$"
WORK="$(mktemp -d)"
MARKER="$(sed -n 's/^ROOMLY_VALIDATION_ALLOWED_MARKERS=("\([^"]*\)".*/\1/p' "$ROOT/tests/supabase/guard.sh")"

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
P1|falta chk_rooms_publishable (4.1)|alter table public.rooms drop constraint chk_rooms_publishable;
P1|chk_rooms_publishable sin validar (NOT VALID)|alter table public.rooms drop constraint chk_rooms_publishable; alter table public.rooms add constraint chk_rooms_publishable check (status <> 'active' or (neighborhood_id is not null and total_roommates is not null and total_rooms is not null)) not valid;
P1|falta chk_rooms_features_unique (4.1)|alter table public.rooms drop constraint chk_rooms_features_unique;
P1|falta la FK barrio ↔ ciudad (4.1)|alter table public.rooms drop constraint fk_rooms_neighborhood_city;
P1|FK barrio ↔ ciudad sustituida por una de otras columnas|alter table public.rooms drop constraint fk_rooms_neighborhood_city; alter table public.rooms add constraint fk_rooms_neighborhood_city foreign key (neighborhood_id) references public.neighborhoods (id);
P1|falta un barrio oficial de Barcelona (R1)|delete from public.neighborhoods where slug = 'navas';
P1|barrio oficial renombrado|update public.neighborhoods set name = 'Raval' where slug = 'el-raval';
P1|slug de un barrio oficial cambiado|update public.neighborhoods set slug = 'raval' where slug = 'el-raval';
P1|barrio de más en Barcelona|insert into public.neighborhoods (city_id, name, slug) select id, 'Barrio de más', 'barrio-de-mas' from public.cities where slug = 'barcelona';
P1|catálogo de características con una clave de más|alter table public.rooms drop constraint chk_rooms_features_catalog; alter table public.rooms add constraint chk_rooms_features_catalog check (features <@ array['wifi', 'heating', 'air_conditioning', 'elevator', 'washing_machine', 'dishwasher', 'balcony', 'furnished', 'private_bathroom', 'double_bed', 'desk', 'exterior', 'pool']::text[]);
P3|falta profiles_update_own|drop policy profiles_update_own on public.profiles;
P3|falta housing_preferences_delete_own|drop policy housing_preferences_delete_own on public.housing_preferences;
P3|sobra una política (aunque el total cambie)|create policy zz_extra on public.cities for select using (true);
P3|misma cantidad, otra política (41 = 41)|drop policy cities_select_all on public.cities; create policy cities_select_everything on public.cities for select using (true);
P3|mismo nombre, otro comando|drop policy housing_preferences_select_own on public.housing_preferences; create policy housing_preferences_select_own on public.housing_preferences for all to authenticated using (auth.uid() = profile_id);
P3|vuelve la política antigua housing_preferences_own|create policy housing_preferences_own on public.housing_preferences for all to authenticated using (auth.uid() = profile_id);
P3|tabla sin RLS|alter table public.housing_preferences disable row level security;
P3|vuelve la política antigua rooms_owner_write|create policy rooms_owner_write on public.rooms for all using (auth.uid() = owner_id);
P3|falta room_addresses_select_own|drop policy room_addresses_select_own on public.room_addresses;
P3|rooms_update_own sin la comprobación de cuenta activa|drop policy rooms_update_own on public.rooms; create policy rooms_update_own on public.rooms for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
P3|room_addresses_insert_own sin la comprobación de cuenta activa|drop policy room_addresses_insert_own on public.room_addresses; create policy room_addresses_insert_own on public.room_addresses for insert to authenticated with check (exists (select 1 from public.rooms r where r.id = room_addresses.room_id and r.owner_id = auth.uid()));
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
P4|authenticated con INSERT de rooms.status (4.1)|grant insert (status) on public.rooms to authenticated;
P4|authenticated con UPDATE de rooms.deleted_at|grant update (deleted_at) on public.rooms to authenticated;
P4|authenticated con UPDATE de rooms.approx_lat|grant update (approx_lat) on public.rooms to authenticated;
P4|authenticated con UPDATE de rooms.owner_id|grant update (owner_id) on public.rooms to authenticated;
P4|authenticated con UPDATE de tabla completa en rooms|grant update on public.rooms to authenticated;
P4|authenticated sin UPDATE de rooms.status (no podría publicar)|revoke update (status) on public.rooms from authenticated;
P4|anon con INSERT en rooms|grant insert on public.rooms to anon;
P4|anon sin SELECT en rooms|revoke select on public.rooms from anon;
P4|service_role sin UPDATE en rooms|revoke update on public.rooms from service_role;
P6|falta trg_housing_preferences_university|drop trigger trg_housing_preferences_university on public.housing_preferences;
P4|anon vuelve a tener UPDATE en public_profile_previews (el fallo del hotfix)|grant update on public.public_profile_previews to anon;
P4|authenticated vuelve a tener DELETE en public_profile_previews|grant delete on public.public_profile_previews to authenticated;
P4|authenticated recupera SELECT en public_profile_previews|grant select on public.public_profile_previews to authenticated;
P4|anon recupera SELECT en public_profile_previews|grant select on public.public_profile_previews to anon;
P4|PUBLIC con INSERT en public_profile_previews|grant insert on public.public_profile_previews to public;
P4|anon con UPDATE de una columna de public_profile_previews|grant update (full_name) on public.public_profile_previews to anon;
P4|authenticated con SELECT de una columna de public_profile_previews|grant select (role) on public.public_profile_previews to authenticated;
P5|vista definer nueva (guardas de vistas, sesión 73)|create view public.zz_pf_definer as select id from public.profiles;
P5|vista invoker nueva con ALL para anon y authenticated (como los privilegios por defecto)|create view public.zz_pf_inv with (security_invoker = true) as select id, name from public.cities; grant all on public.zz_pf_inv to anon, authenticated;
P5|vista invoker con UPDATE para authenticated|create view public.zz_pf_upd with (security_invoker = true) as select id, name from public.cities; revoke all on public.zz_pf_upd from public, anon, authenticated; grant update on public.zz_pf_upd to authenticated;
P5|vista invoker con UPDATE por columna para anon|create view public.zz_pf_col with (security_invoker = true) as select id, name from public.cities; revoke all on public.zz_pf_col from public, anon, authenticated; grant update (name) on public.zz_pf_col to anon;
P5|vista invoker con INSERT para PUBLIC|create view public.zz_pf_pub with (security_invoker = true) as select id, name from public.cities; revoke all on public.zz_pf_pub from public, anon, authenticated; grant insert on public.zz_pf_pub to public;
P5|vista materializada legible por anon|create materialized view public.zz_pf_mv as select id, name from public.cities; revoke all on public.zz_pf_mv from public, anon, authenticated; grant select on public.zz_pf_mv to anon;
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
P1|falta is_room_publicly_visible (R7, 4.2)|drop function public.is_room_publicly_visible(uuid) cascade;
P1|falta chk_room_images_storage_path (4.2)|alter table public.room_images drop constraint chk_room_images_storage_path;
P1|chk_room_images_storage_path con otra definición (sin la extensión)|alter table public.room_images drop constraint chk_room_images_storage_path; alter table public.room_images add constraint chk_room_images_storage_path check (storage_path = room_id::text || '/' || id::text);
P1|chk_room_images_storage_path sin validar (NOT VALID)|alter table public.room_images drop constraint chk_room_images_storage_path; alter table public.room_images add constraint chk_room_images_storage_path check (storage_path = room_id::text || '/' || id::text || '.webp') not valid;
P1|chk_room_images_position con otra definición|alter table public.room_images drop constraint chk_room_images_position; alter table public.room_images add constraint chk_room_images_position check (position >= -1);
P1|falta el bucket room-images (4.2)|delete from storage.buckets where id = 'room-images';
P1|bucket room-images con otro límite de tamaño|update storage.buckets set file_size_limit = 52428800 where id = 'room-images';
P1|bucket room-images que acepta otros tipos|update storage.buckets set allowed_mime_types = array['image/webp', 'image/jpeg'] where id = 'room-images';
P1|bucket room-images sin límite de tipos|update storage.buckets set allowed_mime_types = null where id = 'room-images';
P1|bucket con id room-images y otro nombre|update storage.buckets set name = 'fotos' where id = 'room-images';
P2|is_room_publicly_visible pasa a SECURITY INVOKER|alter function public.is_room_publicly_visible(uuid) security invoker;
P2|is_room_publicly_visible con search_path public|alter function public.is_room_publicly_visible(uuid) set search_path = public;
P2|is_room_publicly_visible de otro dueño|alter function public.is_room_publicly_visible(uuid) owner to service_role;
P3|vuelve una política de escritura en room_images (room_images_insert_own)|create policy room_images_insert_own on public.room_images for insert to authenticated with check (exists (select 1 from public.rooms r join public.profiles p on p.id = r.owner_id where r.id = room_images.room_id and r.owner_id = auth.uid() and p.deleted_at is null));
P3|falta room_images_admin_select|drop policy room_images_admin_select on public.room_images;
P3|room_images_admin_select pasa a FOR ALL|drop policy room_images_admin_select on public.room_images; create policy room_images_admin_select on public.room_images for all to authenticated using (public.is_admin());
P3|room_images_admin_select para todos los roles (sin to authenticated)|drop policy room_images_admin_select on public.room_images; create policy room_images_admin_select on public.room_images for select using (public.is_admin());
P3|room_images_admin_select abierta a cualquiera|drop policy room_images_admin_select on public.room_images; create policy room_images_admin_select on public.room_images for select to authenticated using (true);
P3|rooms_select_active_public sin R7 (la de antes de la 4.2)|drop policy rooms_select_active_public on public.rooms; create policy rooms_select_active_public on public.rooms for select using (status = 'active' and deleted_at is null);
P3|room_images_select_public sin R7 (la condición de antes de la 4.2)|drop policy room_images_select_public on public.room_images; create policy room_images_select_public on public.room_images for select using (exists (select 1 from public.rooms r where r.id = room_images.room_id));
P3|vuelve room_images_select (la que leía rooms.owner_id para todos los roles)|create policy room_images_select on public.room_images for select using (exists (select 1 from public.rooms r where r.id = room_images.room_id and r.owner_id = auth.uid()));
P3|room_images_select_own para todos los roles (también anon)|drop policy room_images_select_own on public.room_images; create policy room_images_select_own on public.room_images for select using (exists (select 1 from public.rooms r where r.id = room_images.room_id and r.owner_id = auth.uid()));
P4|anon recupera SELECT de tabla en rooms|grant select on public.rooms to anon;
P4|anon lee rooms.owner_id|grant select (owner_id) on public.rooms to anon;
P4|anon lee rooms.approx_lat|grant select (approx_lat) on public.rooms to anon;
P4|anon pierde SELECT de rooms.published_at|revoke select (published_at) on public.rooms from anon;
P4|anon con REFERENCES en rooms|grant references on public.rooms to anon;
P4|PUBLIC con SELECT en rooms|grant select on public.rooms to public;
P4|PUBLIC con SELECT de una columna de rooms|grant select (title) on public.rooms to public;
P4|anon vuelve a leer public_profile_previews|grant select on public.public_profile_previews to anon;
P4|authenticated con UPDATE en public_profile_previews (escritura por la vista)|grant update on public.public_profile_previews to authenticated;
P4|authenticated con DELETE en public_profile_previews|grant delete on public.public_profile_previews to authenticated;
P4|PUBLIC con SELECT en public_profile_previews|grant select on public.public_profile_previews to public;
P1|falta rooms.published_at (20261031120000)|alter table public.rooms drop column published_at cascade;
P1|chk_rooms_published_at sin validar (NOT VALID)|alter table public.rooms drop constraint chk_rooms_published_at; alter table public.rooms add constraint chk_rooms_published_at check (status <> 'active' or published_at is not null) not valid;
P1|falta el índice idx_rooms_public_recent|drop index public.idx_rooms_public_recent;
P1|idx_rooms_public_recent sin el filtro de visibilidad|drop index public.idx_rooms_public_recent; create index idx_rooms_public_recent on public.rooms (city_id, published_at desc, id desc);
P6|falta trg_rooms_published_at|drop trigger trg_rooms_published_at on public.rooms;
P6|trg_rooms_published_at desactivado|alter table public.rooms disable trigger trg_rooms_published_at;
P6|set_room_published_at pasa a SECURITY DEFINER|alter function public.set_room_published_at() security definer;
P6|authenticated puede ejecutar set_room_published_at|grant execute on function public.set_room_published_at() to authenticated;
P3|una política en storage.objects|create policy zz_selftest_read on storage.objects for select to authenticated using (true);
P4|authenticated con INSERT en room_images|grant insert on public.room_images to authenticated;
P4|authenticated con UPDATE de room_images.position|grant update (position) on public.room_images to authenticated;
P4|anon con DELETE en room_images|grant delete on public.room_images to anon;
P4|authenticated sin SELECT en room_images|revoke select on public.room_images from authenticated;
P4|service_role sin INSERT en room_images|revoke insert on public.room_images from service_role;
P4|PUBLIC puede ejecutar is_room_publicly_visible|grant execute on function public.is_room_publicly_visible(uuid) to public;
P4|service_role puede ejecutar is_room_publicly_visible|grant execute on function public.is_room_publicly_visible(uuid) to service_role;
P4|anon sin EXECUTE de is_room_publicly_visible|revoke execute on function public.is_room_publicly_visible(uuid) from anon;
P1|bucket room-images público (como antes de 20261025120000, D1)|update storage.buckets set public = true where id = 'room-images';
P1|bucket room-images sin el valor de public|update storage.buckets set public = null where id = 'room-images';
P1|no se puede comprobar Storage: un rol al que la RLS podría ocultar filas|create role zz_selftest_reader nologin; grant usage on schema public, storage to zz_selftest_reader; grant select on all tables in schema public to zz_selftest_reader; grant select on storage.buckets, storage.objects to zz_selftest_reader; set local role zz_selftest_reader;
P3|storage.objects sin RLS|alter table storage.objects disable row level security;
P3|storage.buckets sin RLS|alter table storage.buckets disable row level security;
P3|storage.buckets con una política de escritura|create policy zz_selftest_bucket on storage.buckets for update to authenticated using (true);
P3|storage.buckets con una política FOR ALL (también escribe)|create policy zz_selftest_bucket_all on storage.buckets for all to authenticated using (true);
P6|falta trg_room_images_integrity (4.2)|drop trigger trg_room_images_integrity on public.room_images;
P6|trg_room_images_integrity desactivado|alter table public.room_images disable trigger trg_room_images_integrity;
P6|enforce_room_images_integrity pasa a SECURITY DEFINER|alter function public.enforce_room_images_integrity() security definer;
P6|authenticated puede ejecutar enforce_room_images_integrity|grant execute on function public.enforce_room_images_integrity() to authenticated;
P1|falta delete_own_room (20261030120000 no aplicada)|drop function public.delete_own_room(uuid, uuid);
P3|vuelve rooms_delete_own (borrado directo de la propietaria)|create policy rooms_delete_own on public.rooms for delete to authenticated using (auth.uid() = owner_id and exists (select 1 from public.profiles p where p.id = rooms.owner_id and p.deleted_at is null));
P4|authenticated vuelve a tener DELETE en rooms|grant delete on public.rooms to authenticated;
P4|authenticated con TRUNCATE en rooms|grant truncate on public.rooms to authenticated;
P4|anon con DELETE en rooms|grant delete on public.rooms to anon;
P4|anon con TRUNCATE en rooms|grant truncate on public.rooms to anon;
P4|PUBLIC con DELETE en rooms|grant delete on public.rooms to public;
P4|service_role sin DELETE en rooms|revoke delete on public.rooms from service_role;
P4|authenticated puede ejecutar delete_own_room|grant execute on function public.delete_own_room(uuid, uuid) to authenticated;
P4|anon puede ejecutar delete_own_room|grant execute on function public.delete_own_room(uuid, uuid) to anon;
P4|PUBLIC puede ejecutar delete_own_room|grant execute on function public.delete_own_room(uuid, uuid) to public;
P4|service_role sin EXECUTE de delete_own_room|revoke execute on function public.delete_own_room(uuid, uuid) from service_role;
P6|delete_own_room pasa a SECURITY DEFINER|alter function public.delete_own_room(uuid, uuid) security definer;
P6|delete_own_room con otro search_path|alter function public.delete_own_room(uuid, uuid) set search_path = public;
CASES

echo "== variantes aceptadas (deben pasar el preflight completo)"
# <descripción>|<SQL>
while IFS='|' read -r label sql; do
  [ -z "$label" ] && continue
  if run_with "$sql" && grep -q "ok - P5:" "$WORK/out"; then
    echo "   ok - ${label}"
  else
    echo "   FALLO: ${label} no pasa el preflight:"
    grep -E "ERROR|FALLO" "$WORK/out" | head -3
    failed=1
  fi
done <<'CASES'
vista invoker sin privilegios de clientes y con SELECT explícito para authenticated|create view public.zz_pf_ok with (security_invoker = true) as select id, name from public.cities; revoke all on public.zz_pf_ok from public, anon, authenticated; grant select on public.zz_pf_ok to authenticated;
CASES

echo "== allow-list F1: roomly-validation-4 aceptado y marca esperada exacta"
# Preflight con una marca esperada explícita (-v expected_marker), como hace run-preflight.sh.
run_with_expected() {
  { echo "begin;"; cat "$ROOT/tests/supabase/preflight.sql"; echo "rollback;"; } \
    | "${P[@]}" -v expected_marker="$1" >"$WORK/out" 2>&1
}
# El mismo esquema marcado como roomly-validation-4: P0 lo acepta (allow-list).
"${ADMIN[@]}" -c "comment on database ${DB} is 'roomly-validation-4'" >/dev/null
if run_with "select 1;" && grep -q "ok - P0:" "$WORK/out"; then
  echo "   ok - P0 acepta roomly-validation-4 (allow-list)"
else
  echo "   FALLO: P0 no acepta roomly-validation-4"; grep -E "ERROR|FALLO" "$WORK/out" | head -3; failed=1
fi
# Marca esperada -4 y BD -4: coincidencia exacta.
if run_with_expected "roomly-validation-4" && grep -q "ok - P0:" "$WORK/out"; then
  echo "   ok - P0 acepta -4 con la marca esperada -4 (coincidencia exacta)"
else
  echo "   FALLO: P0 no acepta -4 con la marca esperada -4"; grep -E "ERROR|FALLO" "$WORK/out" | head -3; failed=1
fi
# Marca esperada -3 pero la BD es -4: P0 exige coincidencia exacta y lo rechaza.
if run_with_expected "roomly-validation-3"; then
  echo "   FALLO: P0 aceptó -4 cuando el Environment esperaba -3"; failed=1
elif grep -q "FALLO P0" "$WORK/out"; then
  echo "   ok - P0 rechaza -4 cuando el Environment espera -3 (coincidencia exacta)"
else
  echo "   FALLO: falló, pero no en P0:"; grep -E "ERROR|FALLO" "$WORK/out" | head -3; failed=1
fi
# Restaurar la marca para el resto del selftest.
"${ADMIN[@]}" -c "comment on database ${DB} is '${MARKER}'" >/dev/null

echo "== el preflight no deja nada creado"
if "${P[@]}" -At -c "select count(*) from pg_class where relpersistence = 't'" | grep -qx 0 \
  && run_with "select 1;" \
  && [ "$("${P[@]}" -At -c "select count(*) from pg_policies where schemaname = 'public'")" = "42" ]; then
  echo "   ok - sin tablas temporales ni cambios; siguen 42 políticas"
else
  echo "   FALLO: el preflight dejó restos"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: el preflight tiene fallos"
  exit 1
fi
echo "RESULTADO: preflight exacto: el esquema actual pasa y cada mutación se detecta"
