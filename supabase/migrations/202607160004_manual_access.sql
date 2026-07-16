alter table public.profiles
  add column if not exists manual_access_until timestamptz;

comment on column public.profiles.manual_access_until is
  'Prazo de uma liberação administrativa temporária, independente da cobrança.';
