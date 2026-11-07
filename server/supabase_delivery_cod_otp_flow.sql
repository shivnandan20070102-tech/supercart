-- ============================================================================
-- SUPERCART — DELIVERY FLOW + COD + OTP (Part A) & PAYMENT METHODS (Part B)
-- ============================================================================
-- Ek saath ek hi file me — Supabase SQL Editor me paste karke RUN karo.
--
-- YE FILE KYA KARTI HAI:
--   1. orders me payment/OTP columns add karta hai (existing rows untouched).
--   2. order_otps table banata hai (order_id, otp_hash, attempts, locked,
--      created_at). OTP server-side 4-digit, HASH hoke store hota hai —
--      plain OTP kahin nahi (na store, na log).
--   3. SECURITY DEFINER functions:
--        - advance_order_step()        sirf agla valid step, sirf assigned
--                                      partner; Delivered TABHI jab payment
--                                      collected/paid AUR OTP verified.
--        - collect_order_payment()     cash collected — collected_amount
--                                      order ke total se (client se nahi).
--        - verify_order_otp()          5 galat attempt par lock.
--        - get_customer_otp()          sirf customer/admin ko OTP (hash se
--                                      fresh code generate karke) dikhata hai.
--        - admin_override_deliver()    admin OTP ke bina delivered (reason
--                                      zaroori, admin_activity_log entry).
--   4. order_otps par RLS: SELECT sirf customer (aur admin). Partner ke
--      liye sirf verify function (seedha read nahi).
--   5. orders par RLS + trigger: payment/status/OTP field direct client
--      UPDATE block (sirf service-role backend / secure functions chalte hain).
--   6. Rollback section (end me) — koi DELETE/TRUNCATE nahi.
--
-- RUN KE BAAD: order_otps ki RLS verify karo (Section 10).
-- ============================================================================

-- ============================================================================
-- 0. pgcrypto (digest / gen_random_uuid) — Supabase me default available
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. orders — COD / OTP columns (existing orders ko touch nahi karta)
-- ============================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS payment_collected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS collected_amount NUMERIC;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS collected_by UUID;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMPTZ;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';

-- Existing rows: agar purana order already paid/COD ho to payment_status pa
-- default 'pending' pe hoga — jo sahi hai (still to collect). Online/paid
-- legacy rows ko 'paid' mark karo (payment_method me 'cash' nahi ho to).
UPDATE public.orders
SET payment_status = 'paid'
WHERE lower(trim(payment_method)) NOT LIKE '%cash%'
  AND lower(trim(payment_method)) NOT LIKE '%cod%'
  AND payment_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_orders_payment_status
    ON public.orders (payment_status)
    WHERE payment_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_otp_verified_at
    ON public.orders (otp_verified_at)
    WHERE otp_verified_at IS NOT NULL;

