alter table public.profiles
  add column if not exists selected_plan text not null default 'mobile'
    check (selected_plan in ('mobile', 'web')),
  add column if not exists trial_ends_at timestamptz;

update public.profiles
set trial_ends_at = created_at + interval '7 days'
where role = 'user' and trial_ends_at is null;

alter table public.subscriptions
  drop constraint if exists subscriptions_amount_cents_check;

alter table public.subscriptions
  add constraint subscriptions_amount_cents_check check (amount_cents in (2990, 5990)),
  add column if not exists plan_code text not null default 'mobile'
    check (plan_code in ('mobile', 'web')),
  add column if not exists provider_payment_id text,
  add column if not exists canceled_at timestamptz,
  add column if not exists refunded_at timestamptz;

create table if not exists public.user_app_states (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_app_states enable row level security;

drop policy if exists "app_state_select_own" on public.user_app_states;
create policy "app_state_select_own"
on public.user_app_states for select
to authenticated
using (user_id = (select auth.uid()));

create trigger user_app_states_touch_updated_at
before update on public.user_app_states
for each row execute function public.touch_updated_at();

comment on table public.user_app_states is
  'Estado operacional sincronizado do plano Web. Fotos e credenciais são removidas antes da persistência.';
