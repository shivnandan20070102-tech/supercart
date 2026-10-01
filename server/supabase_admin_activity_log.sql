-- ===================================================
-- SUPERCART ADMIN ACTIVITY LOG
-- Copy & Paste this entire file into Supabase SQL Editor and click "RUN"
-- Ye script idempotent hai (dobara RUN karne par error nahi dega)
--
-- Admin ki important actions ka record:
--   approved_delivery_partner / rejected_delivery_partner /
--   deleted_store / deactivated_store / activated_store /
--   assigned_delivery_partner / unassigned_delivery_partner /
--   order_status_changed
-- Admin Panel ka "Activity Log" tab isi table se timeline dikhata hai.
-- ===================================================

CREATE TABLE IF NOT EXISTS public.admin_activity_log (
    id BIGSERIAL PRIMARY KEY,
    admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    target_id TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at
    ON public.admin_activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action_type
    ON public.admin_activity_log (action_type);

ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

-- Sirf Admin dekh sakta hai (existing admin-check pattern)
DROP POLICY IF EXISTS "Admins can read activity log" ON public.admin_activity_log;
CREATE POLICY "Admins can read activity log"
    ON public.admin_activity_log FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- Sirf Admin likh sakta hai (app client se insert isi se hota hai)
DROP POLICY IF EXISTS "Admins can write activity log" ON public.admin_activity_log;
CREATE POLICY "Admins can write activity log"
    ON public.admin_activity_log FOR INSERT TO authenticated
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- Realtime (Activity Log tab live update ke liye)
ALTER TABLE public.admin_activity_log REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'admin_activity_log'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_activity_log;
    END IF;
END $$;

-- ---------------------------------------------------
-- VERIFY (RUN ke baad Supabase me ye queries check karo)
-- ---------------------------------------------------
-- SELECT * FROM public.admin_activity_log ORDER BY created_at DESC LIMIT 10;
-- INSERT INTO public.admin_activity_log (action_type, target_id, description)
-- VALUES ('activated_store', '1', 'Test entry — delete me');
