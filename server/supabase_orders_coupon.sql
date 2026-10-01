-- ===================================================
-- SUPERCART ORDERS: COUPON_CODE COLUMN
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Project: eagwchutdhtgioujetag
-- Taki pata chale kaunsa order kis coupon se bana
-- ===================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS coupon_code TEXT;
