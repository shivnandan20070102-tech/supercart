-- SUPERCART SECURITY HARDENING
-- Run once in Supabase SQL Editor, then verify with the checks at the bottom.
-- This removes the public users policy and prevents role escalation.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users read rider locations" ON public.users;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Admins manage users" ON public.users;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

CREATE POLICY "Users can read own profile"
ON public.users
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
ON public.users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND role = public.current_user_role()
);

CREATE POLICY "Admins manage users"
ON public.users
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- The backend uses the service-role key for rider assignment. No authenticated
-- user gets a blanket users-table policy for live rider locations.

-- Verify there is no permissive users policy left:
-- SELECT policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'users';

-- Verify anonymous access returns no rows:
-- SET ROLE anon;
-- SELECT * FROM public.users;
-- RESET ROLE;
