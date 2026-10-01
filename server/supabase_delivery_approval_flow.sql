-- Delivery partner approval flow migration.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.delivery_profiles
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.delivery_profiles
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.delivery_profiles
  ADD COLUMN IF NOT EXISTS bike_image_url TEXT;

ALTER TABLE public.delivery_profiles
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.delivery_profiles
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE public.delivery_profiles
  ALTER COLUMN approval_status SET DEFAULT 'pending';

UPDATE public.delivery_profiles
SET profile_completed = false
WHERE profile_completed IS NULL;

UPDATE public.delivery_profiles
SET approval_status = 'pending'
WHERE approval_status IS NULL
   OR approval_status NOT IN ('pending', 'approved', 'rejected');

ALTER TABLE public.delivery_profiles
  DROP CONSTRAINT IF EXISTS delivery_profiles_approval_status_check;

ALTER TABLE public.delivery_profiles
  ADD CONSTRAINT delivery_profiles_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.delivery_profiles REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "Admins can update delivery profile approval" ON public.delivery_profiles;
CREATE POLICY "Admins can update delivery profile approval" ON public.delivery_profiles
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'delivery_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_profiles;
  END IF;
END $$;

-- BACKFILL: pehle se approved partners ke users.verified = true karo.
-- Wajah: auto-assign (Node worker/pack + DB triggers) users.verified gate par
-- chalta hai, lekin approval flow pehle sirf delivery_profiles.approval_status
-- set karta tha — isliye approved + Online partners bhi eligible nahi bante
-- the aur packed orders "Waiting for Delivery Boy" par atak jate the.
-- Idempotent hai (dobara RUN safe); rejected/pending ko haath nahi lagata.
UPDATE public.users AS u
SET verified = true
WHERE u.role IN ('delivery', 'delivery_partner')
  AND COALESCE(u.verified, false) = false
  AND EXISTS (
    SELECT 1 FROM public.delivery_profiles AS dp
    WHERE dp.user_id = u.id
      AND dp.approval_status = 'approved'
  );
