-- ===================================================
-- SUPERCART AUTO-ASSIGN DELIVERY PARTNER (DB TRIGGER) — FINAL FLOW
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- (ek baar run kaafi hai, bar-bar nahi)
-- Project: eagwchutdhtgioujetag
--
-- FINAL FLOW: Customer -> nearest store -> store PACKED kare TABHI assign.
-- 'packed' status me INSERT hote hi automatically:
--   1. is_available = true (Online) + verified delivery partners me se
--      BUSY partners hatao (jinke paas pehle se koi active/non-terminal order hai)
--   2. HOME-FIRST: pehle us store ke home_store_id wale FREE partners me se
--      sabse NAZDEEK (Haversine) choose hota hai; aisa koi free home partner
--      na ho to TABHI fallback — bache sabhi FREE partners me se ORDER WALE
--      STORE ka sabse NAZDEEK partner (users.current_lat/current_lng vs
--      stores lat/lng, Haversine; nearly-same-location tie me random).
--      Busy rider chahe paas ho tab bhi excluded. Location/store-coords na
--      hon to existing random rule fallback hai.
--   3. orders.delivery_boy_id = partner id, orders.status = 'assigned'
--
-- NOTE: Partner ka Online/Offline status (is_available) yahan HAATH NAHI
-- lagta — wo SIRF partner ke apne toggle ya Admin toggle se badalta hai.
-- is_available sirf eligibility check (kaun Online hai) ke liye padha jata hai.
--
-- PACKED-gate: 'pending_assignment' / 'Placed' / 'pending' INSERT par trigger
-- kuch nahi karta (store queue — pack hona baaki). Normal flow me order
-- 'pending_assignment' insert hota hai, store markOrderPacked par 'packed'
-- banta hai aur Node backend turant assign karta hai.
-- Koi eligible partner na mile to order 'packed' (unassigned) hi rehta hai —
-- 30s worker / retry agle FREE partner par dega.
-- ===================================================

-- 0. Safety: orders table me trigger ke liye chahiye columns pakke karo
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_boy_id TEXT;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS rejected_by JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Placed';

-- 1. Delivery partner flags (idempotent: dobara RUN karna safe hai)
--    public.users hi canonical table hai (role = 'delivery' / 'delivery_partner').
--    delivery_profiles me bhi same flags sync rakhe jaate hain taaki
--    Admin/Delivery dashboard dono jagah consistent dikhe.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.delivery_profiles
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

-- 2. Fast lookup ke liye partial index (sirf delivery roles par)
CREATE INDEX IF NOT EXISTS idx_users_delivery_auto_assign
    ON public.users (role, verified, is_available)
    WHERE role IN ('delivery', 'delivery_partner');

