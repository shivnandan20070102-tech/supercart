-- ===================================================
-- SUPERCART ORDERS: DELIVERY_INSTRUCTIONS + TIP_AMOUNT
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- 1. delivery_instructions TEXT[] — e.g. ['leave_at_door','dont_ring_bell']
-- 2. tip_amount NUMERIC (default 0) — delivery partner tip
-- ===================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_instructions TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS tip_amount NUMERIC NOT NULL DEFAULT 0;

-- Safety: negative tip kabhi store na ho
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_tip_amount_non_negative'
    ) THEN
        ALTER TABLE public.orders
            ADD CONSTRAINT orders_tip_amount_non_negative CHECK (tip_amount >= 0);
    END IF;
END $$;
