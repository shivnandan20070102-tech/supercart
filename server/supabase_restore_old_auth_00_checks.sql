-- ============================================================================
-- SuperCart — RESTORE OLD AUTH: READ-ONLY CHECKS (run BEFORE any change)
-- ============================================================================
-- This file contains ONLY read-only SELECTs. It changes nothing, has no
-- BEGIN/COMMIT, and is safe to run anytime.
--
-- Supabase SQL Editor shows only the LAST result, so run each query
-- separately. Grep for the expected outcome above each query.
-- ============================================================================

-- (i) Duplicate checks for the keys the upserts rely on.
--      Each query returns rows ONLY when duplicates exist. If any returns
--      rows, the matching UNIQUE constraint is skipped by the restore script
--      (nothing is deleted), so resolve duplicates manually before relying on
--      that upsert.
SELECT id, count(*) AS n
FROM public.users
GROUP BY id
HAVING count(*) > 1;

SELECT user_id, count(*) AS n
FROM public.delivery_profiles
GROUP BY user_id
HAVING count(*) > 1;

SELECT store_id, user_id, count(*) AS n
FROM public.store_staff
GROUP BY store_id, user_id
HAVING count(*) > 1;

-- (ii) Any public function whose body still mentions the role-system helpers.
--      Expected (during restore): the role-system helpers themselves, and NO
--      other functions. If a function like is_admin / current_user_role shows
--      up here, the restore guard will abort — review before proceeding.
SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosrc ~ 'has_role|user_roles|panel_from_auth_email|assign_panel_role';

-- (iii) Tagged-email accounts that would be created/used by the old role
--       system. Expected when restoring: zero rows (or rows you knowingly
--       want to stop using). None are deleted by the restore.
SELECT id, email
FROM auth.users
WHERE email ~* '\+sc-(delivery|store)@';

-- (iv) public.users rows with a NULL role (the restore does NOT touch these;
--       they are listed here for your awareness only).
SELECT id, email
FROM public.users
WHERE role IS NULL;

-- (v) Full definitions of is_admin() and current_user_role() so you can see
--      what the restore keeps (these are the original 5abbc1a functions).
SELECT proname, pg_get_functiondef(oid)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('is_admin', 'current_user_role');

-- (vi) Policies that reference the role-system helpers. Expected during
--       restore: zero rows. If rows appear, review them before running the
--       restore (the restore will abort if any non-helper object refers to
--       these function names).
SELECT p.schemaname, p.tablename, p.policyname,
       NULLIF(p.qual, '') AS qual,
       NULLIF(p.with_check, '') AS with_check
FROM pg_policies p
WHERE coalesce(p.qual, '') ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role'
   OR coalesce(p.with_check, '') ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role';

-- (vi continued) Triggers that reference the role-system helpers.
--      Expected during restore: the two triggers the restore drops WILL appear
--      here — sync_user_role_after_user_write and protect_user_role. Any OTHER
--      trigger appearing here needs review before running the restore.
SELECT t.tgname,
       t.tgrelid::regclass AS on_table,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
WHERE NOT t.tgisinternal
  AND (t.tgname IN ('sync_user_role_after_user_write', 'protect_user_role')
       OR pg_get_triggerdef(t.oid) ~ 'has_role|panel_from_auth_email|assign_panel_role|sync_user_role');

-- (vii) store_manager users that have NO store_staff link yet. The restore
--       script does NOT link them (read-only). If you want managers linked,
--       do it by hand after reviewing this list (id, email, name).
SELECT m.id, m.email, m.name
FROM public.users m
WHERE lower(m.role) = 'store_manager'
  AND NOT EXISTS (
    SELECT 1 FROM public.store_staff st WHERE st.user_id = m.id
  )
ORDER BY m.name;

-- (extra) Currently active non-internal triggers on auth.users
--         (tgname + function + enabled state).
SELECT t.tgname, p.proname AS function_name, t.tgenabled
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;
