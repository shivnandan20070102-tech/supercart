-- ============================================================================
-- SUPERCART — ORDER FLOW PACK-FIRST MASTER FIX  (eagwchutdhtgioujetag)
-- ============================================================================
-- KYA PROBLEM THI (17 Oct, live DB test se PROVEN):
--   Naya order (status='pending_assignment') insert hote hi ~0.4 SECOND me
--   delivery partner ko auto-assign ho raha tha — store ne "Mark as Packed"
--   dabaya hi nahi tha, par delivery app me 10-second Accept popup khul jata
--   tha. Test: order #90 insert -> 0.43s me boy=2d9b6e8c assign. Worker ka
--   realtime debounce 2s hai, isliye ye AUTO-ASSIGN DB TRIGGER nikla — live
--   DB me purane version ka trigger/function zinda tha jo PACKED-gate ke
--   bina (rejected_by respect karte hue) har insert par assign kar deta tha.
--   retry_pending_assignments() RPC NEW (gated) version tha — matlab DB me
--   2 files ka MIX tha: kahin naya code, kahin purana trigger.
--
-- YE FILE KYA KARTI HAI (sab kuch idempotent — dobara RUN karna safe):
--   0. Audit table: fix se PEHLE orders par kaun-kaun se trigger lage the,
--      wo permanently record kar deti hai (proof + future debugging).
--   1. Safety columns/index (pehle jaisa).
--   2. orders table ke SAARE non-internal triggers DYNAMICALLY DROP —
--      chahe unka naam kuch bhi ho (purane legacy naam bhi isi me aa jaate
--      hain), taaki koi bhi purana "create-par-assign" trigger zinda na bache.
--   3. PACK-FIRST HARD GUARD (naya BEFORE INSERT OR UPDATE trigger):
--      store-queue order (placed/pending/pending_assignment/processing/
--      confirmed/created/khali) ko pack se pehle koi delivery_boy_id ya
--      aage ka status NAHI mil sakta. Koi bhi rogue path (purana trigger,
--      stale worker, direct update) isi jagah revert ho jata hai. Ye DB-level
--      permanent lock hai — trigger list badalne se bhi flow nahi tootega.
--   4. Canonical PACKED-gated functions + triggers dobara lagao:
--        - AFTER INSERT (sirf status='packed')  = backup path
--        - AFTER UPDATE OF status (sirf 'packed' banana par) = store pack path
--   5. Users-side instant retry (partner Online hote hi) + RPC helpers.
--   6. Realtime publication + schema reload.
--   7. Ek final report query (kaunse triggers ab active hain + pehle kya tha).
--
-- RUN KARNE KE BAAD VERIFY (neeche section 8 me pura flow-test SQL hai):
--   1) Naya order insert karo  -> delivery_boy_id NULL rehna chahiye,
--      status 'pending_assignment' — popup NAHI.
--   2) UPDATE status='packed'  -> TABHI assign hona chahiye (popup aaye).
-- ============================================================================

-- ===================================================
-- 0. AUDIT: fix se PEHLE orders par jo triggers lage the unki list capture
--    (is file ko dobara run karne par bhi naya row append hoga — history safe)
-- ===================================================
CREATE TABLE IF NOT EXISTS public.order_flow_fix_audit (
    id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT,
    trigger_name TEXT,
    function_name TEXT
);

INSERT INTO public.order_flow_fix_audit (note, trigger_name, function_name)
SELECT
    'PRE-FIX CAPTURE: fix se pehle ye trigger orders par laga hua tha',
    t.tgname,
    p.proname
FROM pg_trigger AS t
JOIN pg_proc AS p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.orders'::regclass
  AND NOT t.tgisinternal;

-- ===================================================
-- 1. Safety: trigger/functions ke liye chahiye columns + index (idempotent)
-- ===================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_boy_id TEXT;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS rejected_by JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Placed';

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_users_delivery_auto_assign
    ON public.users (role, verified, is_available)
    WHERE role IN ('delivery', 'delivery_partner');

