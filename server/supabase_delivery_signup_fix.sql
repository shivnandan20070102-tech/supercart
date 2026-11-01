-- Delivery signup/profile/document RLS fix. Run once in Supabase SQL Editor.
-- Safe to re-run. It creates the profile during email-confirmation signup,
-- then lets the authenticated partner complete Home Area and documents.

ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS home_store_id BIGINT REFERENCES public.stores(id) ON DELETE SET NULL;

ALTER TABLE public.delivery_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Delivery partners can read own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can read own profile"
    ON public.delivery_profiles FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Delivery partners can insert own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can insert own profile"
    ON public.delivery_profiles FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Delivery partners can update own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can update own profile"
    ON public.delivery_profiles FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read delivery profiles" ON public.delivery_profiles;
CREATE POLICY "Admins can read delivery profiles"
    ON public.delivery_profiles FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update delivery profile approval" ON public.delivery_profiles;
CREATE POLICY "Admins can update delivery profile approval"
    ON public.delivery_profiles FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-documents', 'delivery-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Delivery partners can upload own documents" ON storage.objects;
CREATE POLICY "Delivery partners can upload own documents"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'delivery-documents'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Delivery partners can update own documents" ON storage.objects;
CREATE POLICY "Delivery partners can update own documents"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'delivery-documents'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'delivery-documents'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Delivery partners can view own documents" ON storage.objects;
CREATE POLICY "Delivery partners can view own documents"
    ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'delivery-documents'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins can view all delivery documents" ON storage.objects;
CREATE POLICY "Admins can view all delivery documents"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'delivery-documents' AND public.is_admin());

-- Email confirmation means the browser has no session at signup time.
-- Create the empty profile from the Auth trigger so the partner can complete
-- Home Area and documents after verifying email and logging in.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    account_name TEXT := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
    account_phone TEXT := COALESCE(NEW.raw_user_meta_data ->> 'phone', '');
    requested_role TEXT := COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer');
BEGIN
    INSERT INTO public.users (id, name, email, phone, role)
    VALUES (
      NEW.id,
      account_name,
      NEW.email,
      account_phone,
      CASE WHEN requested_role IN ('delivery', 'delivery_partner') THEN 'delivery' ELSE 'customer' END
    )
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone;

    IF requested_role IN ('delivery', 'delivery_partner') THEN
      INSERT INTO public.delivery_profiles (user_id, name, email, phone, approval_status, profile_completed)
      VALUES (NEW.id, account_name, NEW.email, account_phone, 'pending', false)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_supercart ON auth.users;
CREATE TRIGGER on_auth_user_created_supercart
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
