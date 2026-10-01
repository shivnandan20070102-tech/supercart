-- ===================================================
-- SUPERCART MULTI-STORE SYSTEM SETUP
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Ye script idempotent hai (dobara RUN karne par error nahi dega)
--
-- Includes:
--  1. stores table (store_name, address, latitude, longitude,
--     is_active, contact_number, created_at)
--  2. users.role me 'store_manager' allowed (customer, admin, delivery, store_manager)
--  3. store_staff table (store_id <-> user_id link)
--  4. products.store_id column
--  5. orders.store_id column
--  6. calculate_distance_km() Haversine function (km me)
-- ===================================================

-- ---------------------------------------------------
-- 1. STORES TABLE
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores (
    id BIGSERIAL PRIMARY KEY,
    store_name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    contact_number TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Helpful indexes: active-store filter + coordinate lookups
CREATE INDEX IF NOT EXISTS idx_stores_is_active ON public.stores (is_active);
CREATE INDEX IF NOT EXISTS idx_stores_lat_lon ON public.stores (latitude, longitude);

-- RLS + policies (baaki tables jaisi hi public-access policy,
-- taaki anon-key backend bina tode kaam karta rahe)
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on stores" ON public.stores;
CREATE POLICY "Allow public read on stores" ON public.stores FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public access on stores" ON public.stores;
CREATE POLICY "Allow public access on stores" ON public.stores FOR ALL USING (true);

-- Realtime (admin dashboard / client live updates ke liye)
ALTER TABLE public.stores REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'stores'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.stores;
    END IF;
END $$;

-- ---------------------------------------------------
-- 2. USERS ROLE: store_manager ADD KARO
-- Allowed roles: customer, admin, delivery, store_manager
-- ---------------------------------------------------

-- Pehle NULL roles fix karo
UPDATE public.users SET role = 'customer' WHERE role IS NULL;

-- Purana 'delivery_partner' value (agar kahin ho) ko 'delivery' me normalize karo
-- taaki naya CHECK constraint purane data par fail na ho
UPDATE public.users SET role = 'delivery' WHERE role = 'delivery_partner';

-- Purana constraint (agar koi ho) hatao, naya lagao
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('customer', 'admin', 'delivery', 'store_manager'));
    END IF;
END $$;

-- NOTE: naya store_manager signup trigger me auto-handle ho jayega,
-- kyunki handle_new_auth_user() raw_user_meta_data se role copy karta hai.
-- Phir bhi trigger ko explicit safe list par update kar dete hain:
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    account_role TEXT := COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer');
    account_name TEXT := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
    account_phone TEXT := COALESCE(NEW.raw_user_meta_data ->> 'phone', '');
BEGIN
    -- Unknown role aaye to customer bana do (constraint violation se bachne ke liye)
    IF account_role NOT IN ('customer', 'admin', 'delivery', 'store_manager') THEN
        account_role := 'customer';
    END IF;

    INSERT INTO public.users (id, name, email, phone, role)
    VALUES (NEW.id, account_name, NEW.email, account_phone, account_role)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, role = EXCLUDED.role;

    IF account_role = 'delivery' THEN
        INSERT INTO public.delivery_profiles (user_id, name, email, phone)
        VALUES (NEW.id, account_name, NEW.email, account_phone)
        ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------
-- 3. STORE_STAFF TABLE (kaunsa staff kis store ka hai)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_staff (
    id BIGSERIAL PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (store_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_store_staff_store_id ON public.store_staff (store_id);
CREATE INDEX IF NOT EXISTS idx_store_staff_user_id ON public.store_staff (user_id);

ALTER TABLE public.store_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on store_staff" ON public.store_staff;
CREATE POLICY "Allow public access on store_staff" ON public.store_staff FOR ALL USING (true);

ALTER TABLE public.store_staff REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'store_staff'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.store_staff;
    END IF;
END $$;

-- ---------------------------------------------------
-- 4. PRODUCTS.STORE_ID (product kis store me available hai)
-- ---------------------------------------------------
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_store_id ON public.products (store_id);

-- ---------------------------------------------------
-- 5. ORDERS.STORE_ID (order kis store ko assign hua)
-- ---------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_store_id ON public.orders (store_id);

-- ---------------------------------------------------
-- 6. HAVERSINE DISTANCE FUNCTION (kilometers me)
-- Usage:
--   SELECT public.calculate_distance_km(28.6139, 77.2090, 28.5355, 77.3910);
--   -- customer_lat, customer_lon, store_lat, store_lon
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_distance_km(
    lat1 DOUBLE PRECISION,
    lon1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION,
    lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    earth_radius_km CONSTANT DOUBLE PRECISION := 6371.0;
    dlat DOUBLE PRECISION;
    dlon DOUBLE PRECISION;
    a DOUBLE PRECISION;
    c DOUBLE PRECISION;
BEGIN
    -- NULL input par NULL return (order assign query me row skip ho jayegi)
    IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
        RETURN NULL;
    END IF;

    dlat := radians(lat2 - lat1);
    dlon := radians(lon2 - lon1);

    -- Haversine formula
    a := sin(dlat / 2.0) * sin(dlat / 2.0)
       + cos(radians(lat1)) * cos(radians(lat2))
       * sin(dlon / 2.0) * sin(dlon / 2.0);

    c := 2.0 * asin(sqrt(a));

    RETURN earth_radius_km * c;
END;
$$;

-- ---------------------------------------------------
-- BONUS: Nearest active store dhundne wala helper
-- Usage:
--   SELECT * FROM public.get_nearest_active_stores(28.6139, 77.2090, 5);
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_nearest_active_stores(
    customer_lat DOUBLE PRECISION,
    customer_lon DOUBLE PRECISION,
    limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
    id BIGINT,
    store_name TEXT,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    contact_number TEXT,
    distance_km DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        s.id,
        s.store_name,
        s.address,
        s.latitude,
        s.longitude,
        s.contact_number,
        public.calculate_distance_km(customer_lat, customer_lon, s.latitude, s.longitude) AS distance_km
    FROM public.stores s
    WHERE s.is_active = true
    ORDER BY distance_km ASC
    LIMIT limit_count;
$$;

-- ---------------------------------------------------
-- SAMPLE DATA (optional — sirf table khaali ho tabhi insert hoga)
-- Test ke liye 2 active stores. Chaho to Supabase me edit/delete kar dena.
-- ---------------------------------------------------
INSERT INTO public.stores (store_name, address, latitude, longitude, is_active, contact_number)
SELECT 'SuperCart Connaught Place', 'G-7, Inner Circle, Connaught Place, New Delhi 110001', 28.6315, 77.2167, true, '+91-9811000001'
WHERE NOT EXISTS (SELECT 1 FROM public.stores);

INSERT INTO public.stores (store_name, address, latitude, longitude, is_active, contact_number)
SELECT 'SuperCart Andheri West', 'Shop 12, Link Road, Andheri West, Mumbai 400053', 19.1363, 72.8272, true, '+91-9822000002'
WHERE (SELECT COUNT(*) FROM public.stores) < 2;

-- ---------------------------------------------------
-- VERIFY (RUN ke baad Supabase me ye queries check karo)
-- ---------------------------------------------------
-- SELECT * FROM public.stores;
-- SELECT conname FROM pg_constraint WHERE conname = 'users_role_check';
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name IN ('products','orders') AND column_name = 'store_id';
-- SELECT public.calculate_distance_km(28.6139, 77.2090, 28.6315, 77.2167); -- ~2 km aana chahiye
-- SELECT * FROM public.get_nearest_active_stores(28.6139, 77.2090, 5);
