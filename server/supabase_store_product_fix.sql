-- Store-manager product insert/storage fix. Run once in Supabase SQL Editor.
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES public.stores(id) ON DELETE SET NULL;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS barcode_number TEXT;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5;

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_store_manager_of(p_store_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_store_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.store_staff
    WHERE store_id = p_store_id AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_store_manager_of(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_store_manager_of(BIGINT) TO authenticated;

DROP POLICY IF EXISTS "Allow public insert on products" ON public.products;
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

DROP POLICY IF EXISTS "Product images public read" ON storage.objects;
CREATE POLICY "Product images public read" ON storage.objects
    FOR SELECT USING (bucket_id = 'product-images');

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
