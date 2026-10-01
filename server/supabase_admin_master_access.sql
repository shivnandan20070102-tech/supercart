-- ===================================================
-- SUPERCART ADMIN MASTER ACCESS (Owner = SABSE POWERFUL)
-- Supabase SQL Editor me poori file RUN karo (idempotent hai)
--
-- Kya karta hai:
--  1. public.is_admin() helper — login user Admin hai ya nahi
--     (auth metadata role=admin YA public.users.role=admin)
--  2. Admin ko SABHI tables par FULL READ (SELECT) policy:
--     stores, store_staff, orders, users, products, coupons,
--     delivery_profiles, store_settings
--     (Store Manager sirf apna data dekhe, Admin SAB kuch dekhe —
--      ye policy dusre roles ko restrict NAHI karti, sirf Admin
--      ka rasta GUARANTEE karti hai)
--  3. Master Overview realtime ke liye sab tables publication me
-- ===================================================

-- ---------------------------------------------------
-- 1. is_admin() helper (SECURITY DEFINER = RLS bypass karke check)
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  )
  OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') = 'admin';
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- ---------------------------------------------------
-- 2. ADMIN FULL READ policies (har table par, idempotent)
-- ---------------------------------------------------

-- STORES
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on stores" ON public.stores;
CREATE POLICY "Admin full read on stores" ON public.stores
  FOR SELECT TO authenticated USING (public.is_admin());

-- STORE_STAFF (kaun manager kis store se linked)
ALTER TABLE public.store_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on store_staff" ON public.store_staff;
CREATE POLICY "Admin full read on store_staff" ON public.store_staff
  FOR SELECT TO authenticated USING (public.is_admin());

-- ORDERS (sare stores ke past + present)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on orders" ON public.orders;
CREATE POLICY "Admin full read on orders" ON public.orders
  FOR SELECT TO authenticated USING (public.is_admin());

-- USERS (customers + managers + partners + admins, sab)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on users" ON public.users;
CREATE POLICY "Admin full read on users" ON public.users
  FOR SELECT TO authenticated USING (public.is_admin());

-- PRODUCTS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on products" ON public.products;
CREATE POLICY "Admin full read on products" ON public.products
  FOR SELECT TO authenticated USING (public.is_admin());

-- COUPONS
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on coupons" ON public.coupons;
CREATE POLICY "Admin full read on coupons" ON public.coupons
  FOR SELECT TO authenticated USING (public.is_admin());

-- DELIVERY_PROFILES (details + documents + approval)
-- NOTE: is policy ke bina Admin ko dusre partners ke documents
-- RLS rok sakta tha — ab Admin sab dekh sakta hai.
ALTER TABLE public.delivery_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on delivery profiles" ON public.delivery_profiles;
CREATE POLICY "Admin full read on delivery profiles" ON public.delivery_profiles
  FOR SELECT TO authenticated USING (public.is_admin());

-- STORE_SETTINGS (online/offline)
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full read on store settings" ON public.store_settings;
CREATE POLICY "Admin full read on store settings" ON public.store_settings
  FOR SELECT TO authenticated USING (public.is_admin());

-- ---------------------------------------------------
-- 3. REALTIME publication (Master Overview LIVE ke liye)
-- ---------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['stores','store_staff','orders','users','products','coupons','delivery_profiles','store_settings'])
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    EXCEPTION WHEN undefined_table THEN
      CONTINUE;
    END;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------
-- VERIFY (RUN ke baad ye queries check karo)
-- ---------------------------------------------------
-- 1. Helper bana ya nahi:
-- SELECT public.is_admin();  -- (admin login me true, warna false)
--
-- 2. Admin policies lagi ya nahi:
-- SELECT policyname, cmd, roles FROM pg_policies
--  WHERE schemaname='public' AND policyname LIKE 'Admin full read%';
--  -- 8 rows aani chahiye
--
-- 3. Realtime tables:
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname='supabase_realtime' AND schemaname='public'
--  ORDER BY tablename;