-- Barcode verification (products add/edit ke liye — pehle se ho to no-op)
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS barcode_number TEXT;
CREATE INDEX IF NOT EXISTS idx_products_barcode_number
    ON public.products (barcode_number)
    WHERE barcode_number IS NOT NULL;

-- ===================================================
-- 2. ROGUE TRIGGER ELIMINATION:
--    orders table ke SAARE non-internal triggers drop — naam kuch bhi ho.
--    (Yehi wo step hai jo live DB ke purane "insert-par-turant-assign"
--    trigger ko hamesha ke liye hata deta hai. Neeche canonical triggers
--    selectively dobara lagaye jaate hain.)
-- ===================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT t.tgname
        FROM pg_trigger AS t
        WHERE t.tgrelid = 'public.orders'::regclass
          AND NOT t.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.orders', r.tgname);
    END LOOP;
END $$;

-- ===================================================
-- 3. PACK-FIRST HARD GUARD (naya, sabse important):
--    BEFORE INSERT OR UPDATE — store-queue order ko pack se pehle:
--      a) delivery_boy_id milne hi nahi deta (rogue trigger/worker ne
--         try kiya to boy NULL + status wapas 'pending_assignment'),
--      b) aage ke kisi status (assigned/accepted/picked_up/...) me jaane
--         nahi deta — wapas 'pending_assignment',
--      c) unassigned unpacked variants (placed/pending/processing/...) ko
--         'pending_assignment' normalize karta hai.
--    Isliye ab kisi bhi source se pack se pehle assign IMPOSSIBLE hai.
-- ===================================================
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

CREATE TRIGGER trg_enforce_pack_first_gate
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pack_first_gate();

-- ===================================================
-- 4. CANONICAL PACKED-gated auto-assign (AFTER INSERT + AFTER UPDATE)
--    (purane trigger drop ho chuke hain; yahi dono ab assignment karenge)
-- ===================================================

-- 4a. Core function: nearest eligible partner uthao + assign karo
CREATE OR REPLACE FUNCTION public.auto_assign_delivery_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    chosen_partner_id UUID;
    has_geo BOOLEAN := false;
    has_home BOOLEAN := false;
