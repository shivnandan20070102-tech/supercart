-- ===================================================
-- SUPERCART RIDER LIVE LOCATION (nearest-store assignment ke liye)
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Project: eagwchutdhtgioujetag
-- (ek baar run kaafi hai, dobara RUN karna safe hai)
--
-- PROBLEM: delivery boy ki live latitude/longitude kahin persist nahi hoti
-- thi (sirf app-memory me map ke liye), isliye "store ke sabse nazdeek
-- FREE rider" chuna hi nahi ja sakta tha — assignment RANDOM tha.
--
-- YE FILE: public.users me 3 columns jodti hai (users table hi assignment
-- eligibility ki canonical table hai — role/verified/is_available wahin se
-- padhe jate hain, aur backend anon-key se wahi table readable hai):
--   current_lat / current_lng  = rider ki latest GPS position
--   location_updated_at        = kab update hui
--
-- - Delivery app apni khud ki row update karta hai (throttled, ~30s/100m).
-- - Backend assignment inhe padhkar nearest eligible rider chunta hai.
-- - Location na ho (permission denied / purana app) to assignment phir bhi
--   kaam karta hai — existing random rule fallback hai (order kabhi stuck nahi).
-- - users par RLS policy pehle se open hai ("Allow public access on users"),
--   isliye koi nayi policy nahi chahiye. is_available/verified ko ye file
--   haath nahi lagati.
-- ===================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- Fast lookup (sirf located riders par)
CREATE INDEX IF NOT EXISTS idx_users_rider_location
    ON public.users (current_lat, current_lng)
    WHERE role IN ('delivery', 'delivery_partner');

-- Realtime publication (location update turant sabko dikhe)
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
END $$;

-- ===================================================
-- VERIFY (optional, RUN ke baad alag se chalao):
--
-- -- Columns bane?
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'users'
--   AND column_name IN ('current_lat', 'current_lng', 'location_updated_at');
--
-- -- Kis rider ki location kab aayi?
-- SELECT id, name, current_lat, current_lng, location_updated_at
-- FROM public.users
-- WHERE role IN ('delivery', 'delivery_partner')
-- ORDER BY location_updated_at DESC NULLS LAST LIMIT 20;
-- ===================================================
