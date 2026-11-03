-- ============================================================================
-- SuperCart — FIX DELIVERY SIGNUP + MANAGER CREATION CONSTRAINTS
-- ============================================================================
-- Fixes two related failures:
--   1. Admin "Create manager account" → "there is no unique or exclusion
--      constraint matching the ON CONFLICT specification". The server's
--      store_staff upsert (onConflict 'store_id,user_id') requires a UNIQUE
--      constraint on (store_id, user_id) that is missing on the live DB.
--   2. Delivery partner signup → generic "Account could not be created."
--      The auth trigger's upserts rely on UNIQUE(id) / UNIQUE(user_id) —
--      guaranteed by PKs — but we also harden the trigger so a profile
--      conflict never aborts the whole signup.
--
-- SAFETY:
--   * NO DELETE / TRUNCATE / DROP TABLE anywhere.
--   * Does NOT touch users / auth.users / delivery_profiles / store_staff
--     row data. Admin accounts are never modified.
--   * Constraint creation is guarded: if duplicates exist (nothing is
--     deleted), the constraint is SKIPPED and a NOTICE is raised.
--   * Idempotent — safe to re-run. Wrapped in a transaction.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. GUARANTEE the unique constraints the upserts rely on
-- ---------------------------------------------------------------------------

-- 1a. public.users.id (primary key / used by onConflict 'id')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'users' AND t.relnamespace = 'public'::regnamespace
      AND c.contype IN ('p','u')
      AND a.attname = 'id'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_id_unique UNIQUE (id);
  END IF;
END $$;

-- 1b. public.delivery_profiles.user_id (onConflict 'user_id')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'delivery_profiles' AND t.relnamespace = 'public'::regnamespace
      AND c.contype IN ('p','u')
      AND a.attname = 'user_id'
  ) THEN
    ALTER TABLE public.delivery_profiles
      ADD CONSTRAINT delivery_profiles_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- 1c. public.store_staff (store_id, user_id) — the manager-creation upsert key.
--      Added ONLY if no duplicate (store_id, user_id) pairs exist.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  IF to_regclass('public.store_staff') IS NULL THEN
    RAISE NOTICE '[fix] store_staff table does not exist; skipping store constraint.';
    RETURN;
  END IF;
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT store_id, user_id FROM public.store_staff
    GROUP BY store_id, user_id HAVING count(*) > 1
  ) d;
  IF duplicate_count > 0 THEN
    RAISE NOTICE '[fix] SKIPPED store_staff(store_id,user_id) UNIQUE because % duplicate pair(s) exist; no data deleted. Resolve duplicates manually to enable the constraint.', duplicate_count;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.store_staff'::regclass
      AND c.contype IN ('p','u')
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.store_staff'::regclass AND attname = 'store_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.store_staff'::regclass AND attname = 'user_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE public.store_staff
      ADD CONSTRAINT store_staff_store_user_unique UNIQUE (store_id, user_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. HARDEN the auth signup trigger. The profile upsert already uses
--      ON CONFLICT (user_id) DO NOTHING, so a duplicate profile row can
--      never abort signup. This just re-asserts the safe version.
-- ---------------------------------------------------------------------------
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

COMMIT;
