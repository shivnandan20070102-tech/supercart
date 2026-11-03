-- ============================================================================
-- SuperCart — RESTORE OLD AUTH (plain email / public.users.role)
-- ============================================================================
-- Reverts the multi-role / tagged-email system (commits 6672aa6..b9e117b)
-- back to the working 5abbc1a model:
--   * plain email, one normal Supabase account per email
--   * supabase.auth.signUp() writes public.users via the trigger
--   * role read from public.users.role
--
-- SAFETY:
--   * NO DELETE / TRUNCATE / DROP TABLE anywhere.
--   * Does NOT touch users, auth.users, user_roles, delivery_profiles,
--     store_staff row data. The user_roles TABLE is kept (just no longer used).
--   * Idempotent: safe to run more than once.
--   * Wrapped in a transaction.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. READ-ONLY DUPLICATE CHECKS (run these first, before anything else)
-- ---------------------------------------------------------------------------
-- These only report; they delete nothing. If any count is > 0, the matching
-- UNIQUE constraint below is SKIPPED (the app still works; the upsert that
-- needs the constraint may error until duplicates are resolved manually).
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT id FROM public.users GROUP BY id HAVING count(*) > 1
  ) d;
  RAISE NOTICE '[restore] users.id duplicate groups: %', n;
END $$;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT user_id FROM public.delivery_profiles GROUP BY user_id HAVING count(*) > 1
  ) d;
  RAISE NOTICE '[restore] delivery_profiles.user_id duplicate groups: %', n;
END $$;

DO $$
DECLARE
  n integer;
BEGIN
  IF to_regclass('public.store_staff') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM (SELECT store_id, user_id FROM public.store_staff GROUP BY store_id, user_id HAVING count(*) > 1) d'
      INTO n;
    RAISE NOTICE '[restore] store_staff(store_id,user_id) duplicate groups: %', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. RESTORE ORIGINAL SIGNUP TRIGGER / FUNCTION (exactly as at 5abbc1a)
-- ---------------------------------------------------------------------------
-- Plain email. Role defaults to 'customer'. Metadata role is NOT consulted.
-- The trigger writes the new auth user into public.users keyed by auth user id.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    account_role TEXT := 'customer';
    account_name TEXT := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
    account_phone TEXT := COALESCE(NEW.raw_user_meta_data ->> 'phone', '');
BEGIN
    INSERT INTO public.users (id, name, email, phone, role)
    VALUES (NEW.id, account_name, NEW.email, account_phone, account_role)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, role = EXCLUDED.role;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_supercart ON auth.users;
CREATE TRIGGER on_auth_user_created_supercart
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Read-only: verify what triggers currently sit on auth.users (tgname + function).
SELECT t.tgname, p.proname AS function_name, t.tgenabled
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

UPDATE public.users
SET role = 'customer'
WHERE role IS NULL;

-- ---------------------------------------------------------------------------
-- 3. REMOVE ROLE-SYSTEM-ONLY TRIGGERS / FUNCTIONS / POLICIES
-- ---------------------------------------------------------------------------
-- These exist only in the tagged-email role system. Each is dropped with
-- IF EXISTS so the script is idempotent. Nothing else references them after
-- this block. Delivery objects are NOT touched here.

-- 3a. user_roles sync (from supabase_user_roles.sql)
DROP TRIGGER IF EXISTS sync_user_role_after_user_write ON public.users;
DROP FUNCTION IF EXISTS public.sync_user_role();

-- 3b. role-protection trigger + guard functions (protect_user_role)
DROP TRIGGER IF EXISTS protect_user_role ON public.users;
DROP FUNCTION IF EXISTS public.prevent_user_role_changes();
DROP FUNCTION IF EXISTS public.prevent_client_role_changes();

-- 3c. role helpers (from supabase_panel_identity_auth.sql / rebuild)
--
-- READ-ONLY usage check BEFORE dropping (no CASCADE): does any policy or
-- trigger still reference the role-system functions? If rows come back, review
-- them before continuing; nothing below forces a drop with CASCADE.
SELECT p.schemaname, p.tablename, p.policyname,
       NULLIF(p.qual, '') AS qual, NULLIF(p.with_check, '') AS with_check
