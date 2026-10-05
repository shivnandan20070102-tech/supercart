-- ===================================================
-- SUPERCART PACKED-QUEUE RETRY (30s worker ka DB backup) — FINAL FLOW
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Project: eagwchutdhtgioujetag
--
-- FINAL FLOW: Customer -> nearest store -> store PACKED kare TABHI assign.
-- - 'pending_assignment' / 'Placed' / 'pending' (unassigned) = STORE queue.
--   Pack se pehle delivery assign NAHI hota.
-- - 'packed' (unassigned) = DELIVERY queue. Store PACKED kare aur koi rider
--   free na ho to order yahin rehta hai; Reject/Timeout ke baad bhi order
--   wapas 'packed' (unassigned) jata hai. Is queue me partner FREE hote hi
--   use turant assign karna hai.
--   FREE = (verified YA approved) + is_available(true) + koi active order nahi (BUSY excluded).
--
-- Ye file 2 cheezein karti hai (Node 30s worker ke SAATH kaam karti hai):
--   1. BEFORE INSERT normalize: delivery_boy_id ke bina 'Placed'/'pending'
--      insert ho to use 'pending_assignment' bana do (store queue guarantee).
--   2. AFTER UPDATE trigger on users: koi delivery partner
--      is_available false -> true hote hi sabse purana PACKED order
--      turant usi ko assign (Realtime jaisa instant behaviour, 30s wait nahi).
--   3. retry_pending_assignments() helper: manual / cron se call karke
--      saare PACKED orders ek saath assign karo.
--
-- Express backend (server/jobs/pendingAssignmentWorker.js) har 30s me
-- same kaam karta hai — DB trigger instant path hai, Node poller backup hai.
-- Dono idempotent hain: already-assigned order ko dobara touch nahi karte.
-- Dobara RUN karna safe hai (ek baar run kaafi hai, bar-bar nahi).
-- ===================================================

-- 0. Safety: chahiye columns pakke karo (auto_assign file jaisi hi)
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_boy_id TEXT;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS rejected_by JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Placed';

-- ===================================================
-- 1. BEFORE INSERT normalize: 'Placed'/'pending' + unassigned
--    -> 'pending_assignment' (taaki purana backend bhi requirement follow kare)
-- ===================================================
CREATE OR REPLACE FUNCTION public.normalize_pending_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (NEW.delivery_boy_id IS NULL OR NEW.delivery_boy_id = '')
       AND NEW.status IN ('Placed', 'pending') THEN
        NEW.status := 'pending_assignment';
    END IF;
    -- delivery_boy_id ke bina aaya aur status NULL ho to bhi pending rakho
    IF (NEW.delivery_boy_id IS NULL OR NEW.delivery_boy_id = '')
       AND (NEW.status IS NULL OR NEW.status = '') THEN
        NEW.status := 'pending_assignment';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_pending_status ON public.orders;
CREATE TRIGGER trg_normalize_pending_status
    BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.normalize_pending_status();

