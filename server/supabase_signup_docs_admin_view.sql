-- ===================================================
-- SUPERCART DELIVERY SIGNUP DOCS — ADMIN VIEW (signed URLs)
-- Copy & paste this entire file into Supabase SQL Editor and click "RUN".
-- Idempotent (safe to re-run).
--
-- Purpose: delivery docs are stored in the PRIVATE bucket `delivery-documents`.
-- The admin approval UI reads them through short-lived signed URLs
-- (client/src/components/SignedDoc.jsx + client/src/utils/deliveryDocs.js).
-- Postgres RLS controls who may mint a signed URL: a SELECT on storage.objects.
--
-- This migration guarantees:
--   1. Admin can SELECT (=> mint signed URLs for) EVERY partner's documents.
--   2. A delivery partner can only SELECT/mint for his OWN folder.
--   3. No other role / anonymous can see anything.
-- It relies on public.is_admin() (defined in supabase_admin_master_access.sql /
--    supabase_security_hardening.sql). Back up before running.
-- ===================================================

-- Bucket stays private (defensive; no-op if already false).
UPDATE storage.buckets
SET public = false
WHERE id = 'delivery-documents';

-- Partner: only own folder (SELECT → can mint own signed URLs).
DROP POLICY IF EXISTS "Delivery partners can view own documents" ON storage.objects;
CREATE POLICY "Delivery partners can view own documents"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'delivery-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Admin: all partners' documents (SELECT → can mint signed URLs for approval UI).
DROP POLICY IF EXISTS "Admins can view all delivery documents" ON storage.objects;
CREATE POLICY "Admins can view all delivery documents"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'delivery-documents'
        AND public.is_admin()
    );

-- Guard: ensure is_admin exists (safe no-op if already present).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin');
$$;

-- Rollback (restore old behaviour):
--   DROP POLICY IF EXISTS "Admins can view all delivery documents" ON storage.objects;
--   DROP POLICY IF EXISTS "Delivery partners can view own documents" ON storage.objects;
--   (Bucket + is_admin() are left unchanged — they were pre-existing.)
