-- ============================================================================
-- SUPERCART — RAZORPAY ONLINE PAYMENTS (schema + delivery/accept gates)
-- ============================================================================
-- Run in Supabase SQL editor after taking a backup.
--
-- This migration:
--   1. Adds the Razorpay payment columns used by paymentController.js
--      (markOrderPaid) to public.orders + an index on razorpay_order_id.
--   2. Replaces advance_order_step(): online (non-cash) orders can only be
--      marked delivered when payment_status='paid' (the loose rule that treated
--      every non-cash order as paid is removed). Cash orders keep the existing
--      behaviour (payment_collected gate).
--   3. Replaces accept_order(): a delivery partner is refused from accepting an
--      online order whose payment_status is not 'paid'. Signature unchanged.
--
-- Idempotent (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS). No DELETE/TRUNCATE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ORDERS: Razorpay payment columns + index
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS razorpay_order_id   TEXT,
    ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
    ADD COLUMN IF NOT EXISTS gateway_ref         TEXT,
    ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id
    ON public.orders (razorpay_order_id);

-- ---------------------------------------------------------------------------
-- 2) advance_order_step — paid gate for online orders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_order_step(
    p_order_id BIGINT,
    p_partner_id UUID,
    p_target TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    o RECORD;
    t TEXT;
    cur TEXT;
    allowed BOOLEAN := false;
    is_cash BOOLEAN;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    -- Sirf assigned delivery partner
    IF o.delivery_boy_id IS NULL OR o.delivery_boy_id::text IS DISTINCT FROM p_partner_id::text THEN
        RETURN jsonb_build_object('success', false, 'message', 'This order is not assigned to you');
    END IF;

    t := public.norm_status(p_target);
    cur := public.norm_status(o.status);

    -- Sirf agla valid step (forward-only)
    allowed := CASE
        WHEN cur = 'assigned' AND t = 'accepted' THEN true
        WHEN cur = 'accepted' AND t = 'picked_up' THEN true
        WHEN cur = 'picked_up' AND t = 'out_for_delivery' THEN true
        WHEN cur = 'out_for_delivery' AND t = 'delivered' THEN true
        ELSE false
    END;

    IF NOT allowed THEN
        RETURN jsonb_build_object('success', false, 'message', 'Only the next delivery step is allowed');
    END IF;

    is_cash := lower(btrim(coalesce(o.payment_method, ''))) IN ('cod', 'cash', 'cash_on_delivery');

    -- Delivered ke liye payment + OTP mandatory
    IF t = 'delivered' THEN
        IF is_cash THEN
            -- Cash orders: partner must have collected the cash first (existing behaviour).
            IF NOT COALESCE(o.payment_collected, false) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Collect payment before marking delivered');
            END IF;
        ELSE
            -- Online orders: payment MUST be settled ('paid'). No loose "any
            -- non-cash order is paid" rule.
            IF COALESCE(o.payment_status, '') <> 'paid' THEN
                RETURN jsonb_build_object('success', false, 'message', 'Online payment must be completed before marking delivered');
            END IF;
        END IF;
        IF o.otp_verified_at IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Verify OTP before marking delivered');
        END IF;
    END IF;

    UPDATE public.orders
    SET status = t
    WHERE id = p_order_id AND status = o.status
    RETURNING * INTO o;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order changed. Refresh and try again');
    END IF;

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(o));
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) accept_order — refuse accepting unpaid online orders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_order(
    p_order_id BIGINT,
    p_partner_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    o RECORD;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    -- Sirf assigned delivery partner (UUID vs TEXT comparison handled)
    IF o.delivery_boy_id IS NULL OR o.delivery_boy_id::text IS DISTINCT FROM p_partner_id::text THEN
        RETURN jsonb_build_object('success', false, 'message', 'This order is not assigned to you');
    END IF;

    -- Sirf 'assigned' se 'accepted' (forward)
    IF lower(btrim(o.status)) <> 'assigned' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Only assigned orders can be accepted');
    END IF;

    -- Online (non-cash) orders: refuse accept unless payment is settled.
    IF lower(btrim(coalesce(o.payment_method, ''))) NOT IN ('cod', 'cash', 'cash_on_delivery') THEN
        IF COALESCE(o.payment_status, '') <> 'paid' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Online payment must be completed before this order can be accepted');
        END IF;
    END IF;

    UPDATE public.orders
    SET status = 'accepted'
    WHERE id = p_order_id AND status = 'assigned'
    RETURNING * INTO o;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order changed. Refresh and try again');
    END IF;

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(o));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4) Grants (backend / authenticated calls)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.advance_order_step(BIGINT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_order(BIGINT, UUID) TO authenticated;

-- ============================================================================
-- VERIFY (RUN ke baad SQL Editor me chalao)
-- ============================================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name='orders'
--   AND column_name IN ('razorpay_order_id','razorpay_payment_id','gateway_ref','paid_at');
-- SELECT proname FROM pg_proc WHERE proname IN ('advance_order_step','accept_order');

-- ============================================================================
-- ROLLBACK (agar kuch wapas karna ho - DELETE/TRUNCATE nahi)
-- ============================================================================
/*
DROP FUNCTION IF EXISTS public.advance_order_step(BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.accept_order(BIGINT, UUID);
ALTER TABLE public.orders DROP COLUMN IF EXISTS razorpay_order_id;
ALTER TABLE public.orders DROP COLUMN IF EXISTS razorpay_payment_id;
ALTER TABLE public.orders DROP COLUMN IF EXISTS gateway_ref;
ALTER TABLE public.orders DROP COLUMN IF EXISTS paid_at;
DROP INDEX IF EXISTS idx_orders_razorpay_order_id;
*/
