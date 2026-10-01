-- ===================================================
-- SUPERCART DELIVERY PARTNER HOME STORE (auto-assign)
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Ye script idempotent hai (dobara RUN karne par error nahi dega)
--
-- Adds:
--  1. delivery_profiles.home_store_id (BIGINT, nullable, FK -> stores.id)
--     Signup/Profile Setup me partner ki pinned location se sabse nazdeek
--     store automatically yahan save hota hai (15km ke andar).
--     NULL = abhi tak assign nahi hua.
--     Store delete ho to SET NULL (partner row + history safe).
-- ===================================================

ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS home_store_id BIGINT REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_profiles_home_store_id
    ON public.delivery_profiles (home_store_id);

-- RLS: naya column purani row-level policies me hi covered hai
-- (partner apni row update kar sakta hai, Admin sab update kar sakta hai) —
-- alag policy ki zaroorat nahi.

-- ---------------------------------------------------
-- VERIFY (RUN ke baad Supabase me ye queries check karo)
-- ---------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'delivery_profiles' AND column_name = 'home_store_id';
-- SELECT dp.name, dp.home_store_id, s.store_name AS home_store
-- FROM public.delivery_profiles dp
-- LEFT JOIN public.stores s ON s.id = dp.home_store_id
-- LIMIT 20;
