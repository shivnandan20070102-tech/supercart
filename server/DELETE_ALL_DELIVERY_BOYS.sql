-- ============================================================================
--  SuperCart — DELETE ALL EXISTING DELIVERY BOY ACCOUNTS (fresh start)
-- ============================================================================
--  Ye script SIRF delivery boy/delivery partner accounts delete karti hai.
--  Customer/store accounts, stores, products, aur order history SAFE rehte hain.
--  Order history me delivery_boy_id null kar diya jata hai (FK nahi hai).
--
--  KAISE CHALAYE:
--    1. Supabase Dashboard kholo (https://supabase.com/dashboard)
--    2. Apna project kholo
--    3. Left sidebar se "SQL Editor" kholo
--    4. Poora content paste karo
--    5. "RUN" button dabao
--    6. Preview me count check karo -> confirm karo
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
--  STEP 1 — PREVIEW (sirf dekhne ke liye, kuch delete nahi hota)
--  Ye dikhayega kitne delivery accounts delete honge aur kaunse.
-- ---------------------------------------------------------------------------
SELECT au.id, au.email, u.role, dp.name AS delivery_name
FROM auth.users AS au
JOIN public.users AS u ON u.id = au.id
LEFT JOIN public.delivery_profiles AS dp ON dp.user_id = au.id
WHERE lower(u.role) IN ('delivery', 'delivery_partner');

-- ---------------------------------------------------------------------------
--  STEP 2 — ORDER HISTORY PRESERVE KARO
--  Orders pe delivery_boy_id TEXT hai (no FK). Pehle unassign karo taaki
--  order history/milestone delete na ho.
-- ---------------------------------------------------------------------------
UPDATE public.orders
SET delivery_boy_id = NULL
WHERE delivery_boy_id IN (
  SELECT au.id::text
  FROM auth.users AS au
  JOIN public.users AS u ON u.id = au.id
  WHERE lower(u.role) IN ('delivery', 'delivery_partner')
);

-- ---------------------------------------------------------------------------
--  STEP 3 — DELETE HI DELIVERY ACCOUNTS
--  auth.users se delete karna automatically cascade karta hai:
--    - public.users (role = delivery)
--    - public.delivery_profiles
--    - public.user_roles (role = delivery)
--    - public.delivery_gigs
--  Customer / store accounts KOI ASAR NAHI.
-- ---------------------------------------------------------------------------
DELETE FROM auth.users AS au
USING public.users AS u
WHERE u.id = au.id
  AND lower(u.role) IN ('delivery', 'delivery_partner');

COMMIT;

-- ---------------------------------------------------------------------------
--  STEP 4 — VERIFY (optional): sab 0 hona chahiye
-- ---------------------------------------------------------------------------
-- SELECT count(*) AS remaining_delivery_accounts
-- FROM public.users
-- WHERE lower(role) IN ('delivery', 'delivery_partner');
