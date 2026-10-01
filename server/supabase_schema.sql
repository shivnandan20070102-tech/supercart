-- ===================================================
-- SUPERCART GROCERY DATABASE SCHEMA & SEED DATA
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- ===================================================

-- 1. Create PRODUCTS Table
CREATE TABLE IF NOT EXISTS public.products (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price NUMERIC NOT NULL,
    original_price NUMERIC NOT NULL,
    unit TEXT NOT NULL,
    category TEXT NOT NULL,
    image TEXT NOT NULL,
    stock INTEGER DEFAULT 50,
    in_stock BOOLEAN DEFAULT true,
    badge TEXT DEFAULT '',
    rating NUMERIC DEFAULT 4.5,
    reviews_count INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create USERS Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '',
    location TEXT DEFAULT '',
    role TEXT DEFAULT 'customer',
    address JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Existing databases: add the role column without recreating the users table.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';

-- Delivery partner profiles are linked one-to-one with Supabase Auth users.
CREATE TABLE IF NOT EXISTS public.delivery_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    profile_photo_url TEXT,
    aadhar_card_url TEXT,
    driving_license_url TEXT,
    pan_card_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS aadhar_card_url TEXT;
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS driving_license_url TEXT;
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS pan_card_url TEXT;
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS bike_image_url TEXT;
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.delivery_profiles ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE public.delivery_profiles
SET approval_status = 'pending'
WHERE approval_status IS NULL
   OR approval_status NOT IN ('pending', 'approved', 'rejected');

ALTER TABLE public.delivery_profiles
    DROP CONSTRAINT IF EXISTS delivery_profiles_approval_status_check;
ALTER TABLE public.delivery_profiles
    ADD CONSTRAINT delivery_profiles_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.delivery_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Delivery partners can read own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can read own profile" ON public.delivery_profiles
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read delivery profiles" ON public.delivery_profiles;
CREATE POLICY "Admins can read delivery profiles" ON public.delivery_profiles
    FOR SELECT TO authenticated
    USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Delivery partners can insert own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can insert own profile" ON public.delivery_profiles
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Delivery partners can update own profile" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can update own profile" ON public.delivery_profiles
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can update delivery profile approval" ON public.delivery_profiles;
CREATE POLICY "Admins can update delivery profile approval" ON public.delivery_profiles
    FOR UPDATE TO authenticated
    USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-documents', 'delivery-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Delivery partners can upload documents" ON storage.objects;
CREATE POLICY "Delivery partners can upload documents" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'delivery-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Delivery partners can update documents" ON storage.objects;
CREATE POLICY "Delivery partners can update documents" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'delivery-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'delivery-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Delivery partners can delete documents" ON storage.objects;
CREATE POLICY "Delivery partners can delete documents" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'delivery-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

ALTER TABLE public.delivery_profiles REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'delivery_profiles'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_profiles;
    END IF;
END $$;

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
    INSERT INTO public.users (id, name, email, phone, role)
    VALUES (NEW.id, account_name, NEW.email, account_phone, account_role)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, role = EXCLUDED.role;

    IF account_role IN ('delivery', 'delivery_partner') THEN
        INSERT INTO public.delivery_profiles (user_id, name, email, phone)
        VALUES (NEW.id, account_name, NEW.email, account_phone)
        ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_supercart ON auth.users;
CREATE TRIGGER on_auth_user_created_supercart
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

UPDATE public.users
SET role = 'customer'
WHERE role IS NULL;

-- 3. Create ORDERS Table
CREATE TABLE IF NOT EXISTS public.orders (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id),
    order_items JSONB NOT NULL,
    shipping_address JSONB NOT NULL,
    payment_method TEXT DEFAULT 'Cash On Delivery',
    items_price NUMERIC DEFAULT 0,
    delivery_fee NUMERIC DEFAULT 0,
    coupon_discount NUMERIC DEFAULT 0,
    coupon_code TEXT,
    delivery_instructions TEXT[] NOT NULL DEFAULT '{}',
    tip_amount NUMERIC NOT NULL DEFAULT 0,
    total_price NUMERIC NOT NULL,
    status TEXT DEFAULT 'Placed',
    delivery_boy_id TEXT,
    rejected_by JSONB NOT NULL DEFAULT '[]'::jsonb,
    estimated_delivery_time TEXT DEFAULT '10-15 mins',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_boy_id TEXT;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS rejected_by JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_instructions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS tip_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.orders REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
END $$;

-- 4. Store availability controlled from the admin dashboard
CREATE TABLE IF NOT EXISTS public.store_settings (
    id BIGSERIAL PRIMARY KEY,
    is_online BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.store_settings (is_online)
SELECT true
WHERE NOT EXISTS (SELECT 1 FROM public.store_settings);

-- 4. Enable Row Level Security (RLS) & Public Policies
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- Allow public read access to products
DROP POLICY IF EXISTS "Allow public read on products" ON public.products;
CREATE POLICY "Allow public read on products" ON public.products FOR SELECT USING (true);

-- Allow public insert on products (for initial seeding/admin)
DROP POLICY IF EXISTS "Allow public insert on products" ON public.products;
CREATE POLICY "Allow public insert on products" ON public.products FOR ALL USING (true);

-- Allow public access for users (login/signup)
DROP POLICY IF EXISTS "Allow public access on users" ON public.users;
CREATE POLICY "Allow public access on users" ON public.users FOR ALL USING (true);

-- Allow public access for orders
DROP POLICY IF EXISTS "Allow public access on orders" ON public.orders;
CREATE POLICY "Allow public access on orders" ON public.orders FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read on store settings" ON public.store_settings;
CREATE POLICY "Allow public read on store settings" ON public.store_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated update on store settings" ON public.store_settings;
CREATE POLICY "Allow authenticated update on store settings" ON public.store_settings FOR UPDATE TO authenticated
    USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Allow authenticated insert on store settings" ON public.store_settings;
CREATE POLICY "Allow authenticated insert on store settings" ON public.store_settings FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

ALTER TABLE public.store_settings REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'store_settings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.store_settings;
    END IF;
END $$;

-- 5. Insert Initial Fresh Grocery Seed Products
INSERT INTO public.products (name, description, price, original_price, unit, category, image, stock, in_stock, badge, rating, reviews_count, is_featured)
VALUES
('Fresh Organic Yellow Bananas', 'Directly sourced naturally ripened organic yellow bananas, rich in potassium.', 60, 75, '1 dozen (12 pcs)', 'Fruits & Vegetables', 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=600&auto=format&fit=crop&q=80', 50, true, 'Fresh Farm', 4.8, 142, true),
('Farm Fresh Whole Milk', 'Pasteurized, homogenized pure cow milk rich in essential vitamins and calcium.', 34, 38, '1 Litre Pouch', 'Dairy & Eggs', 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&auto=format&fit=crop&q=80', 80, true, 'Best Seller', 4.9, 230, true),
('Farm Fresh Red Vine Tomatoes', 'Juicy, plump red tomatoes perfect for curries, salads, and fresh salsa.', 40, 55, '1 kg', 'Fruits & Vegetables', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&auto=format&fit=crop&q=80', 60, true, '15% OFF', 4.6, 98, true),
('100% Whole Wheat Brown Bread', 'Freshly baked daily with 100% whole grain wheat flour and zero maida.', 45, 50, '400 g Pack', 'Bakery & Bread', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop&q=80', 35, true, 'Healthy Choice', 4.7, 76, false),
('Premium Aged Royal Basmati Rice', 'Extra long grain aged basmati rice known for its exquisite aroma and fluffy texture.', 165, 195, '1 kg Pack', 'Atta, Rice & Dal', 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format&fit=crop&q=80', 45, true, 'Premium', 4.9, 310, true),
('Cold-Pressed Pure Mustard Oil', 'Traditional wood cold-pressed mustard oil with full natural aroma and health benefits.', 195, 220, '1 Litre Bottle', 'Oils & Masalas', 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&auto=format&fit=crop&q=80', 30, true, 'Pure & Raw', 4.8, 88, false),
('Organic Hass Avocados', 'Creamy and buttery ripe Hass avocados loaded with healthy monounsaturated fats.', 140, 180, '2 pcs (approx. 350g)', 'Fruits & Vegetables', 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&auto=format&fit=crop&q=80', 25, true, 'Superfood', 4.7, 64, false),
('Classic Potato Chips - Salted', 'Golden fried crispy potato chips sprinkled with light rock salt.', 30, 35, '115 g Pack', 'Snacks & Beverages', 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=600&auto=format&fit=crop&q=80', 100, true, 'Crunchy', 4.5, 180, false),
('Fresh Farm Brown Eggs', 'Farm-fresh, antibiotic-free brown eggs packed with high-quality protein.', 85, 95, 'Pack of 6', 'Dairy & Eggs', 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=600&auto=format&fit=crop&q=80', 40, true, 'High Protein', 4.9, 154, true),
('Organic Green Kiwi Fruits', 'Sweet and tangy fresh green kiwis loaded with immunity-boosting Vitamin C.', 110, 130, '3 pcs pack', 'Fruits & Vegetables', 'https://images.unsplash.com/photo-1518492104633-130d0cc84637?w=600&auto=format&fit=crop&q=80', 20, true, 'Vitamin C Rich', 4.6, 42, false),
('Premium Roasted Arabica Coffee', 'Single-origin medium-dark roasted coffee beans with rich chocolate and caramel notes.', 350, 420, '250 g Pouch', 'Snacks & Beverages', 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=600&auto=format&fit=crop&q=80', 30, true, 'Artisan', 4.9, 95, true),
('Organic Turmeric Powder (Haldi)', 'Pure organic ground turmeric with high natural curcumin content and no additives.', 75, 90, '200 g Jar', 'Oils & Masalas', 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=600&auto=format&fit=crop&q=80', 50, true, 'High Curcumin', 4.8, 112, false)
ON CONFLICT DO NOTHING;
