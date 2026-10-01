-- ===================================================
-- SUPERCART DELIVERY DOCUMENTS — PRIVATE BUCKET + RLS
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Ye script idempotent hai (dobara RUN karne par error nahi dega)
--
-- Kya karta hai:
--  1. delivery-documents bucket ko PRIVATE (public access band —
--     purani public URLs kaam karna band kar dengi).
--  2. Storage RLS policies:
--     - Delivery Partner: SIRF apne documents (apne user_id folder wale)
--       dekh + upload kar sakta hai.
--     - Admin: sabke documents dekh sakta hai.
--     - Bina login / dusra role: kuch nahi dekh sakta.
--  3. App documents ab Signed URLs (1 ghante valid) se dikhati hai —
--     client code me utils/deliveryDocs.js dekho.
--
-- NOTE: upload path hamesha "<user_id>/..." format me hai
-- (client uploadFile), isliye folder-check RLS kaam karta hai.
-- product-images bucket ko haath NAHI lagata (catalog public rehta hai).
-- ===================================================

-- ---------------------------------------------------
-- 1. Bucket PRIVATE karo (purani public links dead)
-- ---------------------------------------------------
UPDATE storage.buckets
SET public = false
WHERE id = 'delivery-documents';

-- ---------------------------------------------------
-- 2. Cleanup: delivery-documents par koi purani permissive
--    object policy ho to hatao (naam me 'delivery' wali).
--    product-images jaisi dusri buckets ki policies untouched.
-- ---------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname ILIKE '%delivery%'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
    END LOOP;
END $$;

-- ---------------------------------------------------
-- 3. Partner: SIRF apne documents dekhe (apna folder)
-- ---------------------------------------------------
DROP POLICY IF EXISTS "Delivery partners can view own documents" ON storage.objects;
CREATE POLICY "Delivery partners can view own documents"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'delivery-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- ---------------------------------------------------
-- 4. Partner: SIRF apne folder me upload kare
-- ---------------------------------------------------
DROP POLICY IF EXISTS "Delivery partners can upload own documents" ON storage.objects;
CREATE POLICY "Delivery partners can upload own documents"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'delivery-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- ---------------------------------------------------
-- 5. Admin: sabke documents dekhe (signed URL mint kar sake)
--    (Admin check — users table wala existing pattern)
-- ---------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all delivery documents" ON storage.objects;
CREATE POLICY "Admins can view all delivery documents"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'delivery-documents'
        AND (
            (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
            OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
        )
    );

-- ---------------------------------------------------
-- VERIFY (RUN ke baad Supabase me ye queries check karo)
-- ---------------------------------------------------
-- -- 1. Bucket private? (public = false aana chahiye)
-- SELECT id, public FROM storage.buckets WHERE id = 'delivery-documents';
--
-- -- 2. Policies lagi? (3 rows aani chahiye)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname ILIKE '%deliver%';
--
-- -- 3. TEST (SQL Editor me postgres role se nahi — app se karo):
-- --    a. Purani public URL ko incognito (bina login) browser me kholo
-- --       → file NAHI khulni chahiye (400/403).
-- --    b. Partner login → apne docs dikhe; dusre partner ke docs ka
-- --       signed URL agar mil bhi jaye to expire ke baad dead.
-- --    c. Admin login → sabke docs dikhe.
