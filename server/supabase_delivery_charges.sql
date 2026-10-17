-- ===================================================
-- SUPERCART — DISTANCE-BASED DELIVERY CHARGES
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN".
-- Idempotent: safe to run multiple times.
--
-- Pricing rule (server + client dono yahi lagate hain):
--   Delivery Charge = Distance (KM) x ₹10  (nearest rupee, e.g. 2.3 KM -> ₹23)
--   Minimum ₹10  |  ₹399+ order par FREE  |  5 KM se door = service unavailable
-- ===================================================

-- ---------------------------------------------------
-- ORDERS table: verified distance save karo (delivery_fee me
-- calculated charge pehle se jaata hai — Order History/Invoice wahi dikhate hain)
-- ---------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_distance_km NUMERIC DEFAULT 0;

COMMENT ON COLUMN public.orders.delivery_distance_km IS
  'Verified delivery distance in KM from assigned store to delivery address (server-calculated, max 5 KM)';

-- ---------------------------------------------------
-- VERIFY
-- ---------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'delivery_distance_km';
-- SELECT id, delivery_fee, delivery_distance_km, total_price FROM public.orders
--   ORDER BY id DESC LIMIT 10;
