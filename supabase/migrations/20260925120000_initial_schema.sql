-- ROOMLY — Esquema inicial (Fase 0, borrador de diseño)
-- NO APLICADA TODAVÍA. Se revisa y se aplica contra un proyecto Supabase real en Fase 1.
--
-- Esta versión ya incorpora la revisión crítica de CTO (ver docs/DATABASE.md §"Revisión crítica"):
--   - Se eliminó la tabla `verifications` (sobreingeniería: MVP solo verifica email, y eso
--     ya lo da gratis `auth.users.email_confirmed_at`).
--   - Se eliminó la tabla `notification_preferences` (sobreingeniería: una columna booleana
--     en `profiles` basta hasta que exista push real).
--   - Se añadieron constraints de integridad (precios positivos, rangos de fecha/presupuesto
--     coherentes, score 0-100, jsonb con forma de objeto).

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- ENUMS
-- Solo para valores estables y de bajo cambio. report_reason y
-- notification_type son TEXT (ver nota en docs/DATABASE.md): es
-- más probable que crezcan con el producto, y una migración de
-- enum para cada nuevo tipo de notificación es fricción innecesaria.
-- ============================================================
create type user_role as enum ('user', 'admin');
create type seeking_status as enum ('looking_for_room', 'has_room_looking_for_roommate', 'flexible');
create type room_status as enum ('draft', 'active', 'paused', 'rented', 'removed');
create type report_status as enum ('pending', 'in_review', 'resolved', 'dismissed');

-- ============================================================
-- REFERENCIA (públicas de lectura, escritura solo admin/migraciones)
-- ============================================================
create table cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default false, -- false = "próximamente", controla el rollout ciudad a ciudad
  center_lat double precision,
  center_lng double precision,
  created_at timestamptz not null default now()
);

create table neighborhoods (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete cascade,
  name text not null,
  slug text not null,
  center_lat double precision,
  center_lng double precision,
  created_at timestamptz not null default now(),
  unique (city_id, slug)
);

create table universities (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references cities(id),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================
-- IDENTIDAD
-- `profiles` extiende auth.users (Supabase ya gestiona credenciales,
-- email, proveedores OAuth — no duplicamos eso en una tabla `users` propia).
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  date_of_birth date not null,
  avatar_url text,
  bio text,
  seeking_status seeking_status not null default 'flexible',
  role user_role not null default 'user',
  email_notifications_enabled boolean not null default true,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_min_age check (date_of_birth <= (current_date - interval '18 years')) -- ver docs/SECURITY.md: REQUIERE REVISIÓN LEGAL
);

-- Preferencias de búsqueda: separadas de `profiles` porque se editan en un paso
-- distinto del onboarding (sección 5 del brief) y cambian con más frecuencia
-- mientras la persona busca. Ciudad/universidad quedan en `profiles` porque
-- funcionan como datos de identidad que se muestran en cada tarjeta.
create table housing_preferences (
  profile_id uuid primary key references profiles(id) on delete cascade,
  city_id uuid references cities(id),
  university_id uuid references universities(id),
  field_of_study text,
  budget_min integer,
  budget_max integer,
  move_in_date date,
  move_out_date date,
  preferred_neighborhood_ids uuid[] not null default '{}',
  roommates_wanted_min integer,
  roommates_wanted_max integer,
  updated_at timestamptz not null default now(),
  constraint chk_budget_range check (budget_min is null or budget_max is null or budget_min <= budget_max),
  constraint chk_budget_positive check (budget_min is null or budget_min >= 0),
  constraint chk_dates_range check (move_in_date is null or move_out_date is null or move_in_date <= move_out_date)
);

-- Respuestas del test de compatibilidad (25-30 preguntas). JSONB versionado
-- en vez de 30 columnas o una tabla normalizada: evita migraciones cada vez
-- que se ajusta una pregunta, sigue siendo consultable con operadores jsonb.
create table compatibility_responses (
  profile_id uuid primary key references profiles(id) on delete cascade,
  questionnaire_version integer not null default 1,
  answers jsonb not null,
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_answers_is_object check (jsonb_typeof(answers) = 'object')
);

-- ============================================================
-- HABITACIONES
-- ============================================================
create table rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text,
  city_id uuid not null references cities(id),
  neighborhood_id uuid references neighborhoods(id),
  approx_lat double precision, -- coordenada difuminada (~150-300m), nunca la exacta
  approx_lng double precision,
  price_month integer not null,
  expenses_included boolean not null default false,
  deposit_amount integer,
  available_from date not null,
  min_stay_months integer,
  max_stay_months integer,
  total_roommates integer, -- plazas que se buscan, no el total de gente ya viviendo (asunción marcada como ambigua)
  total_rooms integer,
  features text[] not null default '{}',
  house_rules text,
  roommate_preferences text,
  status room_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_price_positive check (price_month > 0),
  constraint chk_deposit_nonneg check (deposit_amount is null or deposit_amount >= 0),
  constraint chk_stay_range check (min_stay_months is null or max_stay_months is null or min_stay_months <= max_stay_months)
);

