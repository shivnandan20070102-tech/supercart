-- SuperCart catalog, category and banner fixes.
-- Run this file once in the Supabase SQL Editor.

-- Product fields used by StoreDashboard.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS barcode_number TEXT,
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5;

CREATE INDEX IF NOT EXISTS idx_products_store_id ON public.products (store_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode_number ON public.products (barcode_number);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on categories" ON public.categories;
CREATE POLICY "Allow public read on categories" ON public.categories
  FOR SELECT USING (true);

-- Store managers can write only products linked to their store_staff rows.
CREATE OR REPLACE FUNCTION public.is_store_manager_of(p_store_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p_store_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.store_staff
    WHERE store_id = p_store_id AND user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Allow public insert on products" ON public.products;
DROP POLICY IF EXISTS "Admin full write on products" ON public.products;
CREATE POLICY "Admin full write on products" ON public.products
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Store managers insert own-store products" ON public.products;
CREATE POLICY "Store managers insert own-store products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_store_manager_of(store_id));

DROP POLICY IF EXISTS "Store managers update own-store products" ON public.products;
CREATE POLICY "Store managers update own-store products" ON public.products
  FOR UPDATE TO authenticated
  USING (public.is_store_manager_of(store_id))
  WITH CHECK (public.is_store_manager_of(store_id));

DROP POLICY IF EXISTS "Store managers delete own-store products" ON public.products;
CREATE POLICY "Store managers delete own-store products" ON public.products
  FOR DELETE TO authenticated
  USING (public.is_store_manager_of(store_id));

DROP POLICY IF EXISTS "Allow public read on products" ON public.products;
CREATE POLICY "Allow public read on products" ON public.products
  FOR SELECT USING (true);

-- Product images are public, while uploads/updates/deletes require login.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Authenticated users upload product images" ON storage.objects;
CREATE POLICY "Authenticated users upload product images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Authenticated users update product images" ON storage.objects;
CREATE POLICY "Authenticated users update product images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Authenticated users delete product images" ON storage.objects;
CREATE POLICY "Authenticated users delete product images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

-- One canonical banner table for both the customer carousel and Admin panel.
CREATE TABLE IF NOT EXISTS public.banners (
  id BIGSERIAL PRIMARY KEY,
  banner_key TEXT,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  background_color TEXT NOT NULL DEFAULT '#047857',
  coupon_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS banner_key TEXT;
UPDATE public.banners SET banner_key = 'legacy-banner-' || id WHERE banner_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS banners_banner_key_key ON public.banners (banner_key);

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on banners" ON public.banners;
CREATE POLICY "Allow public read on banners" ON public.banners
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage banners" ON public.banners;
CREATE POLICY "Admins can manage banners" ON public.banners
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Preserve every existing manually-uploaded homepage poster.
INSERT INTO public.banners (banner_key, title, subtitle, image_url, display_order, is_active, created_at)
SELECT 'legacy-homepage-' || h.id, 'SuperCart promotion', '', h.image_url, h.display_order + 4, h.is_active, h.created_at
FROM public.homepage_banners h
WHERE NOT EXISTS (
  SELECT 1 FROM public.banners b WHERE b.banner_key = 'legacy-homepage-' || h.id
);

-- Migrate the four cards previously hardcoded in OfferCarousel.
INSERT INTO public.banners (banner_key, title, subtitle, coupon_code, background_color, display_order, is_active)
SELECT v.banner_key, v.title, v.subtitle, v.coupon_code, v.background_color, v.display_order, true
FROM (VALUES
  ('welcome-save20', 'Welcome offer', '20% OFF on grocery orders above ₹399', 'SAVE20', '#047857', 0),
  ('fresh-in-minutes', 'Farm-fresh, in minutes', 'Vegetables, fruits, dairy & daily essentials', NULL, '#0d9488', 1),
  ('free-delivery-399', 'Free delivery over ₹399', 'No minimum order • 100% quality checked', NULL, '#047857', 2),
  ('diwali-special-20', 'Diwali Special - Flat 20% Off', 'Sweets, dry fruits & festive essentials', NULL, '#c2410c', 3)
) AS v(banner_key, title, subtitle, coupon_code, background_color, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.banners b WHERE b.banner_key = v.banner_key
);

-- Keep this separate so the migration remains compatible with an older
-- banners table that already contains the four seeded records.
INSERT INTO public.banners (banner_key, title, subtitle, coupon_code, background_color, display_order, is_active)
SELECT v.banner_key, v.title, v.subtitle, v.coupon_code, v.background_color, v.display_order, true
FROM (VALUES
  ('welcome-save20', 'Welcome offer', '20% OFF on grocery orders above ₹399', 'SAVE20', '#047857', 0),
  ('fresh-in-minutes', 'Farm-fresh, in minutes', 'Vegetables, fruits & daily essentials', NULL, '#0d9488', 1),
  ('free-delivery-399', 'Free delivery over ₹399', 'No minimum order • 100% quality checked', NULL, '#047857', 2),
  ('diwali-special-20', 'Diwali Special - Flat 20% Off', 'Sweets, dry fruits & festive essentials', NULL, '#c2410c', 3)
) AS v(banner_key, title, subtitle, coupon_code, background_color, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.banners b WHERE b.banner_key = v.banner_key
);

ALTER TABLE public.banners REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'banners'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.banners;
  END IF;
END $$;
