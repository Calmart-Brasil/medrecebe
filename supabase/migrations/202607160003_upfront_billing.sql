update public.profiles as profile
set trial_ends_at = null,
    access_status = case
      when profile.role = 'user'
       and profile.access_status = 'active'
       and not exists (
         select 1
         from public.subscriptions as subscription
         where subscription.user_id = profile.id
           and subscription.is_current = true
           and subscription.status = 'authorized'
       ) then 'pending_payment'
      else profile.access_status
    end
where profile.trial_ends_at is not null;

comment on column public.profiles.trial_ends_at is
  'Campo legado. Novas contratações são cobradas no início e têm garantia de reembolso por 7 dias.';
