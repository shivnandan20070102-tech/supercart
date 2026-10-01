-- SuperCart admin role setup for Supabase
-- Run this file in Supabase Dashboard -> SQL Editor.

-- 1) Add the role column to an existing public.users table.
-- Create the application profile table if this Supabase project only has auth.users.
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';

-- Repair any old NULL values.
UPDATE public.users
SET role = 'customer'
WHERE role IS NULL;

-- Copy existing Supabase Auth users into the profile table.
INSERT INTO public.users (id, name, email, phone, role)
SELECT
  id,
  COALESCE(raw_user_meta_data ->> 'full_name', ''),
  email,
  COALESCE(raw_user_meta_data ->> 'phone', ''),
  COALESCE(raw_user_meta_data ->> 'role', 'customer')
FROM auth.users
WHERE email IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  role = EXCLUDED.role;

-- Keep a profile row available for future Auth signups, so orders can use the
-- Auth UUID foreign key and appear in the admin dashboard.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, name, email, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'phone', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Optional: restrict values to the supported roles.
DO $$
BEGIN
  ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE public.users
    ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin', 'delivery_partner', 'delivery'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_boy_id TEXT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Promote an existing row in public.users by email.
-- Replace the email before running.
UPDATE public.users
SET role = 'admin'
WHERE lower(email) = lower('shivnandan20070120@gmail.com');

-- 3) If login uses Supabase Authentication (recommended), also set the
-- role in Auth user metadata. Replace the email before running.
UPDATE auth.users
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'admin')
WHERE lower(email) = lower('shivnandan20070120@gmail.com');

-- 4) Verify both records.
SELECT id, email, role
FROM public.users
WHERE lower(email) = lower('shivnandan20070120@gmail.com');

SELECT id, email, raw_user_meta_data ->> 'role' AS auth_role
FROM auth.users
WHERE lower(email) = lower('shivnandan20070120@gmail.com');

-- 5) Product image storage for the admin Products section.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public can view product images" ON storage.objects;
CREATE POLICY "Public can view product images"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Admins can upload product images" ON storage.objects;
CREATE POLICY "Admins can upload product images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

DROP POLICY IF EXISTS "Admins can update product images" ON storage.objects;
CREATE POLICY "Admins can update product images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

DROP POLICY IF EXISTS "Admins can delete product images" ON storage.objects;
CREATE POLICY "Admins can delete product images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- Enable realtime events for the products table.
ALTER TABLE public.products REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.orders REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- To remove admin access later:
-- UPDATE public.users SET role = 'customer'
-- WHERE lower(email) = lower('shivnandan20070120@gmail.com');
--
-- UPDATE auth.users
-- SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
--   || jsonb_build_object('role', 'customer')
-- WHERE lower(email) = lower('shivnandan20070120@gmail.com');
