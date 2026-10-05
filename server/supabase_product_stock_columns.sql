-- ===================================================
-- SUPERCART PRODUCT STOCK COLUMNS v2 (naye canonical columns)
-- Supabase SQL Editor me ek baar RUN karo (purani stock migration ke BAAD).
--
-- 1. stock_quantity (INTEGER DEFAULT 0) — kitne pieces available hain.
-- 2. low_stock_threshold (INTEGER DEFAULT 5) — is se kam par "Low Stock".
-- 3. is_in_stock (BOOLEAN GENERATED ALWAYS AS (stock_quantity > 0) STORED).
--
-- IMPORTANT: purane `stock` / `in_stock` columns pehle se hain aur code unhi
-- par chalta tha. Dukaan band na ho isliye:
-- (a) existing rows ka stock_quantity purane `stock` se backfill hota hai
--     (warna sab 0 ho kar "Out of Stock" dikhne lagte),
-- (b) neeche wala sync trigger dono generations ko hamesha mirror rakhta hai
--     (purana admin/seed `stock` likhe ya naya code `stock_quantity` — ek hi
--     sach rehta hai),
-- (c) atomic decrement/increment RPCs naye columns par re-create hote hain.
-- Idempotent hai — dobara RUN karna safe hai.
-- ===================================================

-- 1. Naye columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_in_stock BOOLEAN GENERATED ALWAYS AS (stock_quantity > 0) STORED;

-- 2. Backfill: existing inventory purane `stock` se lao (ek baar; trigger ke
-- baad dono hamesha barabar rehte hain, isliye re-run safe hai).
UPDATE public.products
SET stock_quantity = GREATEST(COALESCE(stock, 0), 0)
WHERE stock_quantity IS DISTINCT FROM GREATEST(COALESCE(stock, 0), 0);

-- Threshold kabhi NULL/negative na rahe.
UPDATE public.products
SET low_stock_threshold = 5
WHERE low_stock_threshold IS NULL OR low_stock_threshold < 0;

-- 3. Naye products default OUT-OF-STOCK rahein (stock_quantity default 0 ke
-- saath consistent) — pehle legacy `stock` default 50 tha.
ALTER TABLE public.products ALTER COLUMN stock SET DEFAULT 0;

-- 4. Unified sync trigger: naya canonical, purana mirror.
-- - Normal case: stock_quantity authoritative → stock/in_stock mirror.
-- - Legacy path (purana admin/seed/sirf `stock` likhe) → stock_quantity us se.
-- - INSERT me purane seeds (sirf stock wale) → stock_quantity me lao.
CREATE OR REPLACE FUNCTION public.sync_product_stock_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.stock_quantity IS NOT DISTINCT FROM OLD.stock_quantity
     AND NEW.stock IS DISTINCT FROM OLD.stock THEN
    NEW.stock_quantity := COALESCE(NEW.stock, 0);
  END IF;
  IF TG_OP = 'INSERT'
     AND COALESCE(NEW.stock_quantity, 0) = 0
     AND COALESCE(NEW.stock, 0) > 0 THEN
    NEW.stock_quantity := NEW.stock;
  END IF;
  NEW.stock_quantity := GREATEST(COALESCE(NEW.stock_quantity, 0), 0);
  NEW.low_stock_threshold := GREATEST(COALESCE(NEW.low_stock_threshold, 5), 0);
  NEW.stock := NEW.stock_quantity;
  NEW.in_stock := (NEW.stock_quantity > 0);
  -- is_in_stock GENERATED hai — khud compute ho jayega.
  RETURN NEW;
END;
$$;

-- Purana single-column trigger replace ho gaya (dono chalte to confusion hota).
DROP TRIGGER IF EXISTS trg_sync_product_in_stock ON public.products;
DROP TRIGGER IF EXISTS trg_sync_product_stock_columns ON public.products;
CREATE TRIGGER trg_sync_product_stock_columns
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock_columns();

-- Sab rows ek jaisi karo (trigger aage se sambhal lega).
UPDATE public.products
SET stock_quantity = GREATEST(COALESCE(stock_quantity, stock, 0), 0)
WHERE TRUE;

-- 5. Atomic RPCs — naye columns par (concurrency guarantee same hai:
-- single UPDATE ... WHERE stock_quantity >= qty, negative kabhi nahi).
CREATE OR REPLACE FUNCTION public.decrement_product_stock(p_product_id BIGINT, p_qty INTEGER)
RETURNS TABLE (success BOOLEAN, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining INTEGER;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be a positive integer';
  END IF;

  UPDATE public.products
  SET stock_quantity = stock_quantity - p_qty
  WHERE id = p_product_id
    AND COALESCE(stock_quantity, 0) >= p_qty
  RETURNING stock_quantity INTO v_remaining;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_remaining;
  ELSE
    RETURN QUERY SELECT FALSE, (SELECT stock_quantity FROM public.products WHERE id = p_product_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_product_stock(p_product_id BIGINT, p_qty INTEGER)
RETURNS TABLE (success BOOLEAN, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining INTEGER;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be a positive integer';
  END IF;

  UPDATE public.products
  SET stock_quantity = COALESCE(stock_quantity, 0) + p_qty
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_remaining;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_remaining;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::INTEGER;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_product_stock(BIGINT, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_product_stock(BIGINT, INTEGER) TO anon, authenticated, service_role;