-- FINAL FLOW: Customer -> nearest store -> store PACKED kare TABHI assign.
-- Ye trigger sirf 'packed' INSERT par assign karta hai.
-- 'pending_assignment' / 'Placed' / 'pending' store queue hai — PACKED se
-- pehle inhe chhoona spec violation hai, isliye turant RETURN.
-- (Normal flow me order 'pending_assignment' insert hota hai, store
-- markOrderPacked par 'packed' banta hai aur Node backend turant assign
-- karta hai; ye trigger direct-DB 'packed' insert ka backup hai.)
-- 3. Core function: nearest eligible partner uthao + assign karo
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
    -- (Admin ne manual assign kiya ho, ya retry insert ho.)
    IF NEW.delivery_boy_id IS NOT NULL AND NEW.delivery_boy_id <> '' THEN
        RETURN NEW;
    END IF;

    -- Geo data uplabdh hai? (rider-location migration + multi-store tables)
    -- Nahi ho to neeche purana random rule chalta hai — trigger kabhi fail nahi.
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

    -- home_store_id column (delivery_profiles) migration se pehle bani ho to
    -- hi home preference lagegi — warna purana behaviour (kabhi fail nahi).
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
          AND column_name = 'home_store_id'
    ) INTO has_home;

    -- STEP 1+2: FREE partners (verified + available + koi active order nahi)
    -- me se ORDER WALE STORE ka sabse NAZDEEK partner (Haversine, km).
    --  - BUSY RULE: jiske paas pehle se koi active (non-terminal status wala)
    --    order hai, use skip karo — sirf FREE boys eligible hain.
    --  - rejected_by me jo partner pehle reject kar chuka, use exclude karo.
    --  - Bina location wala rider sabse peeche (NULLS LAST), lekin eligible.
    --  - Nearly-same-location tie me random (RANDOM() second key hai).
    --  - FOR UPDATE ... SKIP LOCKED: 2 orders same second me aayein to
    --    dono ek hi partner ko lock na karein (race-condition safe).
    -- HOME-FIRST: order wale store ke home_store_id wale FREE partners pehle
    -- (Online + verified + koi active order nahi + reject nahi + home match).
    -- Koi free home partner na ho to chosen NULL rehta hai aur neeche purana
    -- fallback (sabhi FREE partners me se nearest) chalta hai.
    -- EXCEPTION guard: kuch bhi gadbad ho to fallback sambhal lega —
    -- trigger kabhi fail nahi karega (checkout safe).
    IF has_home AND NEW.store_id IS NOT NULL THEN
        BEGIN
            IF has_geo THEN
                SELECT u.id INTO chosen_partner_id
                FROM public.users AS u
                LEFT JOIN public.stores AS s ON s.id = NEW.store_id
                WHERE u.role IN ('delivery', 'delivery_partner')
                  AND COALESCE(u.verified, false) = true
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
                  AND COALESCE(u.verified, false) = true
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

    -- Fallback (purana rule): home se koi na mila to sabhi FREE partners me se nearest.
    IF chosen_partner_id IS NULL THEN
      IF has_geo THEN
        SELECT u.id INTO chosen_partner_id
        FROM public.users AS u
        LEFT JOIN public.stores AS s ON s.id = NEW.store_id
        WHERE u.role IN ('delivery', 'delivery_partner')
          AND COALESCE(u.verified, false) = true
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
          AND COALESCE(u.verified, false) = true
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
    END IF; -- fallback wrapper (home-first ke baad)

    -- Koi eligible partner nahi mila -> order 'Placed' hi rehne do,
    -- Admin baad me manually assign kar dega. Error kabhi throw mat karo
    -- taaki checkout flow kabhi fail na ho.
    IF chosen_partner_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- STEP 3: Order par deliveryBoyId + status = 'assigned' set karo.
    -- AFTER INSERT trigger hai isliye NEW ko mutate karne ke bajaye UPDATE karte hain.
    -- Guard clause: sirf abhi-bhi-unassigned order ko touch karo.
    -- (Partner ka is_available touch NAHI hota — manual presence waisa hi rehta hai.)
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

-- 4. Trigger: har naye order par function chalao (UPDATE par nahi, taaki loop na bane)
DROP TRIGGER IF EXISTS trg_auto_assign_delivery_partner ON public.orders;
CREATE TRIGGER trg_auto_assign_delivery_partner
    AFTER INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.auto_assign_delivery_partner();

-- ===================================================
-- VERIFY (optional, RUN ke baad alag se chalao):
--
-- -- Columns bane?
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'users'
--   AND column_name IN ('verified', 'is_available');
--
-- -- Trigger laga?
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'orders'
--   AND trigger_name = 'trg_auto_assign_delivery_partner';
--
-- -- Test data: 2 dummy available-verified partners
-- -- (Apne real partner UUIDs se replace karo)
-- -- UPDATE public.users SET verified = true, is_available = true
-- -- WHERE id IN ('<partner-uuid-1>', '<partner-uuid-2>');
--
-- -- Test order: insert karte hi delivery_boy_id + status='assigned' dikhna chahiye
-- -- INSERT INTO public.orders (order_items, shipping_address, total_price)
-- -- VALUES ('[{"name":"Test Milk","quantity":1,"price":34}]'::jsonb, '{"address":"Test"}'::jsonb, 34)
-- -- RETURNING id, status, delivery_boy_id;
-- ===================================================
