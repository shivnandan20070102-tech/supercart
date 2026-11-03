-- ============================================================================
-- SuperCart — ROLLBACK for supabase_restore_old_auth.sql
-- ============================================================================
-- Re-applies the multi-role / tagged-email role system schema objects
-- (the opposite of the restore script).
--
-- SAFETY:
--   * NO DELETE / TRUNCATE / DROP TABLE anywhere.
--   * Does NOT remove rows. In particular the store_staff links added by the
--     restore script are KEPT (they are data). If you truly want to undo those
--     links you must do that by hand per row AFTER this script, and only if
--     the manager genuinely should not be linked.
--   * Idempotent: safe to run more than once.
--   * Wrapped in a transaction.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RESTORE TAGGED-EMAIL SIGNUP TRIGGER / FUNCTION
-- ---------------------------------------------------------------------------
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

-- Read-only: verify what triggers currently sit on auth.users (tgname + function).
SELECT t.tgname, p.proname AS function_name, t.tgenabled
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- ---------------------------------------------------------------------------
-- 2. RESTORE ROLE-SYSTEM TRIGGERS / FUNCTIONS / POLICIES
-- ---------------------------------------------------------------------------

-- 2a. user_roles sync
CREATE OR REPLACE FUNCTION public.sync_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, NEW.role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_user_role_after_user_write ON public.users;
CREATE TRIGGER sync_user_role_after_user_write
  AFTER INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_role();

-- 2b. role-protection trigger + guard function (matches supabase_user_roles.sql)
CREATE OR REPLACE FUNCTION public.prevent_client_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'Role changes are managed by the server';
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Role changes are managed by the server';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_user_role ON public.users;
CREATE TRIGGER protect_user_role
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_role_changes();

-- 2c. role helpers
CREATE OR REPLACE FUNCTION public.has_role(uid uuid, requested_role text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid AND role = requested_role
  );
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_panel_role(target_user_id uuid, target_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_role NOT IN ('customer', 'delivery', 'store_manager') THEN
    RAISE EXCEPTION 'invalid panel role';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, target_role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_panel_role(uuid, text) FROM PUBLIC;

-- 2d. role-era users RLS policies
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = public.current_user_role());
CREATE POLICY "Admins manage users" ON public.users
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMIT;

-- ============================================================================
-- End of rollback.
-- ============================================================================
