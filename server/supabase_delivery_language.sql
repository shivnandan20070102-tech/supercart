-- ===================================================
-- SUPERCART DELIVERY LANGUAGE PREFERENCE
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Project: eagwchutdhtgioujetag
--
-- Delivery partner ki bhasha (English / Hindi) Supabase me save hogi
-- taaki har device / har login par same language mile.
-- Dashboard localStorage ko backup ki tarah use karta hai.
-- ===================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

-- ===================================================
-- VERIFY (optional, RUN ke baad alag se chalao):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('users', 'delivery_profiles')
--   AND column_name = 'preferred_language';
-- ===================================================
