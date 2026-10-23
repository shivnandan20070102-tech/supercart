-- ===================================================
-- SUPERCART STORE-SPECIFIC PRODUCTS
-- Run this once in the Supabase SQL editor.
--
-- This is intentionally destructive for legacy global products:
-- products with store_id IS NULL are removed before the invariant is added.
-- ===================================================

BEGIN;

DELETE FROM public.products
WHERE store_id IS NULL;

ALTER TABLE public.products
  ALTER COLUMN store_id SET NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_store_id_fkey;

ALTER TABLE public.products
  ADD CONSTRAINT products_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_products_store_id ON public.products(store_id);

COMMIT;

-- Verify the cleanup and invariant:
-- SELECT COUNT(*) AS global_products FROM public.products WHERE store_id IS NULL;
-- SELECT column_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'store_id';
