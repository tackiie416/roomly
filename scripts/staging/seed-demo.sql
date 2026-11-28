-- Datos de demostración de staging (sesión 88). EXCLUSIVAMENTE FICTICIOS:
-- nombres inventados, emails en el dominio reservado .invalid (RFC 2606, no
-- pueden recibir correo) e ids con el prefijo fijo de0000de-…, para
-- reconocerlos y borrarlos con scripts/staging/cleanup-demo.sql. No se puede
-- entrar con estas cuentas (sin contraseña ni email real): sirven para que la
-- búsqueda pública y el panel de admin no estén vacíos en staging.
--
-- Idempotente (on conflict do nothing). Solo lo ejecuta
-- scripts/staging/seed-demo.sh, después de la guarda de staging.

insert into auth.users (id, email) values
  ('de0000de-0000-4000-8000-000000000001', 'demo-01@roomly.invalid'),
  ('de0000de-0000-4000-8000-000000000002', 'demo-02@roomly.invalid'),
  ('de0000de-0000-4000-8000-000000000003', 'demo-03@roomly.invalid'),
  ('de0000de-0000-4000-8000-000000000004', 'demo-04@roomly.invalid')
on conflict (id) do nothing;

insert into public.profiles (id, full_name, date_of_birth, seeking_status, bio) values
  ('de0000de-0000-4000-8000-000000000001', 'Demo Laia', '2002-03-14', 'has_room_looking_for_roommate', 'Perfil ficticio de staging.'),
  ('de0000de-0000-4000-8000-000000000002', 'Demo Marc', '2001-07-02', 'has_room_looking_for_roommate', 'Perfil ficticio de staging.'),
  ('de0000de-0000-4000-8000-000000000003', 'Demo Nuria', '2003-01-21', 'looking_for_room', 'Perfil ficticio de staging.'),
  ('de0000de-0000-4000-8000-000000000004', 'Demo Pol', '2000-11-30', 'looking_for_room', 'Perfil ficticio de staging.')
on conflict (id) do nothing;

insert into public.housing_preferences (profile_id, city_id, budget_min, budget_max)
  select p.id, c.id, 350, 650
  from public.cities c
  cross join (values
    ('de0000de-0000-4000-8000-000000000001'::uuid), ('de0000de-0000-4000-8000-000000000002'),
    ('de0000de-0000-4000-8000-000000000003'), ('de0000de-0000-4000-8000-000000000004')) p(id)
  where c.slug = 'barcelona'
on conflict (profile_id) do nothing;

update public.profiles set onboarding_completed_at = now()
where id::text like 'de0000de-%' and onboarding_completed_at is null;

insert into public.rooms (id, owner_id, title, description, city_id, neighborhood_id, price_month,
                          available_from, total_roommates, total_rooms)
  select r.id, r.owner, r.title, 'Anuncio ficticio de staging.', c.id, n.id, r.price,
         current_date + 14, 2, 3
  from public.cities c
  join (values
    ('de0000de-0000-4000-8000-0000000000a1'::uuid, 'de0000de-0000-4000-8000-000000000001'::uuid,
     'Demo: habitación luminosa', 'el-raval', 480),
    ('de0000de-0000-4000-8000-0000000000a2', 'de0000de-0000-4000-8000-000000000001',
     'Demo: habitación con balcón', 'la-dreta-de-l-eixample', 590),
    ('de0000de-0000-4000-8000-0000000000a3', 'de0000de-0000-4000-8000-000000000002',
     'Demo: cerca de la universidad', 'la-vila-de-gracia', 520)
  ) r(id, owner, title, hood, price) on true
  join public.neighborhoods n on n.city_id = c.id and n.slug = r.hood
  where c.slug = 'barcelona'
on conflict (id) do nothing;

update public.rooms set status = 'active'
where id::text like 'de0000de-%' and status = 'draft';