-- ===================================================
-- 2. Core: ek FREE partner ko PACKED order assign karo
--    FINAL FLOW gate: sirf 'packed' (unassigned) delivery queue hai.
--    'pending_assignment' / 'Placed' / 'pending' store queue hai — PACKED se
--    pehle inhe chhoona spec violation hai.
--    ORDER OF PREFERENCE: HOME-FIRST — is partner ke home_store_id wale store
--    ka packed order pehle; phir is partner ke sabse NAZDEEK store wala packed
--    order (users.current_lat/current_lng vs stores lat/lng, Haversine);
--    tie/geo-missing par sabse purana order pehle (FIFO, existing rule).
--    Returns true = assign hua, false = koi packed nahi / reject-list clash
-- ===================================================
CREATE OR REPLACE FUNCTION public.assign_oldest_pending_to_partner(p_partner_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_order_id BIGINT;
    p_lat DOUBLE PRECISION := NULL;
    p_lng DOUBLE PRECISION := NULL;
    has_stores BOOLEAN := false;
    v_home BIGINT := NULL;
BEGIN
    -- Partner abhi bhi eligible hai? (verify + available + delivery role + FREE)
    IF NOT EXISTS (
        SELECT 1 FROM public.users AS u
        WHERE u.id = p_partner_id
          AND u.role IN ('delivery', 'delivery_partner')
          AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
          AND COALESCE(u.is_available, true) = true
          -- BUSY RULE: active order wala partner eligible nahi
          AND NOT EXISTS (
            SELECT 1 FROM public.orders AS o
            WHERE o.delivery_boy_id = u.id::text
              AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
          )
    ) THEN
        RETURN false;
    END IF;

    -- Partner ki latest location (columns migration se pehle hon to NULL —
    -- EXCEPTION guard taaki function kabhi fail na ho).
    BEGIN
        SELECT u.current_lat, u.current_lng INTO p_lat, p_lng
        FROM public.users AS u WHERE u.id = p_partner_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
        p_lat := NULL;
        p_lng := NULL;
    END;
    -- Partner ka Home Store (column migration se pehle ho to NULL —
    -- EXCEPTION guard taaki function kabhi fail na ho). HOME-FIRST: is
    -- partner ke home store wale packed orders ko preference milti hai.
    BEGIN
        SELECT dp.home_store_id INTO v_home
        FROM public.delivery_profiles AS dp WHERE dp.user_id = p_partner_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
        v_home := NULL;
    END;
    SELECT (to_regclass('public.stores') IS NOT NULL) INTO has_stores;

    -- Is partner ne reject na kiya ho, aisa PACKED (unassigned) order uthao —
    -- pehle us store wala jo is partner ke sabse nazdeek ho, phir sabse purana.
    -- FOR UPDATE ... SKIP LOCKED: 2 partners same second me aayein to
    -- dono ek hi order ko lock na karein (duplicate assign ban).
    IF has_stores THEN
        SELECT o.id INTO target_order_id
        FROM public.orders AS o
        LEFT JOIN public.stores AS s ON s.id = o.store_id
        WHERE (o.delivery_boy_id IS NULL OR o.delivery_boy_id = '')
          AND o.status = 'packed'
          AND NOT (
            o.rejected_by IS NOT NULL
            AND jsonb_typeof(o.rejected_by) = 'array'
            AND o.rejected_by @> to_jsonb(p_partner_id::text)
          )
        ORDER BY
          -- HOME-FIRST: apne home store ka packed order sabse pehle,
          -- phir nazdeek-tareen store wala, phir sabse purana (FIFO).
          CASE WHEN v_home IS NOT NULL AND o.store_id = v_home THEN 0 ELSE 1 END,
          CASE
            WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
             AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
            THEN (6371 * 2 * ASIN(SQRT(
                   POWER(SIN(RADIANS(s.latitude - p_lat) / 2), 2)
                   + COS(RADIANS(p_lat)) * COS(RADIANS(s.latitude))
                     * POWER(SIN(RADIANS(s.longitude - p_lng) / 2), 2)
                 )))
            ELSE NULL
          END ASC NULLS LAST,
          o.created_at ASC
        LIMIT 1
        FOR UPDATE OF o SKIP LOCKED;
    ELSE
        SELECT o.id INTO target_order_id
        FROM public.orders AS o
        WHERE (o.delivery_boy_id IS NULL OR o.delivery_boy_id = '')
          AND o.status = 'packed'
          AND NOT (
            o.rejected_by IS NOT NULL
            AND jsonb_typeof(o.rejected_by) = 'array'
            AND o.rejected_by @> to_jsonb(p_partner_id::text)
          )
        ORDER BY o.created_at ASC
        LIMIT 1
        FOR UPDATE OF o SKIP LOCKED;
    END IF;

    IF target_order_id IS NULL THEN
        RETURN false;
    END IF;

    -- Sirf order assign karo. Partner ka is_available touch NAHI hota —
    -- Online/Offline SIRF partner ke apne toggle ya Admin toggle se badalta hai.
    -- Guard: sirf abhi-bhi-unassigned row ko touch karo (duplicate assign ban).
    UPDATE public.orders
    SET delivery_boy_id = p_partner_id::text,
        status = 'assigned'
    WHERE id = target_order_id
      AND (delivery_boy_id IS NULL OR delivery_boy_id = '');

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.assign_oldest_pending_to_partner(UUID) IS
'FREE partner ko uske nazdeek-tareen store wala packed order assign karta hai (tie/FIFO fallback, PACKED-gate); partner ka Online/Offline status nahi badalta.';

-- ===================================================
-- 3. Bulk helper: saare PACKED orders assign karo (manual / cron)
--    Returns: kitne orders assign hue
-- ===================================================
CREATE OR REPLACE FUNCTION public.retry_pending_assignments()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    partner_row RECORD;
    assigned_count INTEGER := 0;
BEGIN
    FOR partner_row IN
        SELECT u.id
        FROM public.users AS u
        WHERE u.role IN ('delivery', 'delivery_partner')
          AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
          AND COALESCE(u.is_available, true) = true
          -- BUSY partners ko loop me uthao hi mat (inner function me bhi check hai)
          AND NOT EXISTS (
            SELECT 1 FROM public.orders AS o
            WHERE o.delivery_boy_id = u.id::text
              AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
          )
        ORDER BY RANDOM()
        FOR UPDATE OF u SKIP LOCKED
    LOOP
        IF public.assign_oldest_pending_to_partner(partner_row.id) THEN
            assigned_count := assigned_count + 1;
        END IF;
    END LOOP;
    RETURN assigned_count;
END;
$$;

COMMENT ON FUNCTION public.retry_pending_assignments() IS
'Saare packed (unassigned) orders ko FREE partners me baanto (PACKED-gate); returns assigned count.';

-- ===================================================
-- 4. Instant trigger: partner available hote hi turant assign
--    (Node 30s worker iska backup hai — dono me se jo pehle
--    lock le, wahi assign karega; dusra SKIP LOCKED se skip.)
-- ===================================================
CREATE OR REPLACE FUNCTION public.on_partner_available_retry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Sirf false -> true transition par kaam karo (har UPDATE par nahi).
    -- Eligible = verified YA approved (approval flow verified set kare bina bhi
    -- approve kar sakta hai — sirf verified check par Online hote hi instant
    -- assign kabhi nahi hota tha aur order packed me atka rehta tha).
    IF COALESCE(OLD.is_available, false) = false
       AND COALESCE(NEW.is_available, false) = true
       AND NEW.role IN ('delivery', 'delivery_partner')
       AND (COALESCE(NEW.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = NEW.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved')) THEN
        PERFORM public.assign_oldest_pending_to_partner(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retry_pending_on_partner_available ON public.users;
CREATE TRIGGER trg_retry_pending_on_partner_available
    AFTER UPDATE OF is_available, verified ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.on_partner_available_retry();

-- ===================================================
-- 5. Realtime ke liye publication pakki karo (idempotent)
-- ===================================================
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'users'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
END $$;

-- ===================================================
-- VERIFY (optional, RUN ke baad alag se chalao):
--
-- -- Normalize trigger laga?
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table IN ('orders','users')
--   AND trigger_name IN ('trg_normalize_pending_status','trg_retry_pending_on_partner_available');
--
-- -- Delivery-ready (packed) queue kitni badi?
-- SELECT id, status, delivery_boy_id, created_at FROM public.orders
-- WHERE status = 'packed'
--   AND (delivery_boy_id IS NULL OR delivery_boy_id = '')
-- ORDER BY created_at ASC LIMIT 20;
--
-- -- Store queue (pack hona baaki — assign NAHI hona chahiye):
-- SELECT id, status, delivery_boy_id, created_at FROM public.orders
-- WHERE status IN ('pending_assignment','Placed','pending')
--   AND (delivery_boy_id IS NULL OR delivery_boy_id = '')
-- ORDER BY created_at ASC LIMIT 20;
--
-- -- Manual retry (kitne assign hue?):
-- SELECT public.retry_pending_assignments();
-- ===================================================
