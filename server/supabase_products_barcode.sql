-- ===================================================
-- SUPERCART PRODUCT BARCODE VERIFICATION
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Project: eagwchutdhtgioujetag
-- ===================================================
--
-- Kya karta hai:
-- 1. products table me `barcode_number` column add karta hai — Store/Admin
--    panel ke Add/Edit Product form se save hota hai (Scan ya manual type).
-- 2. Store Panel "To Pack" me har item ka barcode scan karke verify hota hai;
--    saare items verify hone tak "Mark as Packed" disabled rehta hai.
--
-- NOTE: Column add hone se pehle forms barcode save nahi kar payenge
-- (client graceful fallback ke saath product save kar dega, par barcode skip).

-- 1. Barcode number column (text — EAN-13 digits / Code128 alphanumeric)
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS barcode_number TEXT;

-- 2. Lookup index (To-Pack verify + duplicate check ke liye fast)
CREATE INDEX IF NOT EXISTS idx_products_barcode_number
    ON public.products (barcode_number);

COMMENT ON COLUMN public.products.barcode_number IS
'Product packet ka 1D barcode (Code128 / EAN-13 etc.). To-Pack verification isse match karta hai.';
