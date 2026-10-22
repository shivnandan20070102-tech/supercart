-- SUPERCART SECURITY HARDENING
-- Run once in Supabase SQL Editor, then verify with the checks at the bottom.
-- This removes the public users policy and prevents role escalation.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users read rider locations" ON public.users;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Admins manage users" ON public.users;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

CREATE POLICY "Users can read own profile"
ON public.users
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
ON public.users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND role = public.current_user_role()
);

CREATE POLICY "Admins manage users"
ON public.users
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Public catalog/store discovery remains readable, but all writes are admin-only.
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on stores" ON public.stores;
DROP POLICY IF EXISTS "Allow public access on stores" ON public.stores;
DROP POLICY IF EXISTS "Admin full access on stores" ON public.stores;
CREATE POLICY "Allow public read on stores" ON public.stores
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin full access on stores" ON public.stores
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

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

ALTER TABLE public.store_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access on store_staff" ON public.store_staff;
DROP POLICY IF EXISTS "Admin full access on store_staff" ON public.store_staff;
DROP POLICY IF EXISTS "Store managers read own links" ON public.store_staff;
CREATE POLICY "Admin full access on store_staff" ON public.store_staff
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Store managers read own links" ON public.store_staff
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on coupons" ON public.coupons;
DROP POLICY IF EXISTS "Allow public write on coupons" ON public.coupons;
DROP POLICY IF EXISTS "Admin full access on coupons" ON public.coupons;
CREATE POLICY "Allow public read on coupons" ON public.coupons
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin full access on coupons" ON public.coupons
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Products remain publicly readable; the old public FOR ALL policy is removed.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public insert on products" ON public.products;
DROP POLICY IF EXISTS "Admin full write on products" ON public.products;
DROP POLICY IF EXISTS "Store managers insert own-store products" ON public.products;
DROP POLICY IF EXISTS "Store managers update own-store products" ON public.products;
DROP POLICY IF EXISTS "Store managers delete own-store products" ON public.products;
CREATE POLICY "Admin full write on products" ON public.products
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Store managers insert own-store products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_store_manager_of(store_id));
CREATE POLICY "Store managers update own-store products" ON public.products
  FOR UPDATE TO authenticated
  USING (public.is_store_manager_of(store_id))
  WITH CHECK (public.is_store_manager_of(store_id));
CREATE POLICY "Store managers delete own-store products" ON public.products
  FOR DELETE TO authenticated
  USING (public.is_store_manager_of(store_id));

-- Orders are never public. Keep direct customer creation/read and scoped
-- delivery/store/admin access; the service-role backend remains unaffected.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access on orders" ON public.orders;
DROP POLICY IF EXISTS "Customers read own orders" ON public.orders;
DROP POLICY IF EXISTS "Customers create own orders" ON public.orders;
DROP POLICY IF EXISTS "Delivery partners read assigned orders" ON public.orders;
DROP POLICY IF EXISTS "Delivery partners update assigned orders" ON public.orders;
DROP POLICY IF EXISTS "Admins read all orders" ON public.orders;
DROP POLICY IF EXISTS "Admins manage all orders" ON public.orders;
DROP POLICY IF EXISTS "Store managers read own-store orders" ON public.orders;
DROP POLICY IF EXISTS "Store managers update own-store orders" ON public.orders;
CREATE POLICY "Customers read own orders" ON public.orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Customers create own orders" ON public.orders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Delivery partners read assigned orders" ON public.orders
  FOR SELECT TO authenticated USING (delivery_boy_id = auth.uid()::text);
CREATE POLICY "Delivery partners update assigned orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (delivery_boy_id = auth.uid()::text)
  WITH CHECK (delivery_boy_id = auth.uid()::text);
CREATE POLICY "Admins manage all orders" ON public.orders
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Store managers read own-store orders" ON public.orders
  FOR SELECT TO authenticated USING (public.is_store_manager_of(store_id));
CREATE POLICY "Store managers update own-store orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.is_store_manager_of(store_id))
  WITH CHECK (public.is_store_manager_of(store_id));

-- Remove public complaint evidence and use authenticated owner/admin access.
UPDATE storage.buckets SET public = false WHERE id = 'complaint-photos';
DROP POLICY IF EXISTS "Complaint photos public read" ON storage.objects;
DROP POLICY IF EXISTS "Complaint photos admin read" ON storage.objects;
CREATE POLICY "Complaint photos owner read" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'complaint-photos'
    AND (
      ((storage.foldername(name))[1] = 'complaints' AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );
CREATE POLICY "Complaint photos admin read" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'complaint-photos' AND public.is_admin()
  );

-- Stock mutation functions are SECURITY DEFINER and must not be callable by
-- unauthenticated clients.
DO $$
BEGIN
  IF to_regprocedure('public.decrement_product_stock(bigint,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.decrement_product_stock(BIGINT, INTEGER) FROM anon;
  END IF;
  IF to_regprocedure('public.increment_product_stock(bigint,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.increment_product_stock(BIGINT, INTEGER) FROM anon;
  END IF;
END $$;

-- Replace remaining admin policies that previously trusted editable
-- auth.user_metadata.role claims.
DROP POLICY IF EXISTS "Admins can read delivery profiles" ON public.delivery_profiles;
CREATE POLICY "Admins can read delivery profiles" ON public.delivery_profiles
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can update delivery profile approval" ON public.delivery_profiles;
CREATE POLICY "Admins can update delivery profile approval" ON public.delivery_profiles
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Allow authenticated update on store settings" ON public.store_settings;
CREATE POLICY "Allow authenticated update on store settings" ON public.store_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow authenticated insert on store settings" ON public.store_settings;
CREATE POLICY "Allow authenticated insert on store settings" ON public.store_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin complaints read" ON public.complaints;
CREATE POLICY "Admin complaints read" ON public.complaints
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin complaints update" ON public.complaints;
CREATE POLICY "Admin complaints update" ON public.complaints
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admin complaints delete" ON public.complaints;
CREATE POLICY "Admin complaints delete" ON public.complaints
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all delivery documents" ON storage.objects;
CREATE POLICY "Admins can view all delivery documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'delivery-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Complaint photos admin read" ON storage.objects;
CREATE POLICY "Complaint photos admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'complaint-photos' AND public.is_admin());

-- The order-flow migration stores internal trigger diagnostics here.
-- Keep the audit trail private and expose it only to trusted admins.
ALTER TABLE public.order_flow_fix_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read order flow audit" ON public.order_flow_fix_audit;
CREATE POLICY "Admins can read order flow audit" ON public.order_flow_fix_audit
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Verify there is no permissive users policy left:
-- SELECT policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'users';

-- Verify anonymous access returns no rows:
-- SET ROLE anon;
-- SELECT * FROM public.users;
-- RESET ROLE;
