alter table public.profiles
  add column if not exists phone_country_code text,
  add column if not exists phone_number text;

alter table public.profiles
  drop constraint if exists profiles_phone_country_code_check,
  drop constraint if exists profiles_phone_number_check,
  drop constraint if exists profiles_selected_plan_check;

alter table public.profiles
  add constraint profiles_phone_country_code_check
    check (phone_country_code is null or phone_country_code ~ '^\+[1-9][0-9]{0,2}$'),
  add constraint profiles_phone_number_check
    check (phone_number is null or phone_number ~ '^[0-9]{8,15}$'),
  alter column selected_plan set default 'freemium',
  add constraint profiles_selected_plan_check
    check (selected_plan in ('freemium', 'standard'));

comment on column public.profiles.phone_country_code is
  'Código internacional do telefone informado no cadastro, armazenado separadamente do número.';

comment on column public.profiles.phone_number is
  'Número de celular normalizado, contendo somente dígitos.';

comment on column public.profiles.selected_plan is
  'Freemium permite um local de trabalho; standard corresponde ao plano completo pago.';
