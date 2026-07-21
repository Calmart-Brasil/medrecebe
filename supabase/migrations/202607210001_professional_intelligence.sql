create table if not exists public.professional_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  opportunity_city text,
  opportunity_uf char(2),
  opportunity_radius_km integer not null default 100 check (opportunity_radius_km between 10 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_profiles_opportunity_uf_check
    check (opportunity_uf is null or opportunity_uf ~ '^[A-Z]{2}$')
);

create table if not exists public.professional_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  council text not null default 'CRM' check (council = 'CRM'),
  crm_uf char(2) not null check (crm_uf ~ '^[A-Z]{2}$'),
  crm_number text not null check (crm_number ~ '^(EME)?[0-9]{1,10}P?$'),
  is_primary boolean not null default false,
  registration_status text not null default 'self_reported'
    check (registration_status in ('self_reported', 'verified_active', 'verified_inactive', 'verification_pending')),
  verification_source text not null default 'self_reported',
  verified_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, crm_uf, crm_number)
);

create unique index if not exists professional_registrations_one_primary
  on public.professional_registrations(user_id)
  where is_primary;

create index if not exists professional_registrations_lookup
  on public.professional_registrations(crm_uf, crm_number);

create table if not exists public.professional_specialties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  registration_id uuid references public.professional_registrations(id) on delete set null,
  specialty_code text not null,
  specialty_name text not null,
  rqe_number text,
  verification_status text not null default 'self_reported'
    check (verification_status in ('self_reported', 'verified', 'verification_pending')),
  verification_source text not null default 'self_reported',
  confirmed_by_user boolean not null default true,
  verified_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, specialty_code)
);

create index if not exists professional_specialties_user
  on public.professional_specialties(user_id, specialty_code);

create table if not exists public.market_data_snapshots (
  id bigint generated always as identity primary key,
  source_code text not null check (source_code in ('RECEITA_CNPJ', 'CNES', 'SIH_SUS', 'SIA_SUS', 'SIGTAP', 'ANS', 'PNCP', 'RAIS', 'CAGED', 'CMED', 'IBGE', 'CFM')),
  dataset_version text not null,
  reference_date date,
  retrieved_at timestamptz not null default now(),
  checksum text,
  record_count bigint,
  status text not null default 'available' check (status in ('available', 'processing', 'failed', 'superseded')),
  metadata jsonb not null default '{}'::jsonb,
  unique (source_code, dataset_version)
);

create table if not exists public.market_indicators (
  id bigint generated always as identity primary key,
  source_snapshot_id bigint not null references public.market_data_snapshots(id) on delete cascade,
  geography_type text not null check (geography_type in ('country', 'state', 'municipality', 'health_region')),
  geography_code text not null,
  specialty_code text,
  reference_period text not null,
  indicator_code text not null,
  value_numeric numeric,
  value_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_snapshot_id, geography_type, geography_code, specialty_code, reference_period, indicator_code)
);

create index if not exists market_indicators_region_specialty
  on public.market_indicators(geography_type, geography_code, specialty_code, indicator_code, reference_period desc);

create trigger professional_profiles_touch_updated_at
before update on public.professional_profiles
for each row execute function public.touch_updated_at();

create trigger professional_registrations_touch_updated_at
before update on public.professional_registrations
for each row execute function public.touch_updated_at();

create trigger professional_specialties_touch_updated_at
before update on public.professional_specialties
for each row execute function public.touch_updated_at();

alter table public.professional_profiles enable row level security;
alter table public.professional_registrations enable row level security;
alter table public.professional_specialties enable row level security;
alter table public.market_data_snapshots enable row level security;
alter table public.market_indicators enable row level security;

create policy "professional_profiles_own_or_admin"
on public.professional_profiles for all to authenticated
using (user_id = (select auth.uid()) or public.is_admin())
with check (user_id = (select auth.uid()) or public.is_admin());

create policy "professional_registrations_own_or_admin"
on public.professional_registrations for all to authenticated
using (user_id = (select auth.uid()) or public.is_admin())
with check (user_id = (select auth.uid()) or public.is_admin());

create policy "professional_specialties_own_or_admin"
on public.professional_specialties for all to authenticated
using (user_id = (select auth.uid()) or public.is_admin())
with check (user_id = (select auth.uid()) or public.is_admin());

create policy "market_snapshots_read_authenticated"
on public.market_data_snapshots for select to authenticated
using (true);

create policy "market_indicators_read_authenticated"
on public.market_indicators for select to authenticated
using (true);

comment on table public.professional_registrations is
  'Registros profissionais informados pelo titular ou verificados pelo webservice oficial do CFM. Não contém CPF.';

comment on table public.professional_specialties is
  'Especialidades múltiplas, com RQE opcional e proveniência explícita; dados autodeclarados nunca são exibidos como verificados.';

comment on table public.market_data_snapshots is
  'Catálogo auditável das versões das bases públicas usadas pela inteligência de mercado.';

comment on table public.market_indicators is
  'Indicadores agregados por território e especialidade, sem prontuários ou dados de pacientes.';
