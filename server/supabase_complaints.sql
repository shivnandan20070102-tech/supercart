-- ===================================================
-- SUPERCART COMPLAINTS / GRIEVANCE SYSTEM
-- Supabase SQL Editor me ek baar RUN karo.
--
-- Table: complaints (customer + delivery_partner + store_manager).
-- - complainant apni complaint insert + apni list read kar sakta hai.
-- - status/admin_response SIRF admin badal sakta hai.
-- - Photo: 'complaint-photos' bucket (public read, owner-write).
-- - Realtime publication me joda gaya (admin ko turant dikhe).
-- Idempotent hai — dobara RUN karna safe hai.
-- ===================================================

CREATE TABLE IF NOT EXISTS public.complaints (
  id BIGSERIAL PRIMARY KEY,
  complainant_id TEXT NOT NULL,
  complainant_type TEXT NOT NULL CHECK (complainant_type IN ('customer', 'delivery_partner', 'store_manager')),
  complainant_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 5000),
  photo_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
  admin_response TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaints_type_status ON public.complaints (complainant_type, status);
CREATE INDEX IF NOT EXISTS idx_complaints_complainant ON public.complaints (complainant_id);
CREATE INDEX IF NOT EXISTS idx_complaints_created ON public.complaints (created_at DESC);

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

-- Apni complaints padho (auth user) + admin sab padhe.
DROP POLICY IF EXISTS "Own complaints read" ON public.complaints;
CREATE POLICY "Own complaints read" ON public.complaints
  FOR SELECT TO authenticated
  USING (complainant_id = auth.uid()::text);

DROP POLICY IF EXISTS "Admin complaints read" ON public.complaints;
CREATE POLICY "Admin complaints read" ON public.complaints
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Complaint raise karo: sirf apne naam par, status hamesha pending,
-- admin_response hamesha blank (user fake admin reply na bhar sake).
DROP POLICY IF EXISTS "Own complaint insert" ON public.complaints;
CREATE POLICY "Own complaint insert" ON public.complaints
  FOR INSERT TO authenticated
  WITH CHECK (complainant_id = auth.uid()::text
    AND complainant_type IN ('customer', 'delivery_partner', 'store_manager')
    AND status = 'pending'
    AND (admin_response = '' OR admin_response IS NULL));

-- Status + admin reply: SIRF admin.
DROP POLICY IF EXISTS "Admin complaints update" ON public.complaints;
CREATE POLICY "Admin complaints update" ON public.complaints
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admin complaints delete" ON public.complaints;
CREATE POLICY "Admin complaints delete" ON public.complaints
  FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Photo bucket (public read taaki admin/user photo dekh sakein).
INSERT INTO storage.buckets (id, name, public)
VALUES ('complaint-photos', 'complaint-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Complaint photos public read" ON storage.objects;
CREATE POLICY "Complaint photos public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'complaint-photos');

-- FIX: client path hai 'complaints/<uid>/<file>' (complaints.js dekho),
-- isliye folder [1]='complaints', [2]=uid hota hai. Purana check ([1]=uid)
-- har photo upload ko "new row violates row-level security policy" se fail
-- karta tha. Dono layouts allow karo (naya + backward-compat '<uid>/<file>').
DROP POLICY IF EXISTS "Complaint photos owner upload" ON storage.objects;
CREATE POLICY "Complaint photos owner upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'complaint-photos'
    AND (
      ((storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (storage.foldername(name))[1] = auth.uid()::text
    ));

DROP POLICY IF EXISTS "Complaint photos owner update" ON storage.objects;
CREATE POLICY "Complaint photos owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'complaint-photos'
    AND (
      ((storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (storage.foldername(name))[1] = auth.uid()::text
    ))
  WITH CHECK (bucket_id = 'complaint-photos'
    AND (
      ((storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (storage.foldername(name))[1] = auth.uid()::text
    ));

-- Owner apni photo delete kar sake (retry/cancel case). Admin read public
-- policy se covered hai; bucket private ho to bhi admin dekh sake isliye
-- explicit admin SELECT (existing users-table pattern, RLS ON rehta hai).
DROP POLICY IF EXISTS "Complaint photos owner delete" ON storage.objects;
CREATE POLICY "Complaint photos owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'complaint-photos'
    AND (
      ((storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (storage.foldername(name))[1] = auth.uid()::text
    ));

DROP POLICY IF EXISTS "Complaint photos admin read" ON storage.objects;
CREATE POLICY "Complaint photos admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'complaint-photos'
    AND ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')));

-- Realtime (nayi complaint turant admin panel me).
ALTER TABLE public.complaints REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'complaints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
  END IF;
END;
$$;

-- ===================================================
-- VERIFY:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'complaints';
--   SELECT * FROM storage.buckets WHERE id = 'complaint-photos';
-- ===================================================
