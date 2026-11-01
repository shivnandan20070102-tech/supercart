-- Unified homepage banners. Run once in Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.homepage_banners (
    id BIGSERIAL PRIMARY KEY,
    image_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.banners (
    id BIGSERIAL PRIMARY KEY,
    banner_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    background_color TEXT NOT NULL DEFAULT '#059669',
    coupon_code TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.banners (banner_key, title, subtitle, background_color, coupon_code, display_order)
VALUES
    ('welcome-save20', '20% OFF', 'On grocery orders above ₹399', '#047857', 'SAVE20', 0),
    ('fresh-in-minutes', 'Farm-fresh, in minutes', 'Vegetables, fruits, dairy & daily essentials', '#0d9488', NULL, 1),
    ('free-delivery-399', 'Free delivery over ₹399', 'No minimum order • 100% quality checked', '#047857', NULL, 2),
    ('diwali-special-20', 'Diwali Special - Flat 20% Off', 'Sweets, dry fruits & festive essentials', '#d97706', NULL, 3)
ON CONFLICT (banner_key) DO NOTHING;

-- Preserve every poster previously added to homepage_banners.
INSERT INTO public.banners (banner_key, title, subtitle, image_url, display_order, is_active)
SELECT
    'legacy-homepage-' || h.id,
    'SuperCart promotion',
    '',
    h.image_url,
    h.display_order + 4,
    h.is_active
FROM public.homepage_banners AS h
WHERE NOT EXISTS (
    SELECT 1 FROM public.banners AS b
    WHERE b.banner_key = 'legacy-homepage-' || h.id
);

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on banners" ON public.banners;
CREATE POLICY "Allow public read on banners"
    ON public.banners FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage banners" ON public.banners;
CREATE POLICY "Admins can manage banners"
    ON public.banners FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

ALTER TABLE public.banners REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'banners'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.banners;
    END IF;
END $$;