BEGIN
    -- PACKED gate: store ne pack nahi kiya to kuch mat karo.
    IF NEW.status IS NULL OR LOWER(NEW.status) <> 'packed' THEN
        RETURN NEW;
    END IF;
    -- Agar order pehle se kisi partner ko assigned hai to kuch mat karo.
    IF NEW.delivery_boy_id IS NOT NULL AND NEW.delivery_boy_id <> '' THEN
        RETURN NEW;
    END IF;

    -- Geo data uplabdh hai? (rider-location migration + multi-store tables)
    SELECT
        to_regclass('public.stores') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'current_lat')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'current_lng')
        AND NEW.store_id IS NOT NULL
        INTO has_geo;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
          AND column_name = 'home_store_id'
    ) INTO has_home;

    -- HOME-FIRST: order wale store ke home partners me se nearest FREE.
    IF has_home AND NEW.store_id IS NOT NULL THEN
        BEGIN
            IF has_geo THEN
                SELECT u.id INTO chosen_partner_id
                FROM public.users AS u
                LEFT JOIN public.stores AS s ON s.id = NEW.store_id
                WHERE u.role IN ('delivery', 'delivery_partner')
                  AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
                  AND COALESCE(u.is_available, true) = true
                  AND NOT EXISTS (
                    SELECT 1 FROM public.orders AS o
                    WHERE o.delivery_boy_id = u.id::text
                      AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
                  )
                  AND NOT (
                    NEW.rejected_by IS NOT NULL
                    AND jsonb_typeof(NEW.rejected_by) = 'array'
                    AND NEW.rejected_by @> to_jsonb(u.id::text)
                  )
                  AND EXISTS (
                    SELECT 1 FROM public.delivery_profiles AS dp
                    WHERE dp.user_id = u.id
                      AND dp.home_store_id = NEW.store_id
                  )
                ORDER BY
                  CASE
                    WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL
                     AND u.current_lat IS NOT NULL AND u.current_lng IS NOT NULL
                    THEN (6371 * 2 * ASIN(SQRT(
                           POWER(SIN(RADIANS(u.current_lat - s.latitude) / 2), 2)
                           + COS(RADIANS(s.latitude)) * COS(RADIANS(u.current_lat))
                             * POWER(SIN(RADIANS(u.current_lng - s.longitude) / 2), 2)
                         )))
                    ELSE NULL
                  END ASC NULLS LAST,
                  RANDOM()
                LIMIT 1
                FOR UPDATE OF u SKIP LOCKED;
            ELSE
                SELECT u.id INTO chosen_partner_id
                FROM public.users AS u
                WHERE u.role IN ('delivery', 'delivery_partner')
                  AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
                  AND COALESCE(u.is_available, true) = true
                  AND NOT EXISTS (
                    SELECT 1 FROM public.orders AS o
                    WHERE o.delivery_boy_id = u.id::text
                      AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
                  )
                  AND NOT (
                    NEW.rejected_by IS NOT NULL
                    AND jsonb_typeof(NEW.rejected_by) = 'array'
                    AND NEW.rejected_by @> to_jsonb(u.id::text)
                  )
                  AND EXISTS (
                    SELECT 1 FROM public.delivery_profiles AS dp
                    WHERE dp.user_id = u.id
                      AND dp.home_store_id = NEW.store_id
                  )
                ORDER BY RANDOM()
                LIMIT 1
                FOR UPDATE OF u SKIP LOCKED;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            chosen_partner_id := NULL;
        END;
    END IF;

    -- Fallback: sabhi FREE partners me se order wale store ka nearest.
    IF chosen_partner_id IS NULL THEN
      IF has_geo THEN
        SELECT u.id INTO chosen_partner_id
        FROM public.users AS u
        LEFT JOIN public.stores AS s ON s.id = NEW.store_id
        WHERE u.role IN ('delivery', 'delivery_partner')
          AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
          AND COALESCE(u.is_available, true) = true
          AND NOT EXISTS (
            SELECT 1 FROM public.orders AS o
            WHERE o.delivery_boy_id = u.id::text
              AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
          )
          AND NOT (
            NEW.rejected_by IS NOT NULL
            AND jsonb_typeof(NEW.rejected_by) = 'array'
            AND NEW.rejected_by @> to_jsonb(u.id::text)
          )
        ORDER BY
          CASE
            WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL
             AND u.current_lat IS NOT NULL AND u.current_lng IS NOT NULL
            THEN (6371 * 2 * ASIN(SQRT(
                   POWER(SIN(RADIANS(u.current_lat - s.latitude) / 2), 2)
                   + COS(RADIANS(s.latitude)) * COS(RADIANS(u.current_lat))
                     * POWER(SIN(RADIANS(u.current_lng - s.longitude) / 2), 2)
                 )))
            ELSE NULL
          END ASC NULLS LAST,
          RANDOM()
        LIMIT 1
        FOR UPDATE OF u SKIP LOCKED;
    ELSE
        SELECT u.id INTO chosen_partner_id
        FROM public.users AS u
        WHERE u.role IN ('delivery', 'delivery_partner')
          AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
          AND COALESCE(u.is_available, true) = true
          AND NOT EXISTS (
            SELECT 1 FROM public.orders AS o
            WHERE o.delivery_boy_id = u.id::text
              AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
          )
          AND NOT (
            NEW.rejected_by IS NOT NULL
            AND jsonb_typeof(NEW.rejected_by) = 'array'
            AND NEW.rejected_by @> to_jsonb(u.id::text)
          )
        ORDER BY RANDOM()
        LIMIT 1
        FOR UPDATE OF u SKIP LOCKED;
      END IF;
    END IF;

    IF chosen_partner_id IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.orders
    SET delivery_boy_id = chosen_partner_id::text,
        status = 'assigned'
    WHERE id = NEW.id
      AND (delivery_boy_id IS NULL OR delivery_boy_id = '');

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_assign_delivery_partner() IS
'Packed order INSERT par order-wale-store ka nearest FREE delivery partner auto-assign karta hai (PACKED-gate, geo-fallback random); partner ka Online/Offline status nahi badalta.';

