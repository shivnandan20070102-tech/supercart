alter table public.delivery_profiles
  add column if not exists settings jsonb not null default '{
    "darkTheme": true,
    "appLanguage": "English",
    "audioLanguage": "English",
    "supportLanguage": "English",
    "orderAlertSound": "Default"
  }'::jsonb;

alter table public.delivery_profiles
  add column if not exists approval_status text not null default 'pending';

update public.delivery_profiles
set approval_status = 'pending'
where approval_status is null
   or approval_status not in ('pending', 'approved', 'rejected');

alter table public.delivery_profiles
  drop constraint if exists delivery_profiles_approval_status_check;

alter table public.delivery_profiles
  add constraint delivery_profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));
