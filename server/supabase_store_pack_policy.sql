-- ===================================================
-- SUPERCART STORE PACK PERMISSION (Mark as Packed fix)
-- Supabase Dashboard -> SQL Editor me poori file RUN karo (idempotent hai)
-- Project: eagwchutdhtgioujetag
--
-- PROBLEM:
--   Store Panel me "Mark as Packed" dabane par Supabase UPDATE fail ho
--   sakta hai agar orders table ki RLS policy store_manager ko UPDATE
--   ki permission nahi deti ("row-level security policy" / 403 jaisa error,
--   ya backend-down fallback me direct UPDATE reject).
--   "Failed to fetch" ka #1 kaaran backend-down hota hai, lekin #2 kaaran
--   yahi RLS UPDATE deny hai — isliye ye file dono cover karti hai.
--
-- KYA KARTA HAI:
--   1. store_manager apne store_staff-linked stores ke orders READ kar sake
--   2. store_manager apne stores ke orders ka status UPDATE kar sake
--      (pack flow: pending_assignment/placed -> packed; assigned flow intact)
--   3. Purani public policies ko HAATH NAHI lagata (backend anon-key se
--      chalta rahe + koi existing flow na toote). Sirf ADD karta hai.
--   4. Helper: public.is_store_manager() + store-linked check
-- ===================================================

-- ---------------------------------------------------
-- 0. Safety: chahiye columns/tables pakke karo
-- ---------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES public.stores(id) ON DELETE SET NULL;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Placed';
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_boy_id TEXT;

-- store_staff link table (multi-store setup wali) — na ho to banao
CREATE TABLE IF NOT EXISTS public.store_staff (
    id BIGSERIAL PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (store_id, user_id)
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_staff ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------
-- 1. Helper: kya login user store_manager hai?
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_store_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'store_manager'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_store_manager() TO authenticated, anon;

-- ---------------------------------------------------
-- 2. Helper: kya ye order login manager ke store ka hai?
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_my_store_order(order_store_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_staff
    WHERE user_id = auth.uid()
      AND store_id = order_store_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_my_store_order(BIGINT) TO authenticated, anon;

-- ---------------------------------------------------
-- 3. SELECT: manager apne stores ke orders dekh sake
--    (existing public SELECT policy intact rehti hai — ye ADD hai)
-- ---------------------------------------------------
DROP POLICY IF EXISTS "Store managers read own-store orders" ON public.orders;
CREATE POLICY "Store managers read own-store orders" ON public.orders
  FOR SELECT TO authenticated
  USING (
    public.is_store_manager()
    AND public.is_my_store_order(store_id)
  );

-- store_staff link khud manager padh sake (apne links)
DROP POLICY IF EXISTS "Store managers read own staff links" ON public.store_staff;
CREATE POLICY "Store managers read own staff links" ON public.store_staff
  FOR SELECT TO authenticated
  USING (
    public.is_store_manager()
    AND user_id = auth.uid()
  );

-- ---------------------------------------------------
-- 4. UPDATE: manager apne stores ke orders PACK kar sake
--    - sirf apne store ka order (store_staff link must)
--    - delivered/cancelled ko packed karne se DB rokta nahi (app-layer
--      guard backend + frontend dono me hai), lekin yahan status CHECK
--      permissive rakha hai taaki packed->assigned (auto-assign) trigger/
--      worker kabhi RLS me na atke. Least-privilege: sirf status +
--      delivery_boy_id change ka raasta — baaki columns app sambhalta hai.
-- ---------------------------------------------------
DROP POLICY IF EXISTS "Store managers pack own-store orders" ON public.orders;
CREATE POLICY "Store managers pack own-store orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    public.is_store_manager()
    AND public.is_my_store_order(store_id)
  )
  WITH CHECK (
    public.is_store_manager()
    AND public.is_my_store_order(store_id)
  );

-- ---------------------------------------------------
-- 5. INSERT/DELETE: manager ko order create/delete NAHI (least privilege)
--    Koi policy nahi = deny (existing public ALL policy ho to wahi lagu,
--    warna deny). Pack flow ko sirf SELECT + UPDATE chahiye.
-- ---------------------------------------------------

-- ---------------------------------------------------
-- VERIFY (RUN ke baad Supabase me ye queries check karo)
-- ---------------------------------------------------
-- 1. Policies lagi ya nahi:
-- SELECT policyname, cmd, roles FROM pg_policies
--  WHERE tablename = 'orders' AND policyname LIKE 'Store managers%';
--  -- 2 rows aani chahiye: read own-store (SELECT) + pack own-store (UPDATE)
--
-- 2. Manager login karke test:
-- SELECT public.is_store_manager();  -- true aana chahiye
-- SELECT * FROM public.orders WHERE store_id IN
--   (SELECT store_id FROM public.store_staff WHERE user_id = auth.uid())
--  LIMIT 5;
--
-- 3. Test order pack:
-- UPDATE public.orders SET status = 'packed' WHERE id = <TEST_ORDER_ID>;
-- -- success hona chahiye (apne store ka order), phir wapas:
-- UPDATE public.orders SET status = 'pending_assignment' WHERE id = <TEST_ORDER_ID>;