-- Trigger: SIRF 'packed' INSERT par (backup direct-DB path).
CREATE TRIGGER trg_auto_assign_delivery_partner
    AFTER INSERT ON public.orders
    FOR EACH ROW
    WHEN (LOWER(COALESCE(NEW.status, '')) = 'packed'
      AND (NEW.delivery_boy_id IS NULL OR NEW.delivery_boy_id = ''))
    EXECUTE FUNCTION public.auto_assign_delivery_partner();

-- 4b. AFTER UPDATE trigger: store ne "Mark as Packed" kiya TAB assign.
CREATE OR REPLACE FUNCTION public.auto_assign_delivery_partner_on_pack()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    chosen_partner_id UUID;
    has_geo BOOLEAN := false;
    has_home BOOLEAN := false;
BEGIN
    IF NEW.status IS NULL OR LOWER(NEW.status) <> 'packed' THEN
        RETURN NEW;
    END IF;
    IF NEW.delivery_boy_id IS NOT NULL AND NEW.delivery_boy_id <> '' THEN
        RETURN NEW;
    END IF;

    SELECT
        to_regclass('public.stores') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'current_lat')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'current_lng')
        AND NEW.store_id IS NOT NULL
        INTO has_geo;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
          AND column_name = 'home_store_id'
    ) INTO has_home;

    IF has_home AND NEW.store_id IS NOT NULL THEN
        BEGIN
            IF has_geo THEN
                SELECT u.id INTO chosen_partner_id
                FROM public.users AS u
                LEFT JOIN public.stores AS s ON s.id = NEW.store_id
                WHERE u.role IN ('delivery', 'delivery_partner')
                  AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
                  AND COALESCE(u.is_available, true) = true
                  AND NOT EXISTS (
                    SELECT 1 FROM public.orders AS o
                    WHERE o.delivery_boy_id = u.id::text
                      AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
                  )
                  AND NOT (
                    NEW.rejected_by IS NOT NULL
                    AND jsonb_typeof(NEW.rejected_by) = 'array'
                    AND NEW.rejected_by @> to_jsonb(u.id::text)
                  )
                  AND EXISTS (
                    SELECT 1 FROM public.delivery_profiles AS dp
                    WHERE dp.user_id = u.id
                      AND dp.home_store_id = NEW.store_id
                  )
                ORDER BY
                  CASE
                    WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL
                     AND u.current_lat IS NOT NULL AND u.current_lng IS NOT NULL
                    THEN (6371 * 2 * ASIN(SQRT(
                           POWER(SIN(RADIANS(u.current_lat - s.latitude) / 2), 2)
                           + COS(RADIANS(s.latitude)) * COS(RADIANS(u.current_lat))
                             * POWER(SIN(RADIANS(u.current_lng - s.longitude) / 2), 2)
                         )))
                    ELSE NULL
                  END ASC NULLS LAST,
                  RANDOM()
                LIMIT 1
                FOR UPDATE OF u SKIP LOCKED;
            ELSE
                SELECT u.id INTO chosen_partner_id
                FROM public.users AS u
                WHERE u.role IN ('delivery', 'delivery_partner')
                  AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
                  AND COALESCE(u.is_available, true) = true
                  AND NOT EXISTS (
                    SELECT 1 FROM public.orders AS o
                    WHERE o.delivery_boy_id = u.id::text
                      AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
                  )
                  AND NOT (
                    NEW.rejected_by IS NOT NULL
                    AND jsonb_typeof(NEW.rejected_by) = 'array'
                    AND NEW.rejected_by @> to_jsonb(u.id::text)
                  )
                  AND EXISTS (
                    SELECT 1 FROM public.delivery_profiles AS dp
                    WHERE dp.user_id = u.id
                      AND dp.home_store_id = NEW.store_id
                  )
                ORDER BY RANDOM()
                LIMIT 1
                FOR UPDATE OF u SKIP LOCKED;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            chosen_partner_id := NULL;
        END;
    END IF;

    IF chosen_partner_id IS NULL THEN
      IF has_geo THEN
        SELECT u.id INTO chosen_partner_id
        FROM public.users AS u
        LEFT JOIN public.stores AS s ON s.id = NEW.store_id
        WHERE u.role IN ('delivery', 'delivery_partner')
          AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
          AND COALESCE(u.is_available, true) = true
          AND NOT EXISTS (
            SELECT 1 FROM public.orders AS o
            WHERE o.delivery_boy_id = u.id::text
              AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
          )
          AND NOT (
            NEW.rejected_by IS NOT NULL
            AND jsonb_typeof(NEW.rejected_by) = 'array'
            AND NEW.rejected_by @> to_jsonb(u.id::text)
          )
        ORDER BY
          CASE
            WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL
             AND u.current_lat IS NOT NULL AND u.current_lng IS NOT NULL
            THEN (6371 * 2 * ASIN(SQRT(
                   POWER(SIN(RADIANS(u.current_lat - s.latitude) / 2), 2)
                   + COS(RADIANS(s.latitude)) * COS(RADIANS(u.current_lat))
                     * POWER(SIN(RADIANS(u.current_lng - s.longitude) / 2), 2)
                 )))
            ELSE NULL
          END ASC NULLS LAST,
          RANDOM()
        LIMIT 1
        FOR UPDATE OF u SKIP LOCKED;
    ELSE
        SELECT u.id INTO chosen_partner_id
        FROM public.users AS u
        WHERE u.role IN ('delivery', 'delivery_partner')
          AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
          AND COALESCE(u.is_available, true) = true
          AND NOT EXISTS (
            SELECT 1 FROM public.orders AS o
            WHERE o.delivery_boy_id = u.id::text
              AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
          )
          AND NOT (
            NEW.rejected_by IS NOT NULL
            AND jsonb_typeof(NEW.rejected_by) = 'array'
            AND NEW.rejected_by @> to_jsonb(u.id::text)
          )
        ORDER BY RANDOM()
        LIMIT 1
        FOR UPDATE OF u SKIP LOCKED;
      END IF;
    END IF;

    IF chosen_partner_id IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.orders
    SET delivery_boy_id = chosen_partner_id::text,
        status = 'assigned'
    WHERE id = NEW.id
      AND (delivery_boy_id IS NULL OR delivery_boy_id = '');

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_assign_delivery_partner_on_pack() IS
'Store PACKED mark (UPDATE) par nearest FREE delivery partner auto-assign karta hai (PACKED-gate); reject/timeout ke baad wapas packed hone par agle partner ko turant deta hai.';

