-- SuperCart multi-role authentication.
-- Run this once in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('customer', 'delivery', 'store_manager')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

INSERT INTO public.user_roles (user_id, role)
SELECT id, CASE
  WHEN role = 'delivery_partner' THEN 'delivery'
  WHEN role = 'store_manager' THEN 'store_manager'
  ELSE 'customer'
END
FROM public.users
WHERE role IS DISTINCT FROM 'admin'
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('customer', 'delivery_partner', 'store_manager') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, CASE WHEN NEW.role = 'delivery_partner' THEN 'delivery' ELSE NEW.role END)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_role_after_user_write ON public.users;
CREATE TRIGGER sync_user_role_after_user_write
  AFTER INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_role();

CREATE OR REPLACE FUNCTION public.has_role(uid UUID, requested_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT requested_role IN ('customer', 'delivery', 'store_manager')
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = uid AND role = requested_role
    );
$$;

REVOKE ALL ON FUNCTION public.has_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins read roles" ON public.user_roles;
DROP POLICY IF EXISTS "Clients write roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.prevent_client_role_changes()
RETURNS TRIGGER
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

CREATE OR REPLACE FUNCTION public.prevent_delivery_approval_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() AND auth.uid() IS NOT NULL
     AND NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    RAISE EXCEPTION 'Approval status is managed by admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_delivery_approval ON public.delivery_profiles;
CREATE TRIGGER protect_delivery_approval
  BEFORE UPDATE ON public.delivery_profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_delivery_approval_changes();

DROP POLICY IF EXISTS "Users read own delivery profile" ON public.delivery_profiles;
DROP POLICY IF EXISTS "Users update own delivery profile" ON public.delivery_profiles;
CREATE POLICY "Users read own delivery profile" ON public.delivery_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Users update own delivery profile" ON public.delivery_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

ALTER TABLE public.store_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clients write store links" ON public.store_staff;

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
