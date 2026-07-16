create type public.user_role as enum ('user', 'admin');
create type public.access_status as enum ('pending_payment', 'active', 'past_due', 'suspended', 'canceled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 120),
  email text not null unique,
  cpf_hash text not null unique,
  cpf_last4 char(4) not null,
  role public.user_role not null default 'user',
  access_status public.access_status not null default 'pending_payment',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_subscription_id text unique,
  status text not null default 'pending',
  amount_cents integer not null default 2990 check (amount_cents = 2990),
  currency char(3) not null default 'BRL' check (currency = 'BRL'),
  checkout_url text,
  is_current boolean not null default true,
  current_period_end timestamptz,
  last_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscriptions_one_current_per_user
  on public.subscriptions(user_id)
  where is_current;

create table public.billing_events (
  id bigint generated always as identity primary key,
  provider_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references public.profiles(id),
  target_user_id uuid not null references public.profiles(id),
  action text not null,
  previous_value jsonb,
  next_value jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger subscriptions_touch_updated_at
before update on public.subscriptions
for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.admin_audit_log enable row level security;

create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = (select auth.uid()) or public.is_admin());

create policy "subscriptions_select_own_or_admin"
on public.subscriptions for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

create policy "audit_select_admin"
on public.admin_audit_log for select
to authenticated
using (public.is_admin());

comment on table public.profiles is 'Perfis do MedRecebe. O CPF completo não é persistido: apenas hash com pepper e últimos quatro dígitos.';
comment on table public.subscriptions is 'Estado espelhado das assinaturas recorrentes do Mercado Pago.';
