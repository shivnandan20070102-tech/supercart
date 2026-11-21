-- Supabase में चलाने से पहले backup लें।
-- ________________________________________
-- ROLLBACK (अगर revert करना हो तो ये चलाएँ):
--   drop function public.update_delivery_profile_basic(text, text, text, text, text, text, text);
-- ________________________________________
--
-- update_delivery_profile_basic
-- Approved (profile_completed = true) delivery partner ke Profile page ka Save.
-- - SIRF auth.uid() ki apni row update karta hai.
-- - Home Store, documents, approval_status, profile_completed, rating kabhi nahi badalta.
-- - Locked fields (name, phone, vehicle_number): agar DB me pehle se bhare hain to
--   purani value hi rakhta hai (nayi ignored); empty hain to ek baar bharna allowed.
-- - email/vehicle_type/emergency_contact/profile_photo_url freely editable.
-- - Agar users table bhi ho to name/phone wahan bhi consistent rakhta hai.

create or replace function public.update_delivery_profile_basic(
  p_name text,
  p_phone text,
  p_email text,
  p_vehicle_type text,
  p_vehicle_number text,
  p_emergency_contact text,
  p_profile_photo_url text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile public.delivery_profiles%rowtype;
  v_users_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_profile
  from public.delivery_profiles
  where user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Delivery profile not found';
  end if;

  update public.delivery_profiles
  set
    -- Locked: already set -> keep; empty -> allow filling once.
    name = case when coalesce(v_profile.name, '') <> '' then v_profile.name else trim(p_name) end,
    phone = case when coalesce(v_profile.phone, '') <> '' then v_profile.phone else trim(p_phone) end,
    vehicle_number = case when coalesce(v_profile.vehicle_number, '') <> '' then v_profile.vehicle_number else upper(trim(p_vehicle_number)) end,
    -- Freely editable.
    email = trim(p_email),
    vehicle_type = trim(p_vehicle_type),
    emergency_contact = trim(p_emergency_contact),
    profile_photo_url = coalesce(nullif(trim(p_profile_photo_url), ''), v_profile.profile_photo_url)
  where user_id = auth.uid();

  -- users table (agar ho) mein bhi name/phone consistent rakho (sirf agar empty ho).
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) into v_users_exists;

  if v_users_exists then
    update public.users
    set
      name = case when coalesce(name, '') <> '' then name else trim(p_name) end,
      phone = case when coalesce(phone, '') <> '' then phone else trim(p_phone) end
    where id = auth.uid();
  end if;
end;
$$;
