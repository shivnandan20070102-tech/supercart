-- SuperCart AUTH + ROLE system rebuild.
-- Review this file before running it in the Supabase SQL Editor.
-- It is intentionally data-preserving: it never deletes users, orders, stores,
-- delivery profiles, staff links, or existing role rows.

BEGIN;

-- A shared email is allowed in multiple panel identities. Keep the display
-- email plain while Auth owns the tagged identity.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT lower(email) AS normalized_email
    FROM public.users
    WHERE email IS NOT NULL
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) duplicates;
  RAISE NOTICE 'Found % duplicate public.users email group(s); email uniqueness will be removed without deleting rows.', duplicate_count;
END $$;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key1;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_unique;

-- Refuse unsafe constraint changes rather than deleting duplicate records.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT id FROM public.users GROUP BY id HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Skipped users.id uniqueness because % duplicate id group(s) exist; no data was deleted.', duplicate_count;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
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
    SELECT user_id FROM public.delivery_profiles
    GROUP BY user_id HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Skipped delivery_profiles.user_id uniqueness because % duplicate group(s) exist; no data was deleted.', duplicate_count;
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

-- Existing installs use either store_staff or store_managers. Add the
-- one-to-one manager key only when the table exists and is already unambiguous.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  IF to_regclass('public.store_managers') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM (SELECT user_id FROM public.store_managers GROUP BY user_id HAVING count(*) > 1) d'
      INTO duplicate_count;
    IF duplicate_count > 0 THEN
      RAISE NOTICE 'Skipped store_managers.user_id uniqueness because % duplicate group(s) exist; no data was deleted.', duplicate_count;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE t.relname = 'store_managers'
          AND t.relnamespace = 'public'::regnamespace
          AND c.contype IN ('p', 'u')
          AND c.conkey = ARRAY[a.attnum]::smallint[]
          AND a.attname = 'user_id'
      ) THEN
        ALTER TABLE public.store_managers
          ADD CONSTRAINT store_managers_user_id_unique UNIQUE (user_id);
      END IF;
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
      RAISE NOTICE 'Skipped store_staff(store_id,user_id) uniqueness because % duplicate group(s) exist; no data was deleted.', duplicate_count;
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

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer', 'delivery', 'store_manager')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- user_roles may contain legacy multi-role rows. Preserve those rows and keep
-- its existing key shape; the server always writes (user_id, role).

-- Derive the panel only from the Auth email tag. raw_user_meta_data is never
-- consulted for authorization. app_metadata is writable only by trusted
-- Auth Admin calls and is used to distinguish server provisioning.
CREATE OR REPLACE FUNCTION public.panel_from_auth_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_email, '')) ~ '\+sc-delivery@' THEN 'delivery'
    WHEN lower(coalesce(p_email, '')) ~ '\+sc-store@' THEN 'store_manager'
    ELSE 'customer'
  END
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE (id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email'))
      AND lower(role) = 'admin'
  )
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  panel_role text := public.panel_from_auth_email(NEW.email);
  display_email text := lower(regexp_replace(coalesce(NEW.email, ''), '\+sc-(delivery|store)@', '@'));
  account_name text := coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
  account_phone text := coalesce(NEW.raw_user_meta_data ->> 'phone', '');
  server_provisioned boolean := coalesce(NEW.raw_app_meta_data ->> 'supercart_panel_provisioned', '') = 'true';
BEGIN
  IF panel_role <> 'customer' AND NOT server_provisioned THEN
    RAISE EXCEPTION 'Tagged panel identities must be provisioned by the SuperCart server';
  END IF;

  INSERT INTO public.users (id, name, email, phone, role)
  VALUES (NEW.id, account_name, display_email, account_phone, panel_role)
  ON CONFLICT (id) DO NOTHING;

  IF panel_role <> 'customer' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, panel_role)
    ON CONFLICT DO NOTHING;
  END IF;

  IF panel_role = 'delivery' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_profiles WHERE user_id = NEW.id
    ) THEN
      INSERT INTO public.delivery_profiles
        (user_id, name, email, phone, approval_status, profile_completed)
      VALUES (NEW.id, account_name, display_email, account_phone, 'pending', false);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_supercart ON auth.users;
CREATE TRIGGER on_auth_user_created_supercart
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.prevent_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    IF TG_OP <> 'UPDATE'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Role changes are managed by the server';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

DROP TRIGGER IF EXISTS protect_user_role ON public.users;
CREATE TRIGGER protect_user_role
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_user_role_changes();

CREATE OR REPLACE FUNCTION public.prevent_delivery_sensitive_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
       OR NEW.profile_completed IS DISTINCT FROM OLD.profile_completed
       OR NEW.home_store_id IS DISTINCT FROM OLD.home_store_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Delivery approval and assignment fields are managed by the server';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_delivery_sensitive_fields ON public.delivery_profiles;
CREATE TRIGGER protect_delivery_sensitive_fields
  BEFORE UPDATE ON public.delivery_profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_delivery_sensitive_changes();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Admins manage users" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = public.current_user_role());
CREATE POLICY "Admins manage users" ON public.users
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins read roles" ON public.user_roles;
DROP POLICY IF EXISTS "Clients write roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

ALTER TABLE public.delivery_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Delivery partners can read own profile" ON public.delivery_profiles;
DROP POLICY IF EXISTS "Users read own delivery profile" ON public.delivery_profiles;
DROP POLICY IF EXISTS "Delivery partners can insert own profile" ON public.delivery_profiles;
DROP POLICY IF EXISTS "Delivery partners can update own profile" ON public.delivery_profiles;
DROP POLICY IF EXISTS "Users update own delivery profile" ON public.delivery_profiles;
DROP POLICY IF EXISTS "Admins can read delivery profiles" ON public.delivery_profiles;
DROP POLICY IF EXISTS "Admins can update delivery profile approval" ON public.delivery_profiles;
CREATE POLICY "Delivery partners can read own profile" ON public.delivery_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Delivery partners can insert own profile" ON public.delivery_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Delivery partners can update own profile" ON public.delivery_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

COMMIT;
