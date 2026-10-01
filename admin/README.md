# SuperCart Admin Role Setup

## Supabase Dashboard Steps

1. Open Supabase Dashboard and select the SuperCart project.
2. Open **SQL Editor** and create a new query.
3. Copy and run `admin/supabase_admin_role.sql`.
4. Replace `admin@example.com` in the two promotion queries with the existing user's email before running them.
5. Run the verification queries at the bottom. The result should show `admin`.
6. Log out and log in again so the user's refreshed session contains the new role.

The migration adds `public.users.role` with `customer` as the default and allows `customer` or `admin`. The Auth metadata update is included because this project signs users in with Supabase Auth.

## Quick SQL

```sql
UPDATE auth.users
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'admin')
WHERE lower(email) = lower('your-email@example.com');
```

For a separate application users table, also run:

```sql
UPDATE public.users
SET role = 'admin'
WHERE lower(email) = lower('your-email@example.com');
```

Do not expose the Supabase service-role key in the frontend. SQL Editor is the safe place for this administrative update.
