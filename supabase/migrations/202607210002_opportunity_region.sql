alter table public.professional_profiles
  add column if not exists opportunity_city_code char(7);

alter table public.professional_profiles
  drop constraint if exists professional_profiles_opportunity_city_code_check;

alter table public.professional_profiles
  add constraint professional_profiles_opportunity_city_code_check
  check (opportunity_city_code is null or opportunity_city_code ~ '^[0-9]{7}$');

comment on column public.professional_profiles.opportunity_city_code is
  'Código oficial IBGE do município-base usado no filtro territorial. O aplicativo não utiliza GPS.';