CREATE TRIGGER trg_auto_assign_delivery_on_pack
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    WHEN (LOWER(COALESCE(NEW.status, '')) = 'packed'
      AND (NEW.delivery_boy_id IS NULL OR NEW.delivery_boy_id = ''))
    EXECUTE FUNCTION public.auto_assign_delivery_partner_on_pack();

-- ===================================================
-- 5. Users-side instant retry + RPC helpers (packed queue ka backup)
-- ===================================================

-- 5a. Ek FREE partner ko uske nazdeek-tareen store wala PACKED order do.
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
    IF NOT EXISTS (
        SELECT 1 FROM public.users AS u
        WHERE u.id = p_partner_id
          AND u.role IN ('delivery', 'delivery_partner')
          AND (COALESCE(u.verified, false) = true OR EXISTS (SELECT 1 FROM public.delivery_profiles AS dp WHERE dp.user_id = u.id AND LOWER(COALESCE(dp.approval_status, '')) = 'approved'))
          AND COALESCE(u.is_available, true) = true
          AND NOT EXISTS (
            SELECT 1 FROM public.orders AS o
            WHERE o.delivery_boy_id = u.id::text
              AND (o.status IS NULL OR LOWER(o.status) NOT IN ('delivered', 'completed', 'cancelled', 'failed'))
          )
    ) THEN
        RETURN false;
    END IF;

    BEGIN
        SELECT u.current_lat, u.current_lng INTO p_lat, p_lng
        FROM public.users AS u WHERE u.id = p_partner_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
        p_lat := NULL;
        p_lng := NULL;
    END;
    BEGIN
        SELECT dp.home_store_id INTO v_home
        FROM public.delivery_profiles AS dp WHERE dp.user_id = p_partner_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
        v_home := NULL;
    END;
    SELECT (to_regclass('public.stores') IS NOT NULL) INTO has_stores;

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

