-- ============================================================================
-- SuperCart — RESTORE OLD AUTH (plain email / public.users.role)
-- ============================================================================
-- Reverts the multi-role / tagged-email system back to the 5abbc1a model:
--   * plain email, one normal Supabase account per email
--   * supabase.auth.signUp() writes public.users via the trigger
--   * role read from public.users.role
--
-- THIS FILE CONTAINS ONLY THE CHANGES, in one transaction. Read-only checks
-- live in supabase_restore_old_auth_00_checks.sql — run those FIRST, before
-- running this file.
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
-- 1. RESTORE ORIGINAL SIGNUP TRIGGER / FUNCTION (exactly as at 5abbc1a)
-- ---------------------------------------------------------------------------
-- role comes from user metadata but only 'customer' | 'delivery' can ever be
-- produced ('delivery_partner' -> 'delivery'); admin/store_manager metadata
-- falls back to 'customer'. Delivery users get a pending delivery_profiles row.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    account_name TEXT := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
    account_phone TEXT := COALESCE(NEW.raw_user_meta_data ->> 'phone', '');
    requested_role TEXT := COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer');
BEGIN
    INSERT INTO public.users (id, name, email, phone, role)
    VALUES (
      NEW.id,
      account_name,
      NEW.email,
      account_phone,
      CASE WHEN requested_role IN ('delivery', 'delivery_partner') THEN 'delivery' ELSE 'customer' END
    )
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone;

    IF requested_role IN ('delivery', 'delivery_partner') THEN
      INSERT INTO public.delivery_profiles (user_id, name, email, phone, approval_status, profile_completed)
      VALUES (NEW.id, account_name, NEW.email, account_phone, 'pending', false)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_supercart ON auth.users;
CREATE TRIGGER on_auth_user_created_supercart
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 2. REMOVE ROLE-SYSTEM-ONLY TRIGGERS / FUNCTIONS / POLICIES
-- ---------------------------------------------------------------------------
-- 2a. GUARD: abort the whole transaction if ANY function (including is_admin
--      / current_user_role), policy, or trigger still references the
--      role-system helpers. No CASCADE is used anywhere; the guard is what
--      prevents an accidental drop of something that is still in use.
DO $$
DECLARE
  usage_count integer;
BEGIN
  SELECT count(*) INTO usage_count
  FROM (
    -- any public function whose body mentions the role-system helpers,
    -- excluding the helpers themselves (the ones we are about to drop)
    SELECT proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND prosrc ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role|prevent_user_role_changes|prevent_client_role_changes'
      AND proname NOT IN ('has_role','panel_from_auth_email','assign_panel_role','sync_user_role','prevent_user_role_changes','prevent_client_role_changes')
    UNION ALL
    -- policies that reference the role-system helpers
    SELECT policyname FROM pg_policies
    WHERE coalesce(qual, '') ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role'
       OR coalesce(with_check, '') ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role'
    UNION ALL
    -- triggers that reference the role-system helpers
    SELECT t.tgname FROM pg_trigger t
    WHERE NOT t.tgisinternal
      AND (t.tgname IN ('sync_user_role_after_user_write', 'protect_user_role')
           OR pg_get_triggerdef(t.oid) ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role')
  ) refs;

  IF usage_count > 0 THEN
    RAISE EXCEPTION '[restore] Aborting: % object(s) still reference the role-system functions; review before proceeding.', usage_count;
  END IF;
END $$;

-- 2b. user_roles sync (from supabase_user_roles.sql)
DROP TRIGGER IF EXISTS sync_user_role_after_user_write ON public.users;
DROP FUNCTION IF EXISTS public.sync_user_role();

-- 2c. role-protection trigger + guard functions
DROP TRIGGER IF EXISTS protect_user_role ON public.users;
DROP FUNCTION IF EXISTS public.prevent_user_role_changes();
DROP FUNCTION IF EXISTS public.prevent_client_role_changes();

-- 2d. role helpers (from supabase_panel_identity_auth.sql / rebuild)
DROP FUNCTION IF EXISTS public.has_role(uuid, text);
DROP FUNCTION IF EXISTS public.assign_panel_role(uuid, text);
DROP FUNCTION IF EXISTS public.panel_from_auth_email(text);

-- 2e. restore the original users RLS policies (exactly as at 5abbc1a:
--      supabase_schema.sql + supabase_security_hardening.sql)
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
-- 3. ENSURE THE UNIQUE CONSTRAINTS THE REMAINING UPSERTS NEED
-- ---------------------------------------------------------------------------
-- Each upsert in the server code relies on one of these real keys:
--   * users.id
--   * delivery_profiles.user_id
--   * store_staff (store_id, user_id)
-- If duplicates exist (see 00_checks), the constraint for that table is
-- SKIPPED (nothing is deleted). The NOTICE reports the duplicate count.
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

COMMIT;

-- ============================================================================
-- End of restore. After this, verify with the read-only queries in
-- supabase_restore_old_auth_00_checks.sql (they are safe to run anytime).
-- ============================================================================
