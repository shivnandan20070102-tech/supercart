-- ===================================================
-- SUPERCART REAL-TIME PRODUCT STOCK (atomic, race-safe)
-- Supabase SQL Editor me ek baar RUN karo.
-- products.stock / in_stock pehle se hain — ye file sirf
-- atomic decrement + auto-sync jodti hai (existing data untouched).
-- ===================================================

-- 1. in_stock ko hamesha stock se sync rakho (admin manual edit bhi safe).
CREATE OR REPLACE FUNCTION public.sync_product_in_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.stock := COALESCE(NEW.stock, 0);
  NEW.in_stock := (NEW.stock > 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_in_stock ON public.products;
CREATE TRIGGER trg_sync_product_in_stock
BEFORE INSERT OR UPDATE OF stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_in_stock();

-- 2. Purana inconsistent data repair (stock NULL / in_stock mismatch).
UPDATE public.products
SET stock = COALESCE(stock, 50),
    in_stock = (COALESCE(stock, 50) > 0)
WHERE stock IS NULL OR in_stock IS DISTINCT FROM (COALESCE(stock, 0) > 0);

-- 3. Atomic decrement — concurrent orders me stock kabhi negative nahi.
-- Single UPDATE ... WHERE stock >= qty hai, isliye do orders ek saath
-- aayein to sirf ek jeetega, doosra success=false paayega.
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
  SET stock = stock - p_qty
  WHERE id = p_product_id
    AND COALESCE(stock, 0) >= p_qty
  RETURNING stock INTO v_remaining;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_remaining;
  ELSE
    -- Insufficient ya product missing — current stock batao (NULL = missing).
    RETURN QUERY SELECT FALSE, (SELECT stock FROM public.products WHERE id = p_product_id);
  END IF;
END;
$$;

-- 4. Rollback/restore — order fail hone par reserved qty wapas.
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
  SET stock = COALESCE(stock, 0) + p_qty
  WHERE id = p_product_id
  RETURNING stock INTO v_remaining;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_remaining;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::INTEGER;
  END IF;
END;
$$;

-- 5. Client/server dono se callable rakho (RLS bypass sirf in 2 RPCs me).
GRANT EXECUTE ON FUNCTION public.decrement_product_stock(BIGINT, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_product_stock(BIGINT, INTEGER) TO anon, authenticated, service_role;