FROM pg_policies p
WHERE coalesce(p.qual, '') ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role'
   OR coalesce(p.with_check, '') ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role';

SELECT t.tgname,
       t.tgrelid::regclass AS on_table,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
WHERE NOT t.tgisinternal
  AND (t.tgname IN ('sync_user_role_after_user_write', 'protect_user_role')
       OR pg_get_triggerdef(t.oid) ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role');

DROP FUNCTION IF EXISTS public.has_role(uuid, text);
DROP FUNCTION IF EXISTS public.assign_panel_role(uuid, text);
DROP FUNCTION IF EXISTS public.panel_from_auth_email(text);

-- 3d. restore the original users RLS policies (5abbc1a)
DROP POLICY IF EXISTS "Admins manage users" ON public.users;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
    FOR SELECT TO authenticated
    USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (
      id = auth.uid()
      AND role = public.current_user_role()
    );
CREATE POLICY "Admins manage users" ON public.users
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. ENSURE THE UNIQUE CONSTRAINTS THE REMAINING UPSERTS NEED
-- ---------------------------------------------------------------------------
-- Each upsert in the server code relies on one of these real keys:
--   * users.id
--   * delivery_profiles.user_id
--   * store_staff (store_id, user_id)   [already in the table definition]
-- If duplicates exist, the constraint for that table is SKIPPED (nothing is
-- deleted). The NOTICE above reports the duplicate count so you can fix it.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT id FROM public.users GROUP BY id HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE NOTICE '[restore] Skipped users.id UNIQUE because % duplicate id group(s) exist; no data deleted.', duplicate_count;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      WHERE t.relname = 'users'
        AND t.relnamespace = 'public'::regnamespace
        AND c.contype IN ('p', 'u')
        AND c.conkey = ARRAY[a.attnum]::smallint[]
        AND a.attname = 'id'
    ) THEN
      ALTER TABLE public.users ADD CONSTRAINT users_id_unique UNIQUE (id);
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT user_id FROM public.delivery_profiles GROUP BY user_id HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE NOTICE '[restore] Skipped delivery_profiles.user_id UNIQUE because % duplicate group(s) exist; no data deleted.', duplicate_count;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      WHERE t.relname = 'delivery_profiles'
        AND t.relnamespace = 'public'::regnamespace
        AND c.contype IN ('p', 'u')
        AND c.conkey = ARRAY[a.attnum]::smallint[]
        AND a.attname = 'user_id'
    ) THEN
      ALTER TABLE public.delivery_profiles
        ADD CONSTRAINT delivery_profiles_user_id_unique UNIQUE (user_id);
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  IF to_regclass('public.store_staff') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM (SELECT store_id, user_id FROM public.store_staff GROUP BY store_id, user_id HAVING count(*) > 1) d'
      INTO duplicate_count;
    IF duplicate_count > 0 THEN
      RAISE NOTICE '[restore] Skipped store_staff(store_id,user_id) UNIQUE because % duplicate group(s) exist; no data deleted.', duplicate_count;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.store_staff'::regclass
          AND c.contype IN ('p', 'u')
          AND c.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid = 'public.store_staff'::regclass AND attname = 'store_id'),
            (SELECT attnum FROM pg_attribute
             WHERE attrelid = 'public.store_staff'::regclass AND attname = 'user_id')
          ]::smallint[]
      ) THEN
        ALTER TABLE public.store_staff
          ADD CONSTRAINT store_staff_store_user_unique UNIQUE (store_id, user_id);
      END IF;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. READ-ONLY: STORE MANAGERS WITH NO store_staff LINK
-- ---------------------------------------------------------------------------
-- Shows which store_manager users have no store_staff row yet.
-- No INSERT here — re-linking is intentional and done by hand after you have
-- reviewed this list (id, email, name).
SELECT m.id, m.email, m.name
FROM public.users m
WHERE lower(m.role) = 'store_manager'
  AND NOT EXISTS (
    SELECT 1 FROM public.store_staff st WHERE st.user_id = m.id
  )
ORDER BY m.name;

COMMIT;

-- ============================================================================
-- End of restore. Read-only verification queries (safe to run anytime):
--   SELECT id, email, role FROM public.users ORDER BY created_at DESC LIMIT 20;
--   SELECT * FROM public.store_staff;
-- ============================================================================
