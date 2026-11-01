-- Delivery partner profile setup v2.
-- Run after the existing delivery migrations. Safe to re-run.
-- This migration only changes delivery_profiles and delivery-documents policies.

ALTER TABLE public.delivery_profiles
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact TEXT;

ALTER TABLE public.delivery_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Delivery partners can insert own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can insert own incomplete profile"
  ON public.delivery_profiles FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND COALESCE(profile_completed, false) = false
    AND COALESCE(approval_status, 'pending') = 'pending'
    AND home_store_id IS NULL
  );

DROP POLICY IF EXISTS "Delivery partners can update own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can update editable delivery profile"
  ON public.delivery_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.delivery_profile_object_path(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL OR value = '' THEN NULL
    WHEN position('/delivery-documents/' IN value) > 0
      THEN split_part(split_part(value, '/delivery-documents/', 2), '?', 1)
    ELSE value
  END;
$$;

CREATE OR REPLACE FUNCTION public.delivery_document_is_valid(value TEXT, allow_pdf BOOLEAN DEFAULT true)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, storage
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'delivery-documents'
      AND o.name = public.delivery_profile_object_path(value)
      AND (storage.foldername(o.name))[1] = auth.uid()::text
      AND COALESCE((o.metadata->>'size') ~ '^[0-9]+$', false)
      AND (o.metadata->>'size')::bigint <= 3145728
      AND (
        (o.metadata->>'mimetype') LIKE 'image/%'
        OR (allow_pdf AND o.metadata->>'mimetype' = 'application/pdf')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.submit_delivery_profile(
  p_name TEXT,
  p_phone TEXT,
  p_vehicle_type TEXT,
  p_vehicle_number TEXT,
  p_emergency_contact TEXT,
  p_profile_photo_url TEXT,
  p_aadhar_card_url TEXT,
  p_driving_license_url TEXT,
  p_pan_card_url TEXT,
  p_bike_image_url TEXT,
  p_home_store_id BIGINT,
  p_request_approval BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) < 2
     OR p_phone IS NULL OR length(trim(p_phone)) < 7
     OR p_vehicle_type IS NULL OR length(trim(p_vehicle_type)) < 2
     OR p_vehicle_number IS NULL OR length(trim(p_vehicle_number)) < 3
     OR p_emergency_contact IS NULL OR length(trim(p_emergency_contact)) < 7
     OR p_home_store_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_home_store_id)
     OR NOT public.delivery_document_is_valid(p_profile_photo_url, false)
     OR NOT public.delivery_document_is_valid(p_aadhar_card_url, true)
     OR NOT public.delivery_document_is_valid(p_driving_license_url, true)
     OR NOT public.delivery_document_is_valid(p_pan_card_url, true)
     OR NOT public.delivery_document_is_valid(p_bike_image_url, false)
  THEN
    RAISE EXCEPTION 'Profile, Home Store and all valid documents are required';
  END IF;

  PERFORM set_config('app.delivery_profile_submit', 'on', true);

  UPDATE public.delivery_profiles
  SET name = trim(p_name),
      phone = trim(p_phone),
      vehicle_type = trim(p_vehicle_type),
      vehicle_number = upper(trim(p_vehicle_number)),
      emergency_contact = trim(p_emergency_contact),
      profile_photo_url = p_profile_photo_url,
      aadhar_card_url = p_aadhar_card_url,
      driving_license_url = p_driving_license_url,
      pan_card_url = p_pan_card_url,
      bike_image_url = p_bike_image_url,
      home_store_id = p_home_store_id,
      profile_completed = true,
      approval_status = CASE WHEN p_request_approval THEN 'pending' ELSE approval_status END,
      rejection_reason = CASE WHEN p_request_approval THEN NULL ELSE rejection_reason END
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_delivery_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_delivery_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_delivery_profile_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin()
     AND COALESCE(current_setting('app.delivery_profile_submit', true), '') <> 'on'
     AND (
       NEW.approval_status IS DISTINCT FROM OLD.approval_status
       OR NEW.profile_completed IS DISTINCT FROM OLD.profile_completed
       OR NEW.home_store_id IS DISTINCT FROM OLD.home_store_id
     )
  THEN
    RAISE EXCEPTION 'Approval status, profile completion and Home Store are server-controlled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_delivery_profile_status ON public.delivery_profiles;
CREATE TRIGGER protect_delivery_profile_status
  BEFORE UPDATE ON public.delivery_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_delivery_profile_status();

INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-documents', 'delivery-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Delivery partners can upload own documents" ON storage.objects;
DROP POLICY IF EXISTS "Delivery partners can upload own documents v2" ON storage.objects;
CREATE POLICY "Delivery partners can upload own documents v2"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND COALESCE((metadata->>'size') ~ '^[0-9]+$', false)
    AND (metadata->>'size')::bigint <= 3145728
    AND ((metadata->>'mimetype') LIKE 'image/%' OR metadata->>'mimetype' = 'application/pdf')
  );

DROP POLICY IF EXISTS "Delivery partners can update own documents" ON storage.objects;
DROP POLICY IF EXISTS "Delivery partners can update own documents v2" ON storage.objects;
CREATE POLICY "Delivery partners can update own documents v2"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'delivery-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (
    bucket_id = 'delivery-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND COALESCE((metadata->>'size') ~ '^[0-9]+$', false)
    AND (metadata->>'size')::bigint <= 3145728
    AND ((metadata->>'mimetype') LIKE 'image/%' OR metadata->>'mimetype' = 'application/pdf')
  );
