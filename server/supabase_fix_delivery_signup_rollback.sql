-- ============================================================================
-- SuperCart — ROLLBACK for supabase_fix_delivery_signup.sql
-- ============================================================================
-- Reverts the constraint additions from the fix script. It does NOT delete or
-- alter any row data, and it preserves the hardened trigger (which is safe and
-- matches the plain-email auth model). The store_staff constraint is dropped
-- only if it was added by the fix script.
--
-- SAFETY:
--   * NO DELETE / TRUNCATE / DROP TABLE / user-data changes anywhere.
--   * Idempotent — safe to re-run. Wrapped in a transaction.
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_id_unique;

ALTER TABLE public.delivery_profiles
  DROP CONSTRAINT IF EXISTS delivery_profiles_user_id_unique;

ALTER TABLE public.store_staff
  DROP CONSTRAINT IF EXISTS store_staff_store_user_unique;

COMMIT;
