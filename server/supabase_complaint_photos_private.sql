-- SuperCart complaint photo storage and multi-photo migration.
-- Run once in Supabase SQL Editor.

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.complaints
SET photo_urls = ARRAY[photo_url]
WHERE COALESCE(photo_url, '') <> '' AND cardinality(photo_urls) = 0;

INSERT INTO storage.buckets (id, name, public)
VALUES ('complaint-photos', 'complaint-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Complaint photos owner upload" ON storage.objects;
CREATE POLICY "Complaint photos owner upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'complaint-photos'
  AND (storage.foldername(name))[1] = 'complaints'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "Complaint photos owner read" ON storage.objects;
CREATE POLICY "Complaint photos owner read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'complaint-photos'
  AND (
    public.is_admin()
    OR (storage.foldername(name))[1] = 'complaints'
       AND (storage.foldername(name))[2] = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Complaint photos owner update" ON storage.objects;
CREATE POLICY "Complaint photos owner update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'complaint-photos' AND (storage.foldername(name))[1] = 'complaints' AND (storage.foldername(name))[2] = auth.uid()::text)
WITH CHECK (bucket_id = 'complaint-photos' AND (storage.foldername(name))[1] = 'complaints' AND (storage.foldername(name))[2] = auth.uid()::text);

DROP POLICY IF EXISTS "Complaint photos owner delete" ON storage.objects;
CREATE POLICY "Complaint photos owner delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'complaint-photos' AND (storage.foldername(name))[1] = 'complaints' AND (storage.foldername(name))[2] = auth.uid()::text);

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own complaints read" ON public.complaints;
CREATE POLICY "Own complaints read" ON public.complaints FOR SELECT TO authenticated
USING (complainant_id = auth.uid()::text OR public.is_admin());
