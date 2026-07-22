create table if not exists public.marketplace_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade unique,
  organization_type text not null check (organization_type in ('company', 'government')),
  legal_name text not null,
  trade_name text not null,
  cnpj_hash char(64) not null unique,
  cnpj_last4 char(4) not null check (cnpj_last4 ~ '^[0-9]{4}$'),
  uf char(2) not null check (uf ~ '^[A-Z]{2}$'),
  city text not null,
  contact_email text not null,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.marketplace_organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  professional_area text not null check (professional_area in ('medical','nursing','physiotherapy','psychology','nutrition','pharmacy','administration','technician','other')),
  contract_type text not null check (contract_type in ('pj','clt','shift','credentialing','temporary','internship','other')),
  specialty text, uf char(2) not null check (uf ~ '^[A-Z]{2}$'), city text not null,
  municipality_ibge_code char(7), description text not null,
  compensation_min_cents bigint check (compensation_min_cents is null or compensation_min_cents >= 0),
  compensation_max_cents bigint check (compensation_max_cents is null or compensation_max_cents >= compensation_min_cents),
  status text not null default 'published' check (status in ('draft','published','paused','closed')),
  published_at timestamptz, closes_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists marketplace_opportunities_discovery on public.marketplace_opportunities(status, uf, professional_area, contract_type, published_at desc);

create table if not exists public.marketplace_applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.marketplace_opportunities(id) on delete cascade,
  professional_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'interested' check (status in ('interested','reviewing','contacted','accepted','declined','withdrawn')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (opportunity_id, professional_user_id)
);

create table if not exists public.marketplace_workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.marketplace_organizations(id) on delete cascade,
  linked_user_id uuid references public.profiles(id) on delete set null,
  name text not null, email text not null,
  professional_area text not null check (professional_area in ('medical','nursing','physiotherapy','psychology','nutrition','pharmacy','administration','technician','other')),
  professional_registration text,
  status text not null default 'invited' check (status in ('invited','linked','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

alter table public.professional_profiles
  add column if not exists opportunity_alerts_enabled boolean not null default true,
  add column if not exists company_alerts_enabled boolean not null default true,
  add column if not exists public_contract_alerts_enabled boolean not null default true;

drop trigger if exists marketplace_organizations_touch_updated_at on public.marketplace_organizations;
create trigger marketplace_organizations_touch_updated_at before update on public.marketplace_organizations for each row execute function public.touch_updated_at();
drop trigger if exists marketplace_opportunities_touch_updated_at on public.marketplace_opportunities;
create trigger marketplace_opportunities_touch_updated_at before update on public.marketplace_opportunities for each row execute function public.touch_updated_at();
drop trigger if exists marketplace_applications_touch_updated_at on public.marketplace_applications;
create trigger marketplace_applications_touch_updated_at before update on public.marketplace_applications for each row execute function public.touch_updated_at();
drop trigger if exists marketplace_workers_touch_updated_at on public.marketplace_workers;
create trigger marketplace_workers_touch_updated_at before update on public.marketplace_workers for each row execute function public.touch_updated_at();

alter table public.marketplace_organizations enable row level security;
alter table public.marketplace_opportunities enable row level security;
alter table public.marketplace_applications enable row level security;
alter table public.marketplace_workers enable row level security;
drop policy if exists "marketplace_organizations_owner_select" on public.marketplace_organizations;
create policy "marketplace_organizations_owner_select" on public.marketplace_organizations for select to authenticated using (owner_user_id = (select auth.uid()));
drop policy if exists "marketplace_opportunities_published_select" on public.marketplace_opportunities;
create policy "marketplace_opportunities_published_select" on public.marketplace_opportunities for select to authenticated using (status = 'published' or created_by = (select auth.uid()));
drop policy if exists "marketplace_applications_own_select" on public.marketplace_applications;
create policy "marketplace_applications_own_select" on public.marketplace_applications for select to authenticated using (professional_user_id = (select auth.uid()));
drop policy if exists "marketplace_workers_linked_select" on public.marketplace_workers;
create policy "marketplace_workers_linked_select" on public.marketplace_workers for select to authenticated using (linked_user_id = (select auth.uid()));

comment on table public.marketplace_opportunities is 'Ofertas diretas publicadas por contratantes. Não substitui o PNCP nem presume validação das condições informadas.';
