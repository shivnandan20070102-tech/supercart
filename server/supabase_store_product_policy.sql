-- ===================================================
-- SUPERCART STORE-SCOPED PRODUCT WRITES (RLS enforcement)
-- Supabase SQL Editor me ek baar RUN karo.
--
-- Rule: Store Manager sirf APNE store(s) ke products Add/Edit/Delete kar
-- sakta hai (store_staff link se). Doosre store ke ya global (store_id NULL)
-- products par uska write BLOCK hota hai — database level par, sirf UI par
-- nahi (UI to bypass ho sakta hai, RLS nahi).
--
-- - SELECT (read) pehle jaisa public rehta hai — customer app, store panel,
--   admin sab padhte rahenge, kuch nahi tootega.
-- - Admin (users.role = 'admin' ya auth metadata) full write rakhta hai.
-- - Backend SERVICE_ROLE key RLS bypass karti hai (server kaam karta rahega).
-- - Manager INSERT sirf apne store_id par (global product bana nahi sakta).
-- - Manager UPDATE: purani row apne store ki HO + nayi row bhi apne store ki
--   HO (doosre store me move / global banana BLOCK).
-- - Manager DELETE: sirf apne store ki row.
-- - Stock RPCs (decrement/increment) SECURITY DEFINER hain — unaffected.
-- Idempotent hai — dobara RUN karna safe hai.
-- ===================================================

-- Helper: caller admin hai? (store_settings wali established pattern)
CREATE OR REPLACE FUNCTION public.is_product_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
$$;

-- Helper: caller is store_id ka linked manager hai? (store_staff link)
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

-- 1. Blanket public write policy hatao (yehi hole tha — koi bhi anon client
-- se kisi bhi product ko insert/update/delete kar sakta tha).
DROP POLICY IF EXISTS "Allow public insert on products" ON public.products;

-- 2. Admin full write (authenticated + admin).
DROP POLICY IF EXISTS "Admin full write on products" ON public.products;
CREATE POLICY "Admin full write on products" ON public.products
  FOR ALL TO authenticated
  USING (public.is_product_admin())
  WITH CHECK (public.is_product_admin());

-- 3. Manager scoped writes (authenticated + store_staff link).
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

-- 4. Public read pehle jaisa (customer/store/admin sab padhte rahenge).
-- (Policy "Allow public read on products" pehle se hai — yahan sirf ensure.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products'
      AND policyname = 'Allow public read on products'
  ) THEN
    CREATE POLICY "Allow public read on products" ON public.products
      FOR SELECT USING (true);
  END IF;
END;
$$;

-- ===================================================
-- VERIFY (SQL Editor me chalakar dekho):
-- 1. Policies dikho:
--    SELECT policyname, roles, cmd FROM pg_policies
--    WHERE tablename = 'products' ORDER BY policyname;
-- 2. Manager isolation ka live test: pehle ek manager se login karke uske
--    JWT ke saath doosre store ke product par UPDATE try karo → RLS deny
--    ("new row violates row-level security policy") aana chahiye, jabki
--    apne store ka UPDATE success hona chahiye.
-- ===================================================
