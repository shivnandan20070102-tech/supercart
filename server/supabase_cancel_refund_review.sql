-- =====================================================================
-- SuperCart — Cancel / Return-Refund / Delivery-Partner Review system
-- File: server/supabase_cancel_refund_review.sql
-- Safe, idempotent, BEGIN/COMMIT wrapped. NO DELETE / NO DROP TABLE.
-- Only additive changes: new columns, status term additions, new table,
-- new policies, and a single-list edit to the PACK-FIRST gate.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. orders — new cancellation / refund columns
-- =====================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS cancelled_by    TEXT,
    ADD COLUMN IF NOT EXISTS cancel_reason   TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_reason   TEXT,
    ADD COLUMN IF NOT EXISTS refund_status   TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS refund_amount   NUMERIC NOT NULL DEFAULT 0;

-- refund_status domain guard (none|pending|approved|refunded)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_refund_status_check'
          AND conrelid = 'public.orders'::regclass
    ) THEN
        ALTER TABLE public.orders
            ADD CONSTRAINT orders_refund_status_check
            CHECK (refund_status IN ('none', 'pending', 'approved', 'refunded'));
    END IF;
END $$;

-- =====================================================================
-- 2. PACK-FIRST gate — allow 'return_refund' alongside cancelled/canceled/failed
--    (the ONLY functional change to this function; every other guard kept)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_pack_first_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_status TEXT;
BEGIN
    -- UPDATE par OLD status dekho, INSERT par NEW ka hi status (naya order).
    IF TG_OP = 'INSERT' THEN
        v_old_status := LOWER(COALESCE(NEW.status, ''));
    ELSE
        v_old_status := LOWER(COALESCE(OLD.status, ''));
    END IF;

    -- Store-queue = pack se pehle ke saare status (unpacked).
    IF v_old_status IN ('placed', 'pending', 'pending_assignment', 'processing', 'confirmed', 'created', '') THEN
        IF NEW.delivery_boy_id IS NOT NULL AND NEW.delivery_boy_id <> '' THEN
            -- VIOLATION: pack se pehle assign (rogue trigger/worker/direct).
            -- Chup-chaap revert: boy NULL + wapas store queue.
            NEW.delivery_boy_id := NULL;
            NEW.status := 'pending_assignment';
        ELSIF LOWER(COALESCE(NEW.status, '')) IN ('placed', 'pending', 'processing', 'confirmed', 'created', '') THEN
            -- Unassigned unpacked variant -> canonical store-queue status.
            NEW.status := 'pending_assignment';
        ELSIF LOWER(COALESCE(NEW.status, '')) NOT IN ('pending_assignment', 'packed', 'cancelled', 'canceled', 'failed', 'return_refund') THEN
            -- VIOLATION: store-queue se seedha assigned/accepted/... jaana
            -- (bina pack ke delivery state) — revert to store queue.
            NEW.status := 'pending_assignment';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_pack_first_gate() IS
'PACK-FIRST hard guard: store-queue order ko pack se pehle koi delivery_boy_id ya aage ka status nahi mil sakta (BEFORE INSERT OR UPDATE par revert). return_refund terminal state (cancelled/canceled/failed ke saath) allowed.';

-- =====================================================================
-- 3. order_reviews table
--    - delivery partner can review their OWN delivered order exactly once
--    - admin can read all (via is_admin())
--    - customer has NO policy => cannot read reviews about them
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.order_reviews (
    id          BIGSERIAL PRIMARY KEY,
    order_id    BIGINT NOT NULL UNIQUE REFERENCES public.orders(id),
    reviewer_id UUID NOT NULL REFERENCES auth.users(id),
    customer_id UUID REFERENCES auth.users(id),
    rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    tags        TEXT[] NOT NULL DEFAULT '{}',
    comment     TEXT CHECK (char_length(comment) <= 500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on
ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;

-- Indexes for common read paths (admin list, per-order lookups)
CREATE INDEX IF NOT EXISTS idx_order_reviews_order_id   ON public.order_reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_order_reviews_customer_id ON public.order_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_reviews_created_at  ON public.order_reviews(created_at);

-- Policy 1: delivery partner inserts their own review for their own DELIVERED
-- order. Enforcement of "delivered + assigned to reviewer + exactly once"
-- happens in the application layer (service-role) AND via a DB trigger here
-- (so direct RLS-path inserts are equally guarded).
DROP POLICY IF EXISTS order_reviews_insert_own_delivered ON public.order_reviews;
CREATE POLICY order_reviews_insert_own_delivered
    ON public.order_reviews
    FOR INSERT
    TO authenticated
    WITH CHECK (
        reviewer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id
              AND LOWER(COALESCE(o.status,'')) = 'delivered'
              AND o.delivery_boy_id = reviewer_id
        )
    );

-- Extra guard: exactly-once per order (redundant with UNIQUE(order_id), but
-- kept explicit so an INSERT duplicate returns a clean 409/23505 instead of
-- silently doing nothing).
DROP TRIGGER IF EXISTS trg_order_reviews_once_per_order ON public.order_reviews;
DROP FUNCTION IF EXISTS public._order_reviews_once_per_order();
CREATE FUNCTION public._order_reviews_once_per_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.order_reviews
        WHERE order_id = NEW.order_id
    ) THEN
        RAISE EXCEPTION 'order_reviews_once_per_order'
            USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_reviews_once_per_order
    BEFORE INSERT ON public.order_reviews
    FOR EACH ROW EXECUTE FUNCTION public._order_reviews_once_per_order();

-- Policy 2: admin can read all reviews (uses existing public.is_admin())
DROP POLICY IF EXISTS order_reviews_select_admin ON public.order_reviews;
CREATE POLICY order_reviews_select_admin
    ON public.order_reviews
    FOR SELECT
    TO authenticated
    USING (public.is_admin());

-- =====================================================================
-- 4. partner-busy / terminal-status lists — make 'return_refund' terminal too
--    (cancelled is already excluded everywhere; add return_refund alongside)
-- =====================================================================
-- NOTE: The JS constant TERMINAL_STATUSES lives in server/utils/deliveryAssign.js
-- (delivered, completed, cancelled, failed). That is a CODE change, not SQL,
-- and is handled in Step 2. No SQL function guards the busy list (it is a
-- PostgREST query in JS), so there is nothing to alter here for that list.
-- The only SQL-side terminal set is the PACK-FIRST gate above, which now
-- includes return_refund.

COMMIT;
