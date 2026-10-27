-- Homepage carousel posters. Run once in Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.homepage_banners (
    id BIGSERIAL PRIMARY KEY,
    image_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.homepage_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on homepage banners" ON public.homepage_banners;
CREATE POLICY "Allow public read on homepage banners"
    ON public.homepage_banners FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage homepage banners" ON public.homepage_banners;
CREATE POLICY "Admins can manage homepage banners"
    ON public.homepage_banners FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'homepage_banners'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.homepage_banners;
    END IF;
END $$;
