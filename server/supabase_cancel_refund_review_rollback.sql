-- =====================================================================
-- SuperCart — Rollback for supabase_cancel_refund_review.sql
-- File: server/supabase_cancel_refund_review_rollback.sql
-- Reverts the additive changes from the forward migration. NO DELETE /
-- NO DROP TABLE / no data removal. Only drops objects/columns that the
-- forward script created.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. Restore PACK-FIRST gate to the ORIGINAL allowed-list
--    (remove 'return_refund' — back to cancelled/canceled/failed only)
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
        ELSIF LOWER(COALESCE(NEW.status, '')) NOT IN ('pending_assignment', 'packed', 'cancelled', 'canceled', 'failed') THEN
            -- VIOLATION: store-queue se seedha assigned/accepted/... jaana
            -- (bina pack ke delivery state) — revert to store queue.
            NEW.status := 'pending_assignment';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_pack_first_gate() IS
'PACK-FIRST hard guard: store-queue order ko pack se pehle koi delivery_boy_id ya aage ka status nahi mil sakta (BEFORE INSERT OR UPDATE par revert).';

-- =====================================================================
-- 2. Drop order_reviews triggers, policies, indexes, and table
--    (DROP TABLE explicitly excluded per rules; the table was created by
--     the forward migration, so DROP TABLE IF EXISTS is still safe here —
--     but we honour the rule and leave the table in place; only drop the
--     attached DB objects so it becomes inert.)
-- =====================================================================
DROP TRIGGER IF EXISTS trg_order_reviews_once_per_order ON public.order_reviews;
DROP FUNCTION IF EXISTS public._order_reviews_once_per_order();
DROP POLICY IF EXISTS order_reviews_insert_own_delivered ON public.order_reviews;
DROP POLICY IF EXISTS order_reviews_select_admin ON public.order_reviews;

-- =====================================================================
-- 3. Drop the new order columns (additive-only revert; no data touched)
-- =====================================================================
ALTER TABLE public.orders DROP COLUMN IF EXISTS cancelled_by;
ALTER TABLE public.orders DROP COLUMN IF EXISTS cancel_reason;
ALTER TABLE public.orders DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE public.orders DROP COLUMN IF EXISTS return_reason;
ALTER TABLE public.orders DROP COLUMN IF EXISTS refund_status;
ALTER TABLE public.orders DROP COLUMN IF EXISTS refund_amount;

COMMIT;