-- 5b. Bulk helper: saare PACKED orders assign karo (RPC / worker / manual)
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

-- 5c. Instant trigger: partner Online hote hi packed order turant assign.
CREATE OR REPLACE FUNCTION public.on_partner_available_retry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
-- 6. Realtime + schema reload (idempotent)
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

NOTIFY pgrst, 'reload schema';

-- ===================================================
-- 7. FINAL REPORT (SQL Editor ke last result me dikhega):
--    - AFTER-FIX: orders par ab sirf ye triggers hone chahiye:
--        trg_auto_assign_delivery_on_pack   (AFTER UPDATE, packed-only)
--        trg_auto_assign_delivery_partner   (AFTER INSERT, packed-only)
--        trg_enforce_pack_first_gate        (BEFORE INSERT/UPDATE, hard guard)
--    - PRE-FIX CAPTURE: fix se pehle jo bhi trigger laga tha (rogue)
--      uska permanent record.
-- ===================================================
SELECT * FROM (
    SELECT
        'AFTER-FIX: orders par active trigger' AS section,
        t.tgname AS trigger_name,
        p.proname AS function_name,
        NULL::TIMESTAMPTZ AS captured_at
    FROM pg_trigger AS t
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.orders'::regclass
      AND NOT t.tgisinternal
    UNION ALL
    SELECT
        'PRE-FIX CAPTURE (audit table)',
        a.trigger_name,
        a.function_name,
        a.captured_at
    FROM public.order_flow_fix_audit AS a
) AS audit_report
ORDER BY section, trigger_name;

-- ===================================================
-- 8. FLOW TEST (RUN ke baad, SQL Editor me ye ek-ek karke chalao):
--
-- -- STEP 1: Naya order (store queue) — KOI delivery popup NAHI aana chahiye.
-- --   Expected: status='pending_assignment', delivery_boy_id=NULL
-- INSERT INTO public.orders (order_items, shipping_address, total_price, status)
-- VALUES ('[{"name":"Test Milk","quantity":1,"price":34,"productId":1}]'::jsonb,
--         '{"address":"FLOW TEST"}'::jsonb, 34, 'pending_assignment')
-- RETURNING id, status, delivery_boy_id;
-- -- (10-15 second ruko, phir wahi order dobara dekho — boy NULL hi rehna chahiye)
-- SELECT id, status, delivery_boy_id FROM public.orders WHERE id = <TEST_ORDER_ID>;
--
-- -- STEP 2: Store "Mark as Packed" — AB assign hona chahiye (delivery popup).
-- --   Expected: turant status='assigned' + delivery_boy_id set
-- UPDATE public.orders SET status = 'packed' WHERE id = <TEST_ORDER_ID>
-- RETURNING id, status, delivery_boy_id;
--
-- -- STEP 3: Rogue-style direct assign try karo (pack se pehle) — REVERT ho jana
-- --   chahiye (status wapas pending_assignment, boy NULL):
-- UPDATE public.orders SET status = 'assigned', delivery_boy_id = '00000000-0000-0000-0000-000000000000'
-- WHERE id = <NAYA_TEST_ORDER_ID_WITH_PENDING_STATUS>
-- RETURNING id, status, delivery_boy_id;
--
-- -- Cleanup: test orders delete karo
-- DELETE FROM public.orders WHERE id IN (<TEST_ORDER_ID>, <NAYA_TEST_ORDER_ID>);
-- ===================================================
