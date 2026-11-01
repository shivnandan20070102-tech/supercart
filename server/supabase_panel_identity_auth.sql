-- Run only after reviewing the dry-run result below.
-- This migration replaces the old shared-password multi-role model.

-- DRY RUN: review this result before changing any Auth email.
-- Auth emails are intentionally not changed by this SQL file.
select
  u.id as user_id,
  u.email as profile_email,
  u.name,
  case when exists (
    select 1 from public.users customer
    where lower(customer.email) = lower(u.email)
      and customer.role = 'customer'
      and customer.id <> u.id
  ) then 'shared-with-customer' else 'store-only' end as migration_case,
  regexp_replace(lower(u.email), '^([^@]+)@', '\1+sc-store@') as target_store_auth_email
from public.users u
where lower(u.role) = 'store_manager'
order by lower(u.email);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'delivery', 'store_manager')),
  created_at timestamptz not null default now()
);

-- Keep one deterministic non-admin role per Auth user while converting old
-- composite-key rows. Admin remains exclusively in public.users.role.
insert into public.user_roles (user_id, role)
select u.id,
       case lower(u.role)
         when 'delivery_partner' then 'delivery'
         when 'store_manager' then 'store_manager'
         else 'customer'
       end
from public.users u
join auth.users au on au.id = u.id
where lower(u.role) in ('customer', 'delivery', 'delivery_partner', 'store_manager')
  and not exists (
    select 1 from public.user_roles existing
    where existing.user_id = u.id
  );

delete from public.user_roles
where ctid in (
  select duplicate_ctid
  from (
    select ctid as duplicate_ctid,
           row_number() over (partition by user_id order by created_at, ctid) as role_number
    from public.user_roles
  ) ranked
  where role_number > 1
);

alter table public.user_roles
  drop constraint if exists user_roles_pkey;
alter table public.user_roles
  add constraint user_roles_pkey primary key (user_id);
alter table public.user_roles enable row level security;

drop policy if exists "Users can insert their own roles" on public.user_roles;
drop policy if exists "Users can update their own roles" on public.user_roles;
drop policy if exists "Users can delete their own roles" on public.user_roles;
drop policy if exists "Users can read their own roles" on public.user_roles;
drop policy if exists "Users read own roles" on public.user_roles;
drop policy if exists "Admins read roles" on public.user_roles;
drop policy if exists "Clients write roles" on public.user_roles;
create policy "Users can read their own single role"
  on public.user_roles for select
  to authenticated
  using (auth.uid() = user_id);
create policy "Admins can read panel roles"
  on public.user_roles for select
  to authenticated
  using (exists (
    select 1 from public.users
    where public.users.id = auth.uid()
      and lower(public.users.role) = 'admin'
  ));

create or replace function public.has_role(uid uuid, requested_role text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = requested_role
  );
$$;
revoke all on function public.has_role(uuid, text) from public;
grant execute on function public.has_role(uuid, text) to authenticated;

-- Server signup/admin flows use the service role. This function is available
-- to trusted backend migrations without granting client role writes.
create or replace function public.assign_panel_role(target_user_id uuid, target_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_role not in ('customer', 'delivery', 'store_manager') then
    raise exception 'invalid panel role';
  end if;
  insert into public.user_roles (user_id, role)
  values (target_user_id, target_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;
revoke all on function public.assign_panel_role(uuid, text) from public;