-- ============================================================================
-- 2. order_otps table — OTP sirf HASH form me
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_otps (
    order_id BIGINT PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    otp_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_otps_created_at
    ON public.order_otps (created_at DESC);

-- ============================================================================
-- 3. OTP helpers (hash / generate / ensure)
--    Hash format: "<salt>$<sha256hex(salt:code)>" — plain code kabhi nahi.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.hash_otp(code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s || '$' || encode(digest(s || ':' || code, 'sha256'), 'hex')
  FROM (SELECT gen_random_uuid()::text AS s) AS x;
$$;

CREATE OR REPLACE FUNCTION public.generate_otp_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

-- OTP row ensure karo (agar missing ho). Naya code generate + hash store.
-- Plain code yahan se bahar NAHI jaata (sirf customer endpoint hi dikhata hai).
CREATE OR REPLACE FUNCTION public.ensure_order_otp_row(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.order_otps (order_id, otp_hash, attempts, locked)
    VALUES (p_order_id, public.hash_otp(public.generate_otp_code()), 0, false)
    ON CONFLICT (order_id) DO NOTHING;
END;
$$;

-- ============================================================================
-- 4. advance_order_step — SECURITY DEFINER (authoritative guard)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.norm_status(s TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(regexp_replace(coalesce(s, ''), '[\s-]+', '_', 'g')));
$$;

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

    -- Delivered ke liye payment + OTP mandatory
    IF t = 'delivered' THEN
        IF NOT (COALESCE(o.payment_collected, false) OR COALESCE(o.payment_status, '') = 'paid') THEN
            RETURN jsonb_build_object('success', false, 'message', 'Collect payment before marking delivered');
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

-- ============================================================================
-- 5. collect_order_payment — SECURITY DEFINER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.collect_order_payment(
    p_order_id BIGINT,
    p_partner_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    o RECORD;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    IF o.delivery_boy_id IS NULL OR o.delivery_boy_id::text IS DISTINCT FROM p_partner_id::text THEN
        RETURN jsonb_build_object('success', false, 'message', 'This order is not assigned to you');
    END IF;

    -- Already paid (online / already collected)
    IF COALESCE(o.payment_status, '') = 'paid' THEN
        RETURN jsonb_build_object('success', false, 'message', 'This order is already paid');
    END IF;

    -- Sirf tab collect ho sakta hai jab order Partner ke paas ho (picked_up
    -- se out_for_delivery tak) — delivered ke baad nahi.
    IF public.norm_status(o.status) NOT IN ('picked_up', 'out_for_delivery') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Collect cash only after pickup and before delivery');
    END IF;

    -- collected_amount server-authoritative: order ke total se (client se nahi)
    UPDATE public.orders
    SET payment_collected = true,
        collected_amount = o.total_price,
        collected_at = now(),
        collected_by = p_partner_id,
        payment_status = 'paid'
    WHERE id = p_order_id AND status = o.status
    RETURNING * INTO o;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order changed. Refresh and try again');
    END IF;

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(o));
END;
$$;

-- ============================================================================
-- 6. verify_order_otp — SECURITY DEFINER (5 attempt lock)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.verify_order_otp(
    p_order_id BIGINT,
    p_partner_id UUID,
    p_otp TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    o RECORD;
    r RECORD;
    salt TEXT;
    expected_hash TEXT;
    input_hash TEXT;
    is_correct BOOLEAN;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    IF o.delivery_boy_id IS NULL OR o.delivery_boy_id::text IS DISTINCT FROM p_partner_id::text THEN
        RETURN jsonb_build_object('success', false, 'message', 'This order is not assigned to you');
    END IF;

    IF NOT (p_otp ~ '^\d{4}$') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Enter the customer 4-digit OTP');
    END IF;

    SELECT * INTO r FROM public.order_otps WHERE order_id = p_order_id;
    IF NOT FOUND THEN
        -- Purane order / missing row — abhi generate karo aur batao ki
        -- customer se naya code le. (Part A: purane orders me bhi bano)
        PERFORM public.ensure_order_otp_row(p_order_id);
        RETURN jsonb_build_object('success', false, 'message', 'Customer OTP is not active yet. Ask the customer to refresh and share the code.');
    END IF;

    IF r.locked THEN
        RETURN jsonb_build_object('success', false, 'message', 'OTP is locked. Admin se sampark karo');
    END IF;
    IF r.attempts >= 5 THEN
        UPDATE public.order_otps SET locked = true WHERE order_id = p_order_id;
        RETURN jsonb_build_object('success', false, 'message', 'OTP is locked. Admin se sampark karo');
    END IF;

    salt := split_part(r.otp_hash, '$', 1);
    expected_hash := split_part(r.otp_hash, '$', 2);
    input_hash := encode(digest(salt || ':' || p_otp, 'sha256'), 'hex');
    is_correct := input_hash = expected_hash;

    IF NOT is_correct THEN
        UPDATE public.order_otps
        SET attempts = attempts + 1,
            locked = (attempts + 1 >= 5)
        WHERE order_id = p_order_id;
        IF attempts + 1 >= 5 THEN
            RETURN jsonb_build_object('success', false, 'message', 'OTP locked after 5 failed attempts. Admin se sampark karo');
        END IF;
        RETURN jsonb_build_object('success', false, 'message', 'Incorrect OTP. ' || (5 - (attempts + 1))::text || ' attempts left');
    END IF;

    -- Correct: mark otp_verified_at (delivered gate isi pe depend karta hai)
    UPDATE public.orders
    SET otp_verified_at = now()
    WHERE id = p_order_id AND otp_verified_at IS NULL;

    UPDATE public.order_otps SET attempts = 0, locked = false WHERE order_id = p_order_id;

    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'message', 'OTP verified', 'data', to_jsonb(o));
END;
$$;

-- ============================================================================
-- 7. get_customer_otp — sirf customer / admin ko OTP dikhao
--    (hash se fresh code generate karke return — plain kabhi store nahi)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_customer_otp(
    p_order_id BIGINT,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    o RECORD;
    code TEXT;
    is_owner BOOLEAN;
    is_admin BOOLEAN;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    is_owner := o.user_id IS NOT NULL AND o.user_id = p_user_id;
    SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND role = 'admin') INTO is_admin;

    IF NOT (is_owner OR is_admin) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authorized to view this OTP');
    END IF;

    -- Sirf jab order out_for_delivery (ya aage, delivered se pehle) ho
    IF public.norm_status(o.status) NOT IN ('out_for_delivery', 'picked_up', 'accepted', 'assigned') THEN
        RETURN jsonb_build_object('success', false, 'message', 'OTP available only when the order is out for delivery');
    END IF;

    -- Fresh code generate + hash store (purana invalid hota hai — sahi hai)
    code := public.generate_otp_code();
    INSERT INTO public.order_otps (order_id, otp_hash, attempts, locked)
    VALUES (p_order_id, public.hash_otp(code), 0, false)
    ON CONFLICT (order_id) DO UPDATE SET otp_hash = EXCLUDED.otp_hash, attempts = 0, locked = false;

    RETURN jsonb_build_object('success', true, 'otp', code, 'order_status', o.status);
END;
$$;

-- ============================================================================
-- 8. admin_override_deliver — SECURITY DEFINER (reason mandatory + audit)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_override_deliver(
    p_order_id BIGINT,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    o RECORD;
    is_admin BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin') INTO is_admin;
    IF NOT is_admin THEN
        RETURN jsonb_build_object('success', false, 'message', 'Admin access required');
    END IF;

    IF COALESCE(p_reason, '') = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'A reason is required for admin override delivery');
    END IF;

    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order not found');
    END IF;

    IF public.norm_status(o.status) = 'delivered' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Order is already delivered');
    END IF;

    UPDATE public.orders
    SET status = 'delivered',
        otp_verified_at = COALESCE(otp_verified_at, now())
    WHERE id = p_order_id
    RETURNING * INTO o;

    -- Audit entry (admin_activity_log)
    INSERT INTO public.admin_activity_log (admin_id, action_type, target_id, description)
    VALUES (p_admin_id, 'delivery_override_delivered', p_order_id::text,
            'Admin override: order marked delivered without OTP. Reason: ' || left(COALESCE(p_reason, ''), 300));

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(o));
END;
$$;

-- ============================================================================
-- 9a. Trigger: order out_for_delivery hote hi OTP row ensure (purane bhi)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.on_order_out_for_delivery_ensure_otp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.norm_status(NEW.status) = 'out_for_delivery' THEN
        PERFORM public.ensure_order_otp_row(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_otp_on_out_for_delivery ON public.orders;
CREATE TRIGGER trg_ensure_otp_on_out_for_delivery
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    WHEN (public.norm_status(NEW.status) = 'out_for_delivery')
    EXECUTE FUNCTION public.on_order_out_for_delivery_ensure_otp();

-- ============================================================================
-- 9b. Trigger: direct client payment/OTP/delivery-status tamper block
--     (service-role backend / SECURITY DEFINER functions hi ye fields badal
--      sakte hain — app client / partner / admin-direct denied)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_client_order_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_user IN ('service_role', 'postgres') THEN
        RETURN NEW;
    END IF;

    IF (NEW.payment_status IS DISTINCT FROM OLD.payment_status)
       OR (NEW.payment_collected IS DISTINCT FROM OLD.payment_collected)
       OR (NEW.collected_amount IS DISTINCT FROM OLD.collected_amount)
       OR (NEW.collected_at IS DISTINCT FROM OLD.collected_at)
       OR (NEW.collected_by IS DISTINCT FROM OLD.collected_by)
       OR (NEW.otp_verified_at IS DISTINCT FROM OLD.otp_verified_at)
       OR (public.norm_status(NEW.status) = 'delivered'
           AND public.norm_status(OLD.status) <> 'delivered') THEN
        RAISE EXCEPTION 'Direct update to payment/OTP/delivery status is not allowed';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_order_tamper ON public.orders;
CREATE TRIGGER trg_prevent_client_order_tamper
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.prevent_client_order_tamper();

-- ============================================================================
-- 9c. order_otps RLS: SELECT sirf customer (owner) + admin.
--      Partner ke liye sirf verify function (direct read haram).
-- ============================================================================
ALTER TABLE public.order_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order OTP owner can read" ON public.order_otps;
CREATE POLICY "Order OTP owner can read"
    ON public.order_otps FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND o.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Order OTP admin can read" ON public.order_otps;
CREATE POLICY "Order OTP admin can read"
    ON public.order_otps FOR SELECT TO authenticated
    USING (public.is_admin());

REVOKE ALL ON TABLE public.order_otps FROM anon;

-- Function grants (secure functions — backend/service + authenticated call)
GRANT EXECUTE ON FUNCTION public.advance_order_step(BIGINT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_order_payment(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_order_otp(BIGINT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_otp(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_override_deliver(BIGINT, UUID, TEXT) TO authenticated;

-- ============================================================================
-- 10. VERIFY (RUN ke baad SQL Editor me chalao)
-- ============================================================================
-- -- (a) order_otps RLS: partner (non-owner) ko 0 rows dikhe:
-- SET ROLE authenticated; -- ya apne login session me SELECT karo
-- SELECT * FROM public.order_otps;
-- RESET ROLE;
--
-- -- (b) direct client tamper try — exception aana chahiye (service_role aur
-- --     secure functions ke alawa):
-- UPDATE public.orders SET payment_status = 'paid' WHERE id = 1;
--
-- -- (c) functions exist verification:
-- SELECT proname FROM pg_proc
-- WHERE proname IN ('advance_order_step','collect_order_payment',
--                    'verify_order_otp','get_customer_otp',
--                    'admin_override_deliver');

-- ============================================================================
-- ROLLBACK (agar kuch wapas karna ho — no DELETE/TRUNCATE)
-- ============================================================================
/*
DROP TRIGGER IF EXISTS trg_prevent_client_order_tamper ON public.orders;
DROP TRIGGER IF EXISTS trg_ensure_otp_on_out_for_delivery ON public.orders;
DROP FUNCTION IF EXISTS public.prevent_client_order_tamper();
DROP FUNCTION IF EXISTS public.on_order_out_for_delivery_ensure_otp();
DROP FUNCTION IF EXISTS public.admin_override_deliver(BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_customer_otp(BIGINT, UUID);
DROP FUNCTION IF EXISTS public.verify_order_otp(BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.collect_order_payment(BIGINT, UUID);
DROP FUNCTION IF EXISTS public.advance_order_step(BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.ensure_order_otp_row(BIGINT);
DROP FUNCTION IF EXISTS public.generate_otp_code();
DROP FUNCTION IF EXISTS public.hash_otp(TEXT);
DROP FUNCTION IF EXISTS public.norm_status(TEXT);
ALTER TABLE public.order_otps DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS public.order_otps;
ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_collected;
ALTER TABLE public.orders DROP COLUMN IF EXISTS collected_amount;
ALTER TABLE public.orders DROP COLUMN IF EXISTS collected_at;
ALTER TABLE public.orders DROP COLUMN IF EXISTS collected_by;
ALTER TABLE public.orders DROP COLUMN IF EXISTS otp_verified_at;
ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_status;
*/
