-- Run manually in Supabase SQL Editor after reviewing the preview.
-- This removes all existing delivery accounts and their delivery profiles.
-- Customer/store accounts, stores, products, and orders are preserved.

BEGIN;

-- Review the rows that will be removed before running the DELETE.
SELECT au.id, au.email, u.role
FROM auth.users AS au
JOIN public.users AS u ON u.id = au.id
WHERE lower(u.role) IN ('delivery', 'delivery_partner');

-- Do not delete order history. Remove delivery assignment first.
UPDATE public.orders
SET delivery_boy_id = NULL
WHERE delivery_boy_id IN (
  SELECT au.id::text
  FROM auth.users AS au
  JOIN public.users AS u ON u.id = au.id
  WHERE lower(u.role) IN ('delivery', 'delivery_partner')
);

-- Auth deletion cascades to public.users and delivery_profiles.
DELETE FROM auth.users AS au
USING public.users AS u
WHERE u.id = au.id
  AND lower(u.role) IN ('delivery', 'delivery_partner');

COMMIT;
