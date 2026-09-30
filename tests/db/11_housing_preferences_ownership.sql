-- Ownership aislado de UPDATE y DELETE en housing_preferences.
-- Debe fallar si housing_preferences_update_own o housing_preferences_delete_own
-- pierden la condición `auth.uid() = housing_preferences.profile_id`.
--
-- Por qué hace falta este archivo (HP5b/HP5c de 05 no bastan): PostgreSQL
-- aplica también la política de SELECT a las filas que lee el WHERE de un
-- UPDATE o DELETE. Con la política de lectura normal, la fila ajena es
-- invisible y el resultado es 0 filas aunque la política de UPDATE/DELETE no
-- comprobara el dueño. Aquí, dentro de una transacción que se deshace con
-- ROLLBACK, se añade una política de SELECT temporal que deja ver las filas:
-- así lo único que puede impedir la escritura es la propia política de
-- UPDATE/DELETE. Nada queda abierto al terminar (se comprueba al final).
--
-- A intenta escribir en la fila de B. Control positivo: B, en la misma
-- situación, sí puede, porque su cuenta está activa y su onboarding sin
-- completar (el resto de condiciones de las políticas se cumplen para esa
-- fila, así que la única diferencia es el dueño).

reset role;
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-00000000000a', 'own-a@test'),
  ('b0000000-0000-0000-0000-00000000000b', 'own-b@test');
insert into public.profiles (id, full_name, date_of_birth, seeking_status) values
  ('b0000000-0000-0000-0000-00000000000a', 'Dueño A', '2000-01-01', 'looking_for_room'),
  ('b0000000-0000-0000-0000-00000000000b', 'Dueño B', '2000-01-01', 'looking_for_room');
insert into public.housing_preferences (profile_id, field_of_study, budget_max) values
  ('b0000000-0000-0000-0000-00000000000a', 'Filología', 500),
  ('b0000000-0000-0000-0000-00000000000b', 'Medicina', 600);

-- ------------------------------------------------------------
-- 1. UPDATE ajeno con la fila visible.
-- ------------------------------------------------------------
begin;
create policy "zz_test_select_all_temporal" on public.housing_preferences
  for select to authenticated using (true);
set role authenticated;
select roomly_test.login('b0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  1, 'OWN0: con la lectura abierta temporalmente, A ve la fila de B (SELECT ya no la oculta)');
select roomly_test.expect_affected(
  $$update public.housing_preferences set field_of_study = 'Suplantado', budget_max = 1
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  0, 'OWN1: aun viéndola, A NO puede modificar la fila de B (ownership de UPDATE)');
select roomly_test.ok(
  (select field_of_study = 'Medicina' and budget_max = 600
   from public.housing_preferences
   where profile_id = 'b0000000-0000-0000-0000-00000000000b'),
  'OWN1: la fila de B sigue intacta');
select roomly_test.login('b0000000-0000-0000-0000-00000000000b');
select roomly_test.expect_affected(
  $$update public.housing_preferences set field_of_study = 'Cambio propio'
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  1, 'OWN1-control: en la misma situación B sí modifica su fila (solo falla el dueño)');
rollback;

-- ------------------------------------------------------------
-- 2. DELETE ajeno con la fila visible.
-- ------------------------------------------------------------
reset role;
begin;
create policy "zz_test_select_all_temporal" on public.housing_preferences
  for select to authenticated using (true);
set role authenticated;
select roomly_test.login('b0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  1, 'OWN2: con la lectura abierta temporalmente, A ve la fila de B');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  0, 'OWN3: aun viéndola, A NO puede borrar la fila de B (ownership de DELETE)');
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  1, 'OWN3: la fila de B sigue existiendo');
select roomly_test.login('b0000000-0000-0000-0000-00000000000b');
select roomly_test.expect_affected(
  $$delete from public.housing_preferences
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  1, 'OWN3-control: en la misma situación B sí borra su fila (solo falla el dueño)');
rollback;

-- ------------------------------------------------------------
-- 3. Nada queda abierto ni cambiado tras los ROLLBACK.
-- ------------------------------------------------------------
reset role;
select roomly_test.ok(
  not exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'housing_preferences'
                and policyname = 'zz_test_select_all_temporal'),
  'OWN4: la política de lectura temporal ya no existe');
select roomly_test.ok(
  (select count(*) = 4 from pg_policies
   where schemaname = 'public' and tablename = 'housing_preferences'),
  'OWN4: housing_preferences sigue con sus 4 políticas');
select roomly_test.ok(
  (select field_of_study = 'Medicina' and budget_max = 600
   from public.housing_preferences
   where profile_id = 'b0000000-0000-0000-0000-00000000000b'),
  'OWN4: la fila de B está como al principio (los controles positivos se deshicieron)');
set role authenticated;
select roomly_test.login('b0000000-0000-0000-0000-00000000000a');
select roomly_test.expect_rows(
  $$select 1 from public.housing_preferences
    where profile_id = 'b0000000-0000-0000-0000-00000000000b'$$,
  0, 'OWN4: con la lectura normal, A vuelve a no ver la fila de B');
reset role;