-- Dirección exacta en tabla propia, con su propia política RLS (ver migración
-- 0002). Es el único campo cuya fuga tiene consecuencia física real (seguridad
-- personal), así que no basta con "recordar no hacer SELECT *" en el código:
-- se protege también a nivel de base de datos.
create table room_addresses (
  room_id uuid primary key references rooms(id) on delete cascade,
  address_exact text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table room_images (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table favorites (
  user_id uuid not null references profiles(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

-- ============================================================
-- INTERÉS Y MATCHING
-- Un único modelo de "interés" para persona y para habitación (room_id es
-- solo contexto): unifica MATCH↔HABITACIÓN sin duplicar la lógica de
-- interés mutuo.
-- ============================================================
create table interests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references profiles(id) on delete cascade,
  to_user_id uuid not null references profiles(id) on delete cascade,
  room_id uuid references rooms(id),
  created_at timestamptz not null default now(),
  unique (from_user_id, to_user_id),
  constraint chk_no_self_interest check (from_user_id <> to_user_id)
);

-- Sin política de INSERT para clientes (ver migración 0002): un match solo
-- se crea desde el servidor, tras comprobar interés mutuo y calcular el
-- score con el motor de TypeScript. Nunca lo fabrica el cliente directamente.
create table matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references profiles(id) on delete cascade,
  user_b_id uuid not null references profiles(id) on delete cascade,
  room_id uuid references rooms(id),
  compatibility_score integer not null,
  created_at timestamptz not null default now(),
  unique (user_a_id, user_b_id),
  constraint chk_canonical_order check (user_a_id < user_b_id), -- la app debe insertar con LEAST/GREATEST
  constraint chk_score_range check (compatibility_score between 0 and 100)
);

-- ============================================================
-- CHAT
-- `conversation_participants` como tabla de unión (no columnas fijas
-- user_a/user_b): permite chat de grupo más adelante sin rediseñar nada.
-- ============================================================
create table conversations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table conversation_participants (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz, -- unread = count(messages.created_at > last_read_at); generaliza a grupos
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  content text not null,
  created_at timestamptz not null default now(),
  constraint chk_content_not_empty check (length(trim(content)) > 0)
);

-- ============================================================
-- CONFIANZA Y SEGURIDAD
-- ============================================================
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id),
  reported_user_id uuid references profiles(id),
  reported_room_id uuid references rooms(id),
  reason text not null, -- validado en la capa Zod, no en enum (ver nota arriba)
  description text,
  status report_status not null default 'pending',
  resolved_by uuid references profiles(id),
  resolution_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint chk_report_target check (reported_user_id is not null or reported_room_id is not null)
);

-- Trazabilidad de acciones de moderación (bloquear usuario, resolver reporte).
-- Una sola tabla append-only: coste mínimo, valor alto para un panel admin
-- que puede bloquear personas — esto se mantiene deliberadamente aunque el
-- resto de la revisión haya recortado tablas.
create table admin_action_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- NOTIFICACIONES (in-app; el envío de email es un efecto lateral
-- disparado desde el servicio, no una tabla)
-- ============================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
create index idx_rooms_city_status on rooms(city_id, status) where deleted_at is null;
create index idx_rooms_available_from on rooms(available_from) where status = 'active';
create index idx_rooms_owner on rooms(owner_id);
create index idx_housing_preferences_city on housing_preferences(city_id);
create index idx_interests_to_user on interests(to_user_id);
create index idx_interests_from_user on interests(from_user_id);
create index idx_matches_user_a on matches(user_a_id);
create index idx_matches_user_b on matches(user_b_id);
create index idx_messages_conversation on messages(conversation_id, created_at);
create index idx_notifications_user_unread on notifications(user_id) where read_at is null;
create index idx_reports_status on reports(status);
create index idx_favorites_user on favorites(user_id);

-- ============================================================
-- TRIGGER: updated_at automático
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger trg_housing_preferences_updated_at before update on housing_preferences
  for each row execute function set_updated_at();
create trigger trg_compatibility_responses_updated_at before update on compatibility_responses
  for each row execute function set_updated_at();
create trigger trg_rooms_updated_at before update on rooms
  for each row execute function set_updated_at();
create trigger trg_room_addresses_updated_at before update on room_addresses
  for each row execute function set_updated_at();

-- ============================================================
-- TRIGGER: rate limit anti-spam sobre `interests`
-- Defensa en profundidad: además de un check "amigable" en la app,
-- este trigger es el backstop que no se puede saltar aunque haya un
-- bug en la capa de aplicación.
-- ============================================================
create or replace function enforce_interest_rate_limit()
returns trigger as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from interests
  where from_user_id = new.from_user_id
    and created_at > now() - interval '24 hours';

  if recent_count >= 30 then
    raise exception 'rate_limit_exceeded: demasiados intereses enviados en 24h';
  end if;

  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_interests_rate_limit
  before insert on interests
  for each row execute function enforce_interest_rate_limit();
