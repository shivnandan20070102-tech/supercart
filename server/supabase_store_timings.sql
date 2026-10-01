-- ===================================================
-- SUPERCART STORE TIMINGS (Opening / Closing Time)
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Ye script idempotent hai (dobara RUN karne par error nahi dega)
--
-- Adds:
--  1. stores.opening_time  (TIME, nullable — NULL = time limit nahi)
--  2. stores.closing_time  (TIME, nullable — NULL = time limit nahi)
--  3. get_nearest_active_stores() me naye columns (backward compatible)
-- ===================================================

-- ---------------------------------------------------
-- 1. COLUMNS
-- TIME type: Admin "HH:MM" bhejega (input type="time"),
-- Supabase usko TIME me store karega ("HH:MM:SS").
-- Dono NULL allowed taaki purane stores bina timing ke bhi chalein
-- (un par Store Panel me koi "band hai" banner nahi dikhega).
-- ---------------------------------------------------
ALTER TABLE public.stores
    ADD COLUMN IF NOT EXISTS opening_time TIME;

ALTER TABLE public.stores
    ADD COLUMN IF NOT EXISTS closing_time TIME;

-- ---------------------------------------------------
-- 2. HELPER: kya store abhi khula hai?
-- Usage:
--   SELECT public.is_store_open_now('09:00', '21:00');
--   SELECT id, store_name, public.is_store_open_now(opening_time, closing_time) AS open_now
--   FROM public.stores;
--
-- Rules:
--  - Dono me se koi ek NULL ho to NULL (matlab: timing set nahi = hamesha khula mano)
--  - opening == closing ho to 24 ghante khula mano
--  - Raat-bhar wali range (22:00-06:00) bhi handle hoti hai
-- NOTE: ye function server ka time (now()) use karta hai.
-- Store Panel banner client ke local time par bhi independently calculate
-- hota hai, taaki timezone mismatch par bhi sahi dikhe.
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_store_open_now(
    p_opening TIME,
    p_closing TIME,
    p_now TIME DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_now TIME := COALESCE(p_now, (now() AT TIME ZONE 'Asia/Kolkata')::TIME);
BEGIN
    -- Timing set nahi = hamesha khula
    IF p_opening IS NULL OR p_closing IS NULL THEN
        RETURN NULL;
    END IF;

    -- 24 ghante khula (09:00-09:00 jaisi setting)
    IF p_opening = p_closing THEN
        RETURN TRUE;
    END IF;

    -- Same-day range: 09:00-21:00
    IF p_opening < p_closing THEN
        RETURN (v_now >= p_opening AND v_now < p_closing);
    END IF;

    -- Overnight range: 22:00-06:00
    RETURN (v_now >= p_opening OR v_now < p_closing);
END;
$$;

-- ---------------------------------------------------
-- 3. get_nearest_active_stores(): naye columns ke saath
-- NOTE: return type badal raha hai (7 cols -> 10 cols), isliye
-- CREATE OR REPLACE kaam nahi karega (ERROR 42P13). Pehle DROP zaroori hai.
-- ---------------------------------------------------
DROP FUNCTION IF EXISTS public.get_nearest_active_stores(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER);

CREATE FUNCTION public.get_nearest_active_stores(
    customer_lat DOUBLE PRECISION,
    customer_lon DOUBLE PRECISION,
    limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
    id BIGINT,
    store_name TEXT,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    contact_number TEXT,
    distance_km DOUBLE PRECISION,
    opening_time TIME,
    closing_time TIME,
    open_now BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        s.id,
        s.store_name,
        s.address,
        s.latitude,
        s.longitude,
        s.contact_number,
        public.calculate_distance_km(customer_lat, customer_lon, s.latitude, s.longitude) AS distance_km,
        s.opening_time,
        s.closing_time,
        public.is_store_open_now(s.opening_time, s.closing_time) AS open_now
    FROM public.stores s
    WHERE s.is_active = true
    ORDER BY distance_km ASC
    LIMIT limit_count;
$$;

-- ---------------------------------------------------
-- VERIFY (RUN ke baad Supabase me ye queries check karo)
-- ---------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'stores' AND column_name IN ('opening_time','closing_time');
-- SELECT id, store_name, opening_time, closing_time,
--        public.is_store_open_now(opening_time, closing_time) AS open_now
-- FROM public.stores;
-- UPDATE public.stores SET opening_time = '09:00', closing_time = '21:00' WHERE id = 1;
