-- ===================================================
-- SUPERCART COUPONS TABLE
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Project: eagwchutdhtgioujetag
-- ===================================================

-- 1. Create COUPONS Table
CREATE TABLE IF NOT EXISTS public.coupons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    discount_type TEXT NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'flat')),
    discount_value NUMERIC NOT NULL,
    min_order_amount NUMERIC NOT NULL DEFAULT 0,
    expiry_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    usage_limit INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security + Public Policies
-- (Same pattern as products/orders so Admin Dashboard with anon key can CRUD,
-- and checkout can read active coupons)
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on coupons" ON public.coupons;
CREATE POLICY "Allow public read on coupons" ON public.coupons FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public write on coupons" ON public.coupons;
CREATE POLICY "Allow public write on coupons" ON public.coupons FOR ALL USING (true);

-- 3. Enable Realtime (so Admin Dashboard live-updates)
ALTER TABLE public.coupons REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'coupons'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.coupons;
    END IF;
END $$;

-- 4. Seed one starter coupon (optional)
INSERT INTO public.coupons (code, discount_type, discount_value, min_order_amount, expiry_date, is_active, usage_limit, used_count)
VALUES ('SAVE20', 'percentage', 20, 399, CURRENT_DATE + INTERVAL '90 days', true, 1000, 0)
ON CONFLICT (code) DO NOTHING;
