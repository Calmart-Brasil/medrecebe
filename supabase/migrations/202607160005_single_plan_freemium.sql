alter table public.profiles
  add column if not exists manual_access_lifetime boolean not null default false,
  add column if not exists suspension_scheduled_at timestamptz,
  add column if not exists suspension_reason text,
  add column if not exists forced_suspension_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_selected_plan_check;

update public.profiles
set selected_plan = 'standard'
where selected_plan is distinct from 'standard';

alter table public.profiles
  alter column selected_plan set default 'standard',
  add constraint profiles_selected_plan_check check (selected_plan = 'standard');

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_code_check,
  drop constraint if exists subscriptions_amount_cents_check;

update public.subscriptions
set plan_code = 'standard'
where plan_code is distinct from 'standard';

alter table public.subscriptions
  alter column plan_code set default 'standard',
  add constraint subscriptions_plan_code_check check (plan_code = 'standard'),
  add constraint subscriptions_amount_cents_check check (amount_cents in (2990, 3990, 5990));

comment on column public.profiles.manual_access_until is
  'Data final da concessão Freemium criada pelo painel administrativo.';

comment on column public.profiles.manual_access_lifetime is
  'Indica concessão Freemium vitalícia, sem data final.';

comment on column public.profiles.suspension_scheduled_at is
  'Data em que uma suspensão administrativa programada passa a bloquear o acesso.';

comment on column public.profiles.forced_suspension_at is
  'Data de uma suspensão imediata por infração às regras de uso.';

create table if not exists public.admin_mfa_email_challenges (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_mfa_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  proof_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_mfa_sessions_user_expiry
  on public.admin_mfa_sessions(user_id, expires_at desc);

alter table public.admin_mfa_email_challenges enable row level security;
alter table public.admin_mfa_sessions enable row level security;

comment on table public.admin_mfa_email_challenges is
  'Etapa iniciada após senha válida para confirmar o segundo fator por e-mail.';

comment on table public.admin_mfa_sessions is
  'Comprovantes opacos e temporários de segundo fator administrativo por e-mail.';

alter table public.admin_audit_log
  alter column target_user_id drop not null,
  drop constraint if exists admin_audit_log_target_user_id_fkey,
  add constraint admin_audit_log_target_user_id_fkey
    foreign key (target_user_id) references public.profiles(id) on delete set null;
