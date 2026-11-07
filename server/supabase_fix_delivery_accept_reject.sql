-- ============================================================================
-- SUPERCART - FIX: Delivery Accept / Reject (server-side SECURITY DEFINER)
-- ============================================================================
-- Problem: Accept/Reject direct client UPDATE on (orders) ab RLS/tamper
-- trigger se block ho rahe the -> "Order could not be accepted." / reject fail.
-- Fix: Accept/Reject ko server-side secure functions me move karo. Ye functions
-- khud check karte hain: order isi partner ko assigned hai + status sahi hai +
-- auth check. Direct client UPDATE band rehta hai, par legit flow chalta hai.
--
-- RUN: Supabase SQL Editor me ye file run karo (idempotent - CREATE OR REPLACE).
-- ROLLBACK: file ke end me (koi DELETE/TRUNCATE nahi).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ACCEPT: assigned -> accepted (sirf assigned partner, sirf assigned status)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_order(
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
    SELECT * INTO o FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    -- Sirf assigned delivery partner
    IF o.delivery_boy_id IS NULL OR o.delivery_boy_id IS DISTINCT FROM p_partner_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'This order is not assigned to you');
    END IF;

    -- Sirf 'assigned' se 'accepted' (forward)
    IF lower(btrim(o.status)) <> 'assigned' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Only assigned orders can be accepted');
    END IF;

    UPDATE orders
    SET status = 'accepted'
    WHERE id = p_order_id AND status = 'assigned'
    RETURNING * INTO o;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order changed. Refresh and try again');
    END IF;

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(o));
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 2) REJECT / TIMEOUT: assigned -> pending_assignment
--    (order store queue me wapas, self ko rejected_by me add, delivery_boy_id null)
--    NO auto-packed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_order(
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
    SELECT * INTO o FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    -- Sirf assigned partner (ya already unassigned is safe - pass-through)
    IF o.delivery_boy_id IS NOT NULL AND o.delivery_boy_id IS DISTINCT FROM p_partner_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'This order is not assigned to you');
    END IF;

    IF lower(btrim(o.status)) <> 'assigned' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Only assigned orders can be rejected');
    END IF;

    UPDATE orders
    SET delivery_boy_id = NULL,
        status = 'pending_assignment',
        rejected_by = COALESCE(rejected_by, '{}'::uuid[]) || p_partner_id
    WHERE id = p_order_id AND status = 'assigned'
    RETURNING * INTO o;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order changed. Refresh and try again');
    END IF;

    PERFORM retry_pending_assignments();
    RETURN jsonb_build_object('success', true, 'data', to_jsonb(o));
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 3) GRANTS (backend / authenticated calls)
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION accept_order(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_order(BIGINT, UUID) TO authenticated;

-- ============================================================================
-- VERIFY (RUN ke baad SQL Editor me chalao)
-- ============================================================================
-- SELECT proname FROM pg_proc WHERE proname IN ('accept_order','reject_order');

-- ============================================================================
-- ROLLBACK (agar kuch wapas karna ho - no DELETE/TRUNCATE)
-- ============================================================================
/*
DROP FUNCTION IF EXISTS accept_order(BIGINT, UUID);
DROP FUNCTION IF EXISTS reject_order(BIGINT, UUID);
*/
